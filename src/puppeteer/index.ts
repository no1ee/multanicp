#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  CallToolResult,
  TextContent,
  ImageContent,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import puppeteer, { Browser, Page } from "puppeteer";

// --- Type Augmentation for Enhanced Page ---
// It's good practice to declare the methods you're adding to the Page interface
declare module "puppeteer" {
  interface Page {
    createInvisibleGrid(options?: any): Promise<boolean>;
    clickAtGridCoord(row: number, col: number, options?: any): Promise<boolean>;
    getElementAtGridCoord(row: number, col: number): Promise<any | null>;
    getGridCoordForElement(selector: string): Promise<{ row: number; col: number } | null>;
    toggleGridVisibility(visible?: boolean, labeled?: boolean): Promise<boolean>;
    getSuppressedDialogs(): Promise<any[]>;
  }
}
// --- End Type Augmentation ---


// Tab Manager for handling multiple tabs
class TabManager {
  private browser: Browser;
  private tabs: Map<string, { page: Page; metadata: any }>;
  private activeTabId: string | null;
  private nextTabId: number;

  constructor(browser: Browser) {
    this.browser = browser;
    this.tabs = new Map();
    this.activeTabId = null;
    this.nextTabId = 1;
  }

  async initializeWithFirstPage(firstPage: Page) {
    const tabId = `tab_${this.nextTabId++}`;
    this.tabs.set(tabId, {
      page: firstPage,
      metadata: {
        title: 'Initial Tab',
        createdAt: new Date(),
        // CORRECTION 1: Removed the misplaced 'default:' block here
      } // CORRECTION 2: Added missing closing brace for the metadata object
    }); // CORRECTION 3: Added missing closing brace for the object passed to tabs.set
    this.activeTabId = tabId;

    // Initialize alert handling on this page
    await this.setupAlertHandling(firstPage);

    return tabId;
  }

  async createTab(url?: string, options: any = {}) {
    const page = await this.browser.newPage();
    const tabId = `tab_${this.nextTabId++}`;

    // Store the tab
    this.tabs.set(tabId, {
      page,
      metadata: {
        title: options.title || 'New Tab',
        createdAt: new Date(),
        ...options,
      },
    });

    // Make it active if requested
    if (options.active) {
      this.activeTabId = tabId;
    }

    // Setup alert handling
    await this.setupAlertHandling(page);

    // Navigate if URL provided
    if (url) {
      try {
        await page.goto(url);
      } catch (error) {
        console.error(`Error navigating new tab ${tabId} to ${url}:`, error);
        // Don't throw, allow tab creation to succeed even if navigation fails
      }
    }

    return { tabId, page };
  }

  getTab(tabId: string) {
    return this.tabs.get(tabId);
  }

  async switchTab(tabId: string) {
    if (!this.tabs.has(tabId)) {
      throw new Error(`Tab ${tabId} not found`);
    }

    this.activeTabId = tabId;
    const tabInfo = this.tabs.get(tabId);
    if (!tabInfo) {
      // Should not happen due to the check above, but satisfies TS
      throw new Error(`Tab ${tabId} info missing unexpectedly`);
    }
    const { page } = tabInfo;

    // Bring tab to front
    try {
      await page.bringToFront();
    } catch (error) {
      console.error(`Error bringing tab ${tabId} to front:`, error);
      // Continue even if bringing to front fails
    }

    return page;
  }

  async closeTab(tabId: string) {
    if (!this.tabs.has(tabId)) {
      throw new Error(`Tab ${tabId} not found`);
    }

    const tabInfo = this.tabs.get(tabId);
    if (!tabInfo) {
        throw new Error(`Tab ${tabId} info missing unexpectedly`);
    }
    const { page } = tabInfo;


    // Close the page
    try {
      await page.close();
    } catch (error) {
      console.error(`Error closing page for tab ${tabId}:`, error);
      // Attempt to remove from map even if page close fails
    }

    // Remove from our map
    this.tabs.delete(tabId);

    // Update active tab if needed
    if (this.activeTabId === tabId) {
      this.activeTabId = this.tabs.size > 0 ?
        Array.from(this.tabs.keys())[0] : null;

      // If a new active tab exists, try to bring it to front
      if (this.activeTabId) {
          const newActiveTab = this.tabs.get(this.activeTabId);
          if (newActiveTab) {
              try {
                  await newActiveTab.page.bringToFront();
              } catch (bringFrontError) {
                  console.error(`Error bringing new active tab ${this.activeTabId} to front:`, bringFrontError);
              }
          }
      }
    }

    return true;
  }

  async getAllTabs() {
    const result = [];

    for (const [tabId, { page, metadata }] of this.tabs.entries()) {
      let title = 'Unknown Title (Page may be closed)';
      let url = 'unknown';
      let isPageAccessible = !page.isClosed();

      if (isPageAccessible) {
          try {
            title = await page.title();
            url = page.url();
          } catch (error) {
            console.error(`Error getting title/url for tab ${tabId}:`, error);
            title = 'Error fetching title';
            url = 'error fetching url';
            isPageAccessible = false; // Mark as inaccessible if basic info fails
          }
      }

      result.push({
        id: tabId,
        title,
        url,
        isActive: (tabId === this.activeTabId),
        isAccessible: isPageAccessible, // Added flag
        metadata,
      });
    }

    return result;
  }

  getActiveTab() {
    if (!this.activeTabId) return null;
    const tabInfo = this.tabs.get(this.activeTabId);
    if (!tabInfo) return null; // Tab might have been closed unexpectedly
    return {
      id: this.activeTabId,
      tab: tabInfo,
    };
  }

  getActivePage(): Page | null {
    if (!this.activeTabId) return null;
    const tab = this.tabs.get(this.activeTabId);
    // Also check if page is closed
    return (tab && !tab.page.isClosed()) ? tab.page : null;
  }

  async setupAlertHandling(page: Page) {
    // Configure dialog handling
    page.on('dialog', async (dialog) => {
      console.log(`[Alert Suppressed] Type: ${dialog.type()}, Message: ${dialog.message()}`);

      try {
        if (dialog.type() === 'prompt') {
          await dialog.accept('Automated response');
        } else if (dialog.type() === 'confirm') {
          await dialog.accept(); // Typically accept confirmations
        } else { // 'alert' or other types
          await dialog.dismiss(); // Dismiss alerts
        }
      } catch (error) {
        // Catch errors if the dialog is closed before handling
        if (!error.message.includes('Target closed')) {
           console.error('Error handling dialog:', error);
        }
      }
    });

    // Override JavaScript alert/confirm/prompt functions
    try {
        await page.evaluateOnNewDocument(() => {
          // Ensure _suppressedDialogs exists
          if (!('_suppressedDialogs' in window)) {
            (window as any)._suppressedDialogs = [];
          }

          // Override alert
          const originalAlert = window.alert;
          window.alert = function(message?: string) { // Make message optional
            const msg = message ?? '';
            console.log('[Alert Suppressed]:', msg);
            (window as any)._suppressedDialogs.push({
              type: 'alert',
              message: msg,
              timestamp: new Date().toISOString()
            });
            // originalAlert.call(window, message); // Optionally call original if needed for debugging
          };

          // Override confirm
          const originalConfirm = window.confirm;
          window.confirm = function(message?: string) { // Make message optional
            const msg = message ?? '';
            console.log('[Confirm Suppressed]:', msg);
            (window as any)._suppressedDialogs.push({
              type: 'confirm',
              message: msg,
              timestamp: new Date().toISOString()
            });
            // originalConfirm.call(window, message); // Optionally call original
            return true; // Auto-confirm
          };

          // Override prompt
          const originalPrompt = window.prompt;
          window.prompt = function(message?: string, defaultValue?: string) { // Make messages optional
            const msg = message ?? '';
            const defaultVal = defaultValue ?? '';
            console.log('[Prompt Suppressed]:', msg);
            (window as any)._suppressedDialogs.push({
              type: 'prompt',
              message: msg,
              defaultValue: defaultVal,
              timestamp: new Date().toISOString()
            });
            // originalPrompt.call(window, message, defaultValue); // Optionally call original
            return defaultValue ?? 'Automated response'; // Return default or automated response
          };
        });
    } catch(error) {
        console.error("Failed to evaluate script on new document (page might have closed):", error);
    }
  }
}

// Add grid navigation methods to a Page
async function enhancePageWithGrid(page: Page) {
    if (page.isClosed()) {
        console.warn("Attempted to enhance a closed page.");
        return page;
    }
  // Create invisible grid overlay
  (page as any).createInvisibleGrid = async (options: any = {}) => {
    if (page.isClosed()) return false;
    const rows = options.rows || 20;
    const columns = options.columns || 20;
    const targetSelector = options.targetSelector || 'body'; // Note: Currently unused in evaluate
    const zIndex = options.zIndex || -1;

    try {
      return await page.evaluate((rows, columns, /* selector, */ zIndex) => {
        // Remove any existing grid
        const existingGrid = document.getElementById('puppeteer-invisible-grid');
        if (existingGrid) {
          existingGrid.remove();
        }

        // Create grid container
        const gridContainer = document.createElement('div');
        gridContainer.id = 'puppeteer-invisible-grid';
        gridContainer.style.cssText = `
          position: fixed; /* Fixed to viewport */
          top: 0;
          left: 0;
          width: 100vw; /* Use viewport units */
          height: 100vh; /* Use viewport units */
          z-index: ${zIndex};
          pointer-events: none;
          display: grid;
          grid-template-columns: repeat(${columns}, 1fr);
          grid-template-rows: repeat(${rows}, 1fr);
          opacity: 0;
          border: none; /* Ensure no border */
          margin: 0; /* Ensure no margin */
          padding: 0; /* Ensure no padding */
          box-sizing: border-box; /* Include border/padding in size */
        `;

        // Create grid cells with data attributes
        for (let r = 1; r <= rows; r++) {
          for (let c = 1; c <= columns; c++) {
            const cell = document.createElement('div');
            cell.className = 'grid-cell';
            cell.setAttribute('data-row', r.toString());
            cell.setAttribute('data-col', c.toString());
            cell.style.cssText = `
              grid-row: ${r};
              grid-column: ${c};
              border: 0;
              padding: 0;
              margin: 0;
              box-sizing: border-box;
              /* No visible styling by default */
            `;
            gridContainer.appendChild(cell);
          }
        }

        // Add to document body
        document.body.appendChild(gridContainer);

        // Store grid dimensions on window for potential use
        (window as any)._puppeteerGridDimensions = { rows, columns };

        return true;
      }, rows, columns, /* targetSelector, */ zIndex);
    } catch (error) {
      console.error("Error creating invisible grid:", error);
      return false;
    }
  };

  // Click at grid coordinates
  (page as any).clickAtGridCoord = async (row: number, col: number, options: any = {}) => {
    if (page.isClosed()) return false;
    const visible = options.visible || false;

    try {
      return await page.evaluate((row, col, makeVisible) => {
        const gridContainer = document.getElementById('puppeteer-invisible-grid');
        if (!gridContainer) {
            console.error("Puppeteer grid container not found.");
            return false;
        }

        // Find the cell
        const cell = gridContainer.querySelector(`[data-row="${row}"][data-col="${col}"]`);
        if (!cell) {
            console.error(`Grid cell (${row}, ${col}) not found.`);
            return false;
        }

        // Get viewport-relative position
        const rect = (cell as HTMLElement).getBoundingClientRect();
        // Ensure rect has dimensions before calculating center
        if (rect.width === 0 || rect.height === 0) {
             console.warn(`Grid cell (${row}, ${col}) has zero dimensions.`);
             // Optionally attempt click at top-left corner or skip
             // return false;
        }
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;

        // Visual feedback if requested
        if (makeVisible) {
          const highlighter = document.createElement('div');
          highlighter.style.cssText = `
            position: fixed;
            left: ${rect.left}px;
            top: ${rect.top}px;
            width: ${rect.width}px;
            height: ${rect.height}px;
            background-color: rgba(255,0,0,0.3);
            border: 2px solid red;
            z-index: 10000;
            pointer-events: none;
            box-sizing: border-box;
          `;
          document.body.appendChild(highlighter);

          // Remove after 2 seconds
          setTimeout(() => highlighter.remove(), 2000);
        }

        // Find real element at these coordinates using elementFromPoint
        // IMPORTANT: Temporarily make grid non-blocking for elementFromPoint
        gridContainer.style.pointerEvents = 'none';
        const elementToClick = document.elementFromPoint(x, y);
        // Restore grid state (though it should be none anyway)
        gridContainer.style.pointerEvents = 'none';


        if (elementToClick && typeof (elementToClick as HTMLElement).click === 'function') {
          console.log(`Clicking element at (${x}, ${y}):`, elementToClick.tagName);
          (elementToClick as HTMLElement).click();
          return true;
        } else {
            console.warn(`No clickable element found at coordinates (${x}, ${y}) corresponding to grid (${row}, ${col}). Found:`, elementToClick);
            // Attempt a synthesized click event at the coordinates as a fallback?
            // This is less reliable than element.click()
            // Example (requires more complex event creation):
            // const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y });
            // document.body.dispatchEvent(clickEvent); // Dispatch on body or a container
            return false;
        }

      }, row, col, visible);
    } catch (error) {
        console.error(`Error clicking at grid coordinates (${row}, ${col}):`, error);
        return false;
    }
  };

  // Get element at grid coordinates
  (page as any).getElementAtGridCoord = async (row: number, col: number) => {
    if (page.isClosed()) return null;
    try {
      return await page.evaluate((row, col) => {
        const gridContainer = document.getElementById('puppeteer-invisible-grid');
        if (!gridContainer) {
            console.error("Puppeteer grid container not found.");
            return null;
        }

        // Find the cell at coordinates
        const cell = gridContainer.querySelector(`[data-row="${row}"][data-col="${col}"]`);
        if (!cell) {
            console.error(`Grid cell (${row}, ${col}) not found.`);
            return null;
        }

        // Get center position of cell
        const rect = (cell as HTMLElement).getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;

        // Find element at coordinates
        // IMPORTANT: Temporarily make grid non-blocking for elementFromPoint
        gridContainer.style.pointerEvents = 'none';
        const element = document.elementFromPoint(x, y);
        // Restore grid state
        gridContainer.style.pointerEvents = 'none';


        if (!element) {
            console.warn(`No element found at coordinates (${x}, ${y}) for grid (${row}, ${col}).`);
            return null;
        }

        // Gather element information
        const elementInfo: any = {
          tagName: element.tagName,
          id: element.id,
          className: element.className,
          textContent: element.textContent?.trim().substring(0, 100) || '', // Limit text content
          attributes: [],
          rect: element.getBoundingClientRect() // Add bounding box info
        };

        if (typeof element.getAttributeNames === 'function') {
            elementInfo.attributes = element.getAttributeNames().map(name => ({
              name: name,
              value: element.getAttribute(name)
            }));
        }


        return elementInfo;
      }, row, col);
    } catch (error) {
        console.error(`Error getting element at grid coordinates (${row}, ${col}):`, error);
        return null;
    }
  };

  // Get grid coordinates for element
  (page as any).getGridCoordForElement = async (selector: string) => {
    if (page.isClosed()) return null;
    try {
      return await page.evaluate((selector) => {
        const element = document.querySelector(selector);
        if (!element) {
            console.warn(`Element with selector "${selector}" not found.`);
            return null;
        }

        const gridContainer = document.getElementById('puppeteer-invisible-grid');
        if (!gridContainer) {
            console.error("Puppeteer grid container not found.");
            return null;
        }

        // Get element position
        const elementRect = (element as HTMLElement).getBoundingClientRect();
        const elementCenter = {
          x: elementRect.left + elementRect.width / 2,
          y: elementRect.top + elementRect.height / 2
        };

        // Find closest grid cell center
        let closestCell = null;
        let closestDistance = Infinity;

        const cells = gridContainer.querySelectorAll('.grid-cell');
        for (const cell of cells) {
          if (!(cell instanceof HTMLElement)) continue; // Type guard

          const cellRect = cell.getBoundingClientRect();
          const cellCenter = {
            x: cellRect.left + cellRect.width / 2,
            y: cellRect.top + cellRect.height / 2
          };

          // Calculate distance between centers
          const distance = Math.sqrt(
            Math.pow(elementCenter.x - cellCenter.x, 2) +
            Math.pow(elementCenter.y - cellCenter.y, 2)
          );

          if (distance < closestDistance) {
            closestDistance = distance;
            closestCell = cell;
          }
        }

        if (closestCell) {
            const rowAttr = closestCell.getAttribute('data-row');
            const colAttr = closestCell.getAttribute('data-col');
            if (rowAttr && colAttr) {
                return {
                    row: parseInt(rowAttr),
                    col: parseInt(colAttr)
                };
            }
        }

        console.warn(`Could not find matching grid cell for selector "${selector}".`);
        return null;
      }, selector);
    } catch (error) {
        console.error(`Error getting grid coordinates for selector "${selector}":`, error);
        return null;
    }
  };

  // Toggle grid visibility (for debugging)
  (page as any).toggleGridVisibility = async (visible = true, labeled = true) => {
    if (page.isClosed()) return false;
    try {
      return await page.evaluate((visible, labeled) => {
        const grid = document.getElementById('puppeteer-invisible-grid');
        if (!grid) {
            console.error("Puppeteer grid container not found.");
            return false;
        }

        if (visible) {
          grid.style.opacity = '0.5'; // Make it slightly more visible
          grid.style.backgroundColor = 'rgba(0,0,255,0.05)';
          grid.style.zIndex = '10000'; // Bring to front
          grid.style.pointerEvents = 'none'; // Ensure it doesn't block interaction

          // Style cells
          const cells = grid.querySelectorAll('.grid-cell');
          cells.forEach(cell => {
              if (!(cell instanceof HTMLElement)) return; // Type guard
              cell.style.border = '1px dashed rgba(0,0,0,0.3)'; // More visible border
              cell.style.boxSizing = 'border-box';

              if (labeled) {
                const row = cell.getAttribute('data-row');
                const col = cell.getAttribute('data-col');
                cell.textContent = `${row},${col}`;
                cell.style.display = 'flex';
                cell.style.justifyContent = 'center';
                cell.style.alignItems = 'center';
                cell.style.fontSize = '8px'; // Smaller font
                cell.style.color = 'rgba(0,0,0,0.7)'; // Darker text
                cell.style.overflow = 'hidden'; // Prevent text overflow
                cell.style.pointerEvents = 'none'; // Ensure cell text doesn't block
              } else {
                  cell.textContent = ''; // Clear text if not labeled
              }
          });
        } else {
          grid.style.opacity = '0';
          grid.style.backgroundColor = 'transparent';
          grid.style.zIndex = '-1'; // Send to back
          grid.style.pointerEvents = 'none';

          // Hide cell borders and text
          const cells = grid.querySelectorAll('.grid-cell');
          cells.forEach(cell => {
            if (!(cell instanceof HTMLElement)) return; // Type guard
            cell.style.border = '0';
            cell.textContent = '';
          });
        }

        return true;
      }, visible, labeled);
    } catch (error) {
        console.error(`Error toggling grid visibility:`, error);
        return false;
    }
  };

  // Get suppressed dialogs from the page
  (page as any).getSuppressedDialogs = async () => {
    if (page.isClosed()) return [];
    try {
      return await page.evaluate(() => {
        return (window as any)._suppressedDialogs || [];
      });
    } catch (error) {
        console.error(`Error getting suppressed dialogs:`, error);
        return []; // Return empty array on error
    }
  };

  // Auto-initialize grid on page load/navigation
  const initGridOnLoad = async () => {
      if (!page.isClosed()) {
          await (page as any).createInvisibleGrid();
          console.log(`Grid initialized on page: ${page.url()}`);
      }
  };

  page.on('load', initGridOnLoad);
  // Also consider 'framenavigated' for SPAs, but 'load' is often sufficient
  // page.on('framenavigated', initGridOnLoad); // Might be too frequent

  // Initial grid creation for already loaded page
  if (!page.isClosed()) {
    await (page as any).createInvisibleGrid();
  }

  return page;
}

// Define the tools once to avoid repetition
const TOOLS: Tool[] = [
  {
    name: "puppeteer_navigate",
    description: "Navigate the active tab to a URL",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to navigate to (must include protocol like http:// or https://)" },
      },
      required: ["url"],
    },
  },
  {
    name: "puppeteer_screenshot",
    description: "Take a screenshot of the active tab or a specific element",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Unique name for the screenshot resource (e.g., 'login-page-view')" },
        selector: { type: "string", description: "Optional CSS selector for a specific element to screenshot" },
        fullPage: { type: "boolean", description: "Optional. Capture the full scrollable page (default: false - viewport only). Ignored if selector is provided." },
        width: { type: "number", description: "Optional. Viewport width in pixels (default: 1280)" },
        height: { type: "number", description: "Optional. Viewport height in pixels (default: 720)" },
      },
      required: ["name"],
    },
  },
  {
    name: "puppeteer_click",
    description: "Click an element on the active tab",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector for the element to click" },
      },
      required: ["selector"],
    },
  },
  {
    name: "puppeteer_fill",
    description: "Fill out an input field on the active tab",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector for the input field (e.g., input[name='username'])" },
        value: { type: "string", description: "The text value to fill into the field" },
      },
      required: ["selector", "value"],
    },
  },
  {
    name: "puppeteer_select",
    description: "Select an option within a <select> element on the active tab",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector for the <select> element" },
        value: { type: "string", description: "The value attribute of the <option> to select" },
      },
      required: ["selector", "value"],
    },
  },
  {
    name: "puppeteer_hover",
    description: "Hover the mouse cursor over an element on the active tab",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector for the element to hover over" },
      },
      required: ["selector"],
    },
  },
  {
    name: "puppeteer_evaluate",
    description: "Execute arbitrary JavaScript code in the context of the active tab",
    inputSchema: {
      type: "object",
      properties: {
        script: { type: "string", description: "JavaScript code to execute (e.g., 'return document.title')" },
      },
      required: ["script"],
    },
  },
  // New tools for tab management
  {
    name: "puppeteer_create_tab",
    description: "Create a new browser tab and optionally navigate it",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Optional URL to navigate to in the new tab (must include protocol)" },
        active: { type: "boolean", description: "Whether to switch to the new tab immediately (default: false)" },
        title: { type: "string", description: "Optional custom title/label for the tab's metadata" },
      },
      required: [],
    },
  },
  {
    name: "puppeteer_switch_tab",
    description: "Switch focus to a different browser tab",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "string", description: "The ID of the tab to switch to (e.g., 'tab_1')" },
      },
      required: ["tabId"],
    },
  },
  {
    name: "puppeteer_list_tabs",
    description: "List all currently open browser tabs with their IDs, titles, and URLs",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "puppeteer_close_tab",
    description: "Close a specific browser tab",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "string", description: "The ID of the tab to close (e.g., 'tab_2')" },
      },
      required: ["tabId"],
    },
  },
  // Grid navigation tools
  {
    name: "puppeteer_click_grid",
    description: "Click the element located at the center of a specific grid cell coordinates in the active tab",
    inputSchema: {
      type: "object",
      properties: {
        row: { type: "number", description: "Grid row coordinate (1-based)" },
        col: { type: "number", description: "Grid column coordinate (1-based)" },
        visible: { type: "boolean", description: "Show brief visual feedback of the click location (default: false)" },
      },
      required: ["row", "col"],
    },
  },
  {
    name: "puppeteer_get_element_at_grid",
    description: "Get information about the element located at specific grid coordinates in the active tab",
    inputSchema: {
      type: "object",
      properties: {
        row: { type: "number", description: "Grid row coordinate (1-based)" },
        col: { type: "number", description: "Grid column coordinate (1-based)" },
      },
      required: ["row", "col"],
    },
  },
  {
    name: "puppeteer_toggle_grid",
    description: "Toggle the visibility of the grid overlay (useful for debugging)",
    inputSchema: {
      type: "object",
      properties: {
        visible: { type: "boolean", description: "Whether the grid overlay should be visible (default: true)" },
        labeled: { type: "boolean", description: "Show coordinate labels in grid cells when visible (default: true)" },
      },
      required: [], // Defaults are handled in the function
    },
  },
  {
    name: "puppeteer_get_suppressed_dialogs",
    description: "Retrieve a list of suppressed dialogs (alerts, confirms, prompts) encountered on the active tab",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];

// Global state
let browser: Browser | undefined;
let tabManager: TabManager | undefined;
const consoleLogs: { timestamp: string; type: string; text: string; tabId?: string }[] = []; // Store structured logs
const screenshots = new Map<string, string>(); // Store base64 screenshot data

async function ensureBrowser(): Promise<Page | null> { // Return type indicates page might be null
  if (!browser) {
    console.log("Launching browser...");
    const isDocker = !!process.env.DOCKER_CONTAINER;
    const launchOptions = {
      headless: isDocker ? true : false, // Headless true in Docker, false otherwise
      args: isDocker
        ? ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--single-process", "--no-zygote"] // Common Docker args
        : ["--disable-infobars", "--window-size=1280,800"], // NPX/local args
      // dumpio: true, // Uncomment for verbose browser logging
    };
    browser = await puppeteer.launch(launchOptions);
    console.log("Browser launched.");

    browser.on('disconnected', () => {
        console.error("Browser disconnected unexpectedly!");
        browser = undefined;
        tabManager = undefined;
        screenshots.clear();
        consoleLogs.length = 0;
        // Optionally: attempt to relaunch or notify client
    });

    tabManager = new TabManager(browser);

    const pages = await browser.pages();
    let initialPage: Page;

    if (pages.length > 0) {
      initialPage = pages[0];
      console.log("Using existing initial page.");
    } else {
      console.log("No initial page found, creating one.");
      initialPage = await browser.newPage(); // Create one if none exist
    }

    // Ensure the initial page isn't about:blank or handle it
    if (initialPage.url() === 'about:blank') {
        console.log("Initial page is about:blank, navigating to example.com");
        try {
            await initialPage.goto('https://example.com', { waitUntil: 'networkidle2' });
        } catch (e) {
            console.error("Failed to navigate initial page from about:blank", e);
            // Decide how to handle this - maybe close the page?
        }
    }

    await enhancePageWithGrid(initialPage); // Enhance the page *before* adding to manager
    const initialTabId = await tabManager.initializeWithFirstPage(initialPage);
    console.log(`Initial tab created with ID: ${initialTabId}`);

    // Setup console logging for the *initial* page
    initialPage.on("console", (msg) => {
      const logEntry = {
        timestamp: new Date().toISOString(),
        tabId: initialTabId, // Associate log with its tab
        type: msg.type(),
        text: msg.text()
      };
      consoleLogs.push(logEntry);
      // Consider buffering notifications or limiting frequency
      server?.notification({ // Use optional chaining for server
        method: "notifications/resources/updated",
        params: { uri: "console://logs" },
      });
    });
    console.log("Console logging setup for initial tab.");

  } else if (!tabManager) {
      // Browser exists but manager doesn't (shouldn't happen with current logic, but safeguard)
      console.error("Browser exists but TabManager is missing. Reinitializing.");
      tabManager = new TabManager(browser);
      const pages = await browser.pages();
       if (pages.length > 0) {
           const firstPage = await enhancePageWithGrid(pages[0]);
           await tabManager.initializeWithFirstPage(firstPage);
           // Re-setup console listener if needed
       } else {
            console.log("No pages found after reinit. Need to create a tab.");
            return null; // Indicate no active page
       }
  }

  // Return the active page from tab manager, checking if it's closed
  const activePage = tabManager!.getActivePage();
  if (activePage && activePage.isClosed()){
      console.warn("Active page is closed. Attempting to find another or returning null.");
      // Attempt to switch to another tab or return null
      const allTabs = await tabManager!.getAllTabs();
      const openTabs = allTabs.filter(t => t.isAccessible);
      if (openTabs.length > 0) {
          const newActiveTabId = openTabs[0].id;
          console.log(`Switching to first available open tab: ${newActiveTabId}`);
          await tabManager!.switchTab(newActiveTabId);
          return tabManager!.getActivePage(); // Return the new active page
      } else {
          console.log("No open tabs available.");
          return null; // No active, open page
      }
  }
  return activePage; // Return current active page or null if none/closed
}

declare global {
  interface Window {
    // Keep only necessary global declarations
    _suppressedDialogs: { type: string; message: string; defaultValue?: string; timestamp: string }[];
    _puppeteerGridDimensions?: { rows: number; columns: number };
    // Removed mcpHelper as evaluate logic was changed
  }
}

async function handleToolCall(name: string, args: any): Promise<CallToolResult> {
  // Ensure browser is ready, get the current page (which might be null)
  const currentPage = await ensureBrowser();

  // Handle tools that don't require an active page first
  switch (name) {
      case "puppeteer_list_tabs":
        if (!tabManager) {
            return { content: [{ type: "text", text: "Browser not initialized." }], isError: true };
        }
        try {
          const tabs = await tabManager.getAllTabs();
          return {
            content: [{
              type: "text",
              text: `Open tabs:\n${JSON.stringify(tabs, null, 2)}`,
            }],
            isError: false,
          };
        } catch (error: any) {
          return {
            content: [{
              type: "text",
              text: `Failed to list tabs: ${error.message}`,
            }],
            isError: true,
          };
        }
        // break; // Not needed due to return

      case "puppeteer_create_tab":
        if (!tabManager || !browser) { // Need browser to create page
           return { content: [{ type: "text", text: "Browser not initialized." }], isError: true };
        }
        try {
          const { tabId, page } = await tabManager.createTab(args.url, {
            active: args.active ?? false, // Default active to false
            title: args.title
          });

          await enhancePageWithGrid(page); // Enhance the new page

          // Setup console logging for the new page
          page.on("console", (msg) => {
            const logEntry = {
              timestamp: new Date().toISOString(),
              tabId: tabId, // Associate log with its tab
              type: msg.type(),
              text: msg.text()
            };
            consoleLogs.push(logEntry);
            server?.notification({ // Use optional chaining
              method: "notifications/resources/updated",
              params: { uri: "console://logs" },
            });
          });

          return {
            content: [{
              type: "text",
              text: `Created new tab with ID: ${tabId}${args.url ? `, navigating to ${args.url}` : ''}${args.active ? ', and switched to it' : ''}`,
            }],
            isError: false,
          };
        } catch (error: any) {
          return {
            content: [{
              type: "text",
              text: `Failed to create tab: ${error.message}`,
            }],
            isError: true,
          };
        }
        // break; // Not needed due to return
  }


  // Now handle tools that require an active page
  if (!currentPage) {
    return {
      content: [{
        type: "text",
        text: "No active browser tab available. Please create or switch to one (e.g., use puppeteer_create_tab or check puppeteer_list_tabs).",
      }],
      isError: true,
    };
  }

  // --- Tool implementations requiring currentPage ---
  try { // Wrap remaining cases in a try-catch for page-related errors
    switch (name) {
      case "puppeteer_navigate":
        await currentPage.goto(args.url, { waitUntil: 'networkidle2', timeout: 60000 }); // Add wait + timeout
        return {
          content: [{
            type: "text",
            text: `Navigated to ${args.url}`,
          }],
          isError: false,
        };
        // break; // Not needed

      case "puppeteer_screenshot": { // Use block scope for variables
        const width = args.width ?? 1280; // Default viewport
        const height = args.height ?? 720;
        const fullPage = args.fullPage ?? false; // Default fullPage to false

        // Set viewport *before* screenshot, unless capturing a specific element
        if (!args.selector) {
           await currentPage.setViewport({ width, height });
        }

        let screenshot: string | Buffer | undefined;
        if (args.selector) {
            const element = await currentPage.$(args.selector);
            if (element) {
                screenshot = await element.screenshot({ encoding: "base64" });
            } else {
                 // Element not found scenario handled below
            }
        } else {
            screenshot = await currentPage.screenshot({
                encoding: "base64",
                fullPage: fullPage // Use the fullPage argument
            });
        }


        if (!screenshot) {
          return {
            content: [{
              type: "text",
              text: args.selector ? `Element not found for screenshot: ${args.selector}` : "Screenshot failed (page might be invalid or empty)",
            }],
            isError: true,
          };
        }

        // CORRECTION 4: Screenshot success path is now correctly placed after the check
        const screenshotBase64 = screenshot.toString('base64'); // Ensure it's base64 string
        screenshots.set(args.name, screenshotBase64);
        server?.notification({ // Optional chaining
          method: "notifications/resources/list_changed", // Notify client resource list changed
        });
         // Also notify that the specific resource was updated (or created)
        server?.notification({
            method: "notifications/resources/updated",
            params: { uri: `screenshot://${args.name}` }
        });


        return {
          content: [
            {
              type: "text",
              text: `Screenshot '${args.name}' taken ${args.selector ? `of element '${args.selector}'` : `(${fullPage ? 'full page' : `viewport ${width}x${height}`})`}`,
            } as TextContent,
            {
              type: "image",
              data: screenshotBase64, // Use the guaranteed base64 string
              mimeType: "image/png",
              uri: `screenshot://${args.name}` // Add URI
            } as ImageContent,
          ],
          isError: false,
        };
      }
      // break; // Not needed

      case "puppeteer_click":
          // Wait for element and ensure it's clickable/visible
          await currentPage.waitForSelector(args.selector, { visible: true, timeout: 10000 });
          await currentPage.click(args.selector);
          // Optional: Add a small delay or wait for navigation/update if expected
          // await currentPage.waitForTimeout(500);
          return {
            content: [{
              type: "text",
              text: `Clicked: ${args.selector}`,
            }],
            isError: false,
          };
       // break; // Not needed

      case "puppeteer_fill":
          await currentPage.waitForSelector(args.selector, { visible: true, timeout: 10000 });
          // Use fill for modern inputs, fallback to type with delay
          try {
              await currentPage.fill(args.selector, args.value);
          } catch (fillError) {
              console.warn(`Fill failed for ${args.selector}, falling back to type:`, fillError.message);
              // Clear field first? Depends on desired behavior
              // await currentPage.evaluate((sel) => { const el = document.querySelector(sel); if (el) el.value = ''; }, args.selector);
              await currentPage.type(args.selector, args.value, { delay: 50 }); // Add slight delay
          }
          return {
            content: [{
              type: "text",
              text: `Filled ${args.selector} with: ${args.value}`,
            }],
            isError: false,
          };
       // break; // Not needed

      case "puppeteer_select":
          await currentPage.waitForSelector(args.selector, { visible: true, timeout: 10000 });
          await currentPage.select(args.selector, args.value);
          return {
            content: [{
              type: "text",
              text: `Selected option with value "${args.value}" in: ${args.selector}`,
            }],
            isError: false,
          };
       // break; // Not needed

      case "puppeteer_hover":
          await currentPage.waitForSelector(args.selector, { visible: true, timeout: 10000 });
          await currentPage.hover(args.selector);
          return {
            content: [{
              type: "text",
              text: `Hovered over: ${args.selector}`,
            }],
            isError: false,
          };
       // break; // Not needed

      case "puppeteer_evaluate":
        // Note: The previous evaluate logic modifying console is complex and might interfere.
        // A simpler approach just runs the script. Add console capture separately if needed.
        const result = await currentPage.evaluate(args.script);
        return {
          content: [
            {
              type: "text",
              text: `Script execution result:\n${JSON.stringify(result, null, 2)}`,
            },
          ],
          isError: false,
        };
       // break; // Not needed

      // --- Tab management requiring an active page context (though some ops affect others) ---
      case "puppeteer_switch_tab":
          if (!tabManager) return { content: [{ type: "text", text: "Tab manager not available." }], isError: true }; // Should be caught earlier
          await tabManager.switchTab(args.tabId);
          return {
            content: [{
              type: "text",
              text: `Switched to tab: ${args.tabId}`,
            }],
            isError: false,
          };
       // break; // Not needed

      case "puppeteer_close_tab":
           if (!tabManager) return { content: [{ type: "text", text: "Tab manager not available." }], isError: true }; // Should be caught earlier
           await tabManager.closeTab(args.tabId);
           // Notify that the list of resources (tabs are implicitly resources via list_tabs) changed
           server?.notification({ method: "notifications/resources/list_changed" });
           return {
             content: [{
               type: "text",
               text: `Closed tab: ${args.tabId}`,
             }],
             isError: false,
           };
       // break; // Not needed

      // --- Grid navigation tools ---
      case "puppeteer_click_grid":
          const clickSuccess = await currentPage.clickAtGridCoord(args.row, args.col, {
            visible: args.visible ?? false
          });
          return {
            content: [{
              type: "text",
              text: clickSuccess
                ? `Clicked at grid coordinates (${args.row}, ${args.col})`
                : `Failed to click or no element found at grid coordinates (${args.row}, ${args.col})`,
            }],
            isError: !clickSuccess, // Error if click failed
          };
       // break; // Not needed

      case "puppeteer_get_element_at_grid":
          const element = await currentPage.getElementAtGridCoord(args.row, args.col);
          if (!element) {
            return {
              content: [{
                type: "text",
                text: `No element found at grid coordinates (${args.row}, ${args.col})`,
              }],
              isError: true, // Indicate element not found is an issue
            };
          }
          return {
            content: [{
              type: "text",
              text: `Element at grid coordinates (${args.row}, ${args.col}):\n${JSON.stringify(element, null, 2)}`,
            }],
            isError: false,
          };
       // break; // Not needed

      case "puppeteer_toggle_grid":
          const visible = args.visible !== undefined ? args.visible : true; // Default to true
          const labeled = args.labeled !== undefined ? args.labeled : true; // Default to true
          await currentPage.toggleGridVisibility(visible, labeled);
          return {
            content: [{
              type: "text",
              text: `Grid visibility ${visible ? 'enabled' : 'disabled'}${visible && labeled ? ' with labels' : ''}`,
            }],
            isError: false,
          };
       // break; // Not needed

      case "puppeteer_get_suppressed_dialogs":
          const dialogs = await currentPage.getSuppressedDialogs();
          // CORRECTION 5: Fixed end of case block
          return {
            content: [{
              type: "text",
              text: `Suppressed dialogs on active tab:\n${JSON.stringify(dialogs, null, 2)}`,
            }],
            isError: false,
          };
       // break; // Not needed

      default:
        // CORRECTION 6: Fixed trailing comma in default case
        return {
          content: [{
            type: "text",
            text: `Unknown tool or tool requires specific context: ${name}`,
          }],
          isError: true,
        };
    }
  } catch (error: any) {
      // Catch errors from Puppeteer operations on the current page
      console.error(`Error executing tool '${name}' on page:`, error);
      return {
          content: [{
              type: "text",
              text: `Error during tool execution '${name}': ${error.message}`
          }],
          isError: true
      };
  }
} // CORRECTION 7: Added the missing closing brace for the handleToolCall function

// --- Server Setup ---
// CORRECTION 8: Moved server setup code outside the handleToolCall function

const server = new Server(
  {
    name: "example-servers/puppeteer-enhanced", // Updated name
    version: "0.2.0", // Updated version
  },
  {
    capabilities: {
      // Declare capabilities - initially empty, can be filled later if needed
      resources: {},
      tools: {},
    },
  },
);

// Setup request handlers
server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: "console://logs",
      mimeType: "text/plain",
      name: "Browser console logs (All Tabs)",
      description: "Aggregated console logs from all browser tabs.",
    },
    ...Array.from(screenshots.entries()).map(([name, _data]) => ({ // Use entries()
      uri: `screenshot://${name}`,
      mimeType: "image/png",
      name: `Screenshot: ${name}`,
      description: `Screenshot captured with name '${name}'.`,
    })),
    // Consider adding representation for tabs if needed, though list_tabs tool might suffice
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri.toString();

  if (uri === "console://logs") {
    // Format console logs nicely
    const logText = consoleLogs.map(log =>
        `[${log.timestamp}]${log.tabId ? `[${log.tabId}]` : ''}[${log.type.toUpperCase()}] ${log.text}`
    ).join("\n");

    return {
      contents: [{
        uri,
        mimeType: "text/plain",
        text: logText || "No console logs yet.", // Handle empty logs
      }],
    };
  }

  if (uri.startsWith("screenshot://")) {
    const name = uri.substring("screenshot://".length); // More robust extraction
    const screenshot = screenshots.get(name);
    if (screenshot) {
      return {
        contents: [{
          uri,
          mimeType: "image/png",
          blob: screenshot, // SDK expects base64 string in 'blob' field for images
        }],
      };
    } else {
        // Throw specific error for not found resource
         throw new Error(`Resource not found: ${uri}`);
    }
  }

  // If URI is not matched, throw error
  throw new Error(`Resource not found or unsupported: ${uri}`);
});

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

// Use the already defined handleToolCall function
server.setRequestHandler(CallToolRequestSchema, async (request) =>
  handleToolCall(request.params.name, request.params.arguments ?? {})
);

async function runServer() {
  console.log("Starting Puppeteer MCP Server...");
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.log("Server connected via StdioTransport.");
  // Ensure browser is launched *after* server starts connecting
  // This prevents potential hangs if browser launch takes long
   try {
       await ensureBrowser();
       console.log("Initial browser state ensured.");
   } catch (err) {
       console.error("Failed to initialize browser on startup:", err);
       // Consider how to handle this - maybe the server should exit?
   }
}

runServer().catch(error => {
    console.error("Unhandled error during server execution:", error);
    process.exit(1); // Exit if server fails to run
});

// Graceful shutdown
async function shutdown() {
    console.log("Shutting down server and browser...");
    server?.close(); // Close server connection
    if (browser) {
        try {
            await browser.close();
            console.log("Browser closed.");
        } catch (e) {
            console.error("Error closing browser:", e);
        }
        browser = undefined;
        tabManager = undefined;
    }
    process.exit(0);
}

process.on('SIGINT', shutdown); // Handle Ctrl+C
process.on('SIGTERM', shutdown); // Handle kill signals

process.stdin.on("close", () => {
  console.error("STDIN closed, initiating shutdown...");
  shutdown(); // Trigger shutdown if stdin closes (e.g., parent process exits)
});

console.log("Puppeteer MCP Server script initialized.");
