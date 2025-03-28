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
      }

    default:
      return {
        content: [{
          type: "text",
          text: `Unknown tool: ${name}`,
        }],
        isError: true,
      };,
    });
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
      await page.goto(url);
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
    const { page } = this.tabs.get(tabId)!;
    
    // Bring tab to front
    await page.bringToFront();
    
    return page;
  }

  async closeTab(tabId: string) {
    if (!this.tabs.has(tabId)) {
      throw new Error(`Tab ${tabId} not found`);
    }
    
    const { page } = this.tabs.get(tabId)!;
    
    // Close the page
    await page.close();
    
    // Remove from our map
    this.tabs.delete(tabId);
    
    // Update active tab if needed
    if (this.activeTabId === tabId) {
      this.activeTabId = this.tabs.size > 0 ? 
        Array.from(this.tabs.keys())[0] : null;
    }
    
    return true;
  }

  async getAllTabs() {
    const result = [];
    
    for (const [tabId, { page, metadata }] of this.tabs.entries()) {
      let title;
      try {
        title = await page.title();
      } catch (error) {
        title = 'Unknown Title';
      }
      
      const url = page.url();
      
      result.push({
        id: tabId,
        title,
        url,
        isActive: (tabId === this.activeTabId),
        metadata,
      });
    }
    
    return result;
  }

  getActiveTab() {
    if (!this.activeTabId) return null;
    return {
      id: this.activeTabId,
      tab: this.tabs.get(this.activeTabId),
    };
  }

  getActivePage(): Page | null {
    if (!this.activeTabId) return null;
    const tab = this.tabs.get(this.activeTabId);
    return tab ? tab.page : null;
  }

  async setupAlertHandling(page: Page) {
    // Configure dialog handling
    page.on('dialog', async (dialog) => {
      console.log(`[Alert Suppressed] Type: ${dialog.type()}, Message: ${dialog.message()}`);
      
      try {
        if (dialog.type() === 'prompt') {
          await dialog.accept('Automated response');
        } else if (dialog.type() === 'confirm') {
          await dialog.accept();
        } else {
          await dialog.dismiss();
        }
      } catch (error) {
        console.error('Error handling dialog:', error);
      }
    });

    // Override JavaScript alert/confirm/prompt functions
    await page.evaluateOnNewDocument(() => {
      window._suppressedDialogs = [];
      
      // Override alert
      const originalAlert = window.alert;
      window.alert = function(message) {
        console.log('[Alert Suppressed]:', message);
        window._suppressedDialogs.push({ 
          type: 'alert', 
          message, 
          timestamp: new Date().toISOString() 
        });
      };
      
      // Override confirm
      const originalConfirm = window.confirm;
      window.confirm = function(message) {
        console.log('[Confirm Suppressed]:', message);
        window._suppressedDialogs.push({ 
          type: 'confirm', 
          message, 
          timestamp: new Date().toISOString() 
        });
        return true;
      };
      
      // Override prompt
      const originalPrompt = window.prompt;
      window.prompt = function(message, defaultValue) {
        console.log('[Prompt Suppressed]:', message);
        window._suppressedDialogs.push({ 
          type: 'prompt', 
          message, 
          defaultValue, 
          timestamp: new Date().toISOString() 
        });
        return 'Automated response';
      };
    });
  }
}

// Add grid navigation methods to a Page
async function enhancePageWithGrid(page: Page) {
  // Create invisible grid overlay
  page.createInvisibleGrid = async (options: any = {}) => {
    const rows = options.rows || 20;
    const columns = options.columns || 20;
    const targetSelector = options.targetSelector || 'body';
    const zIndex = options.zIndex || -1;
    
    return await page.evaluate((rows, columns, selector, zIndex) => {
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
        width: 100%;
        height: 100%;
        z-index: ${zIndex};
        pointer-events: none;
        display: grid;
        grid-template-columns: repeat(${columns}, 1fr);
        grid-template-rows: repeat(${rows}, 1fr);
        opacity: 0;
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
          `;
          gridContainer.appendChild(cell);
        }
      }
      
      // Add to document
      document.body.appendChild(gridContainer);
      
      // Store grid dimensions
      (window as any)._puppeteerGridDimensions = { rows, columns };
      
      return true;
    }, rows, columns, targetSelector, zIndex);
  };

  // Click at grid coordinates
  page.clickAtGridCoord = async (row: number, col: number, options: any = {}) => {
    const visible = options.visible || false;
    
    return await page.evaluate((row, col, makeVisible) => {
      const gridContainer = document.getElementById('puppeteer-invisible-grid');
      if (!gridContainer) return false;
      
      // Find the cell
      const cell = gridContainer.querySelector(`[data-row="${row}"][data-col="${col}"]`);
      if (!cell) return false;
      
      // Get viewport-relative position
      const rect = (cell as HTMLElement).getBoundingClientRect();
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
        `;
        document.body.appendChild(highlighter);
        
        // Remove after 2 seconds
        setTimeout(() => highlighter.remove(), 2000);
      }
      
      // Find real element at these coordinates
      const elementToClick = document.elementFromPoint(x, y);
      if (elementToClick) {
        (elementToClick as HTMLElement).click();
        return true;
      }
      
      return false;
    }, row, col, visible);
  };

  // Get element at grid coordinates
  page.getElementAtGridCoord = async (row: number, col: number) => {
    return await page.evaluate((row, col) => {
      const gridContainer = document.getElementById('puppeteer-invisible-grid');
      if (!gridContainer) return null;
      
      // Find the cell at coordinates
      const cell = gridContainer.querySelector(`[data-row="${row}"][data-col="${col}"]`);
      if (!cell) return null;
      
      // Get center position of cell
      const rect = (cell as HTMLElement).getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      
      // Find element at coordinates
      const element = document.elementFromPoint(x, y);
      if (!element) return null;
      
      return {
        tagName: element.tagName,
        id: (element as HTMLElement).id,
        className: element.className,
        textContent: (element as HTMLElement).textContent?.trim().substring(0, 100) || '',
        attributes: Array.from((element as HTMLElement).attributes).map(attr => ({
          name: attr.name,
          value: attr.value
        }))
      };
    }, row, col);
  };

  // Get grid coordinates for element
  page.getGridCoordForElement = async (selector: string) => {
    return await page.evaluate((selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      
      const gridContainer = document.getElementById('puppeteer-invisible-grid');
      if (!gridContainer) return null;
      
      // Get element position
      const elementRect = (element as HTMLElement).getBoundingClientRect();
      const elementCenter = {
        x: elementRect.left + elementRect.width / 2,
        y: elementRect.top + elementRect.height / 2
      };
      
      // Find closest grid cell
      let closestCell = null;
      let closestDistance = Infinity;
      
      const cells = gridContainer.querySelectorAll('.grid-cell');
      for (const cell of cells) {
        const cellRect = (cell as HTMLElement).getBoundingClientRect();
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
        return {
          row: parseInt(closestCell.getAttribute('data-row') || '0'),
          col: parseInt(closestCell.getAttribute('data-col') || '0')
        };
      }
      
      return null;
    }, selector);
  };

  // Toggle grid visibility (for debugging)
  page.toggleGridVisibility = async (visible = true, labeled = true) => {
    return await page.evaluate((visible, labeled) => {
      const grid = document.getElementById('puppeteer-invisible-grid');
      if (!grid) return false;
      
      if (visible) {
        grid.style.opacity = '0.3';
        grid.style.backgroundColor = 'rgba(0,0,255,0.05)';
        grid.style.zIndex = '10000';
        
        // Style cells
        const cells = grid.querySelectorAll('.grid-cell');
        cells.forEach(cell => {
          (cell as HTMLElement).style.border = '1px dashed rgba(0,0,0,0.2)';
          
          if (labeled) {
            const row = cell.getAttribute('data-row');
            const col = cell.getAttribute('data-col');
            cell.textContent = `${row},${col}`;
            (cell as HTMLElement).style.display = 'flex';
            (cell as HTMLElement).style.justifyContent = 'center';
            (cell as HTMLElement).style.alignItems = 'center';
            (cell as HTMLElement).style.fontSize = '10px';
            (cell as HTMLElement).style.color = 'rgba(0,0,0,0.5)';
          }
        });
      } else {
        grid.style.opacity = '0';
        grid.style.backgroundColor = 'transparent';
        grid.style.zIndex = '-1';
        
        // Hide cells
        const cells = grid.querySelectorAll('.grid-cell');
        cells.forEach(cell => {
          (cell as HTMLElement).style.border = '0';
          cell.textContent = '';
        });
      }
      
      return true;
    }, visible, labeled);
  };

  // Get suppressed dialogs from the page
  page.getSuppressedDialogs = async () => {
    return await page.evaluate(() => {
      return (window as any)._suppressedDialogs || [];
    });
  };

  // Auto-initialize grid on page load
  page.on('load', async () => {
    await page.createInvisibleGrid();
  });
  
  return page;
}

// Define the tools once to avoid repetition
const TOOLS: Tool[] = [
  {
    name: "puppeteer_navigate",
    description: "Navigate to a URL",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
      },
      required: ["url"],
    },
  },
  {
    name: "puppeteer_screenshot",
    description: "Take a screenshot of the current page or a specific element",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name for the screenshot" },
        selector: { type: "string", description: "CSS selector for element to screenshot" },
        width: { type: "number", description: "Width in pixels (default: 800)" },
        height: { type: "number", description: "Height in pixels (default: 600)" },
      },
      required: ["name"],
    },
  },
  {
    name: "puppeteer_click",
    description: "Click an element on the page",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector for element to click" },
      },
      required: ["selector"],
    },
  },
  {
    name: "puppeteer_fill",
    description: "Fill out an input field",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector for input field" },
        value: { type: "string", description: "Value to fill" },
      },
      required: ["selector", "value"],
    },
  },
  {
    name: "puppeteer_select",
    description: "Select an element on the page with Select tag",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector for element to select" },
        value: { type: "string", description: "Value to select" },
      },
      required: ["selector", "value"],
    },
  },
  {
    name: "puppeteer_hover",
    description: "Hover an element on the page",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector for element to hover" },
      },
      required: ["selector"],
    },
  },
  {
    name: "puppeteer_evaluate",
    description: "Execute JavaScript in the browser console",
    inputSchema: {
      type: "object",
      properties: {
        script: { type: "string", description: "JavaScript code to execute" },
      },
      required: ["script"],
    },
  },
  // New tools for tab management
  {
    name: "puppeteer_create_tab",
    description: "Create a new browser tab",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to navigate to in the new tab (optional)" },
        active: { type: "boolean", description: "Whether to switch to the new tab (default: false)" },
        title: { type: "string", description: "Custom title for the tab (optional)" },
      },
      required: [],
    },
  },
  {
    name: "puppeteer_switch_tab",
    description: "Switch to a different browser tab",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "string", description: "ID of the tab to switch to" },
      },
      required: ["tabId"],
    },
  },
  {
    name: "puppeteer_list_tabs",
    description: "List all open browser tabs",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "puppeteer_close_tab",
    description: "Close a browser tab",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "string", description: "ID of the tab to close" },
      },
      required: ["tabId"],
    },
  },
  // Grid navigation tools
  {
    name: "puppeteer_click_grid",
    description: "Click at specific grid coordinates",
    inputSchema: {
      type: "object",
      properties: {
        row: { type: "number", description: "Grid row coordinate" },
        col: { type: "number", description: "Grid column coordinate" },
        visible: { type: "boolean", description: "Show visual feedback of the click (default: false)" },
      },
      required: ["row", "col"],
    },
  },
  {
    name: "puppeteer_get_element_at_grid",
    description: "Get information about element at specific grid coordinates",
    inputSchema: {
      type: "object",
      properties: {
        row: { type: "number", description: "Grid row coordinate" },
        col: { type: "number", description: "Grid column coordinate" },
      },
      required: ["row", "col"],
    },
  },
  {
    name: "puppeteer_toggle_grid",
    description: "Toggle grid visibility (for debugging)",
    inputSchema: {
      type: "object",
      properties: {
        visible: { type: "boolean", description: "Whether grid should be visible (default: true)" },
        labeled: { type: "boolean", description: "Show coordinate labels in grid cells (default: true)" },
      },
      required: [],
    },
  },
  {
    name: "puppeteer_get_suppressed_dialogs",
    description: "Get a list of suppressed dialogs (alerts, confirms, prompts)",
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
const consoleLogs: string[] = [];
const screenshots = new Map<string, string>();

async function ensureBrowser() {
  if (!browser) {
    const npx_args = { headless: false }
    const docker_args = { headless: true, args: ["--no-sandbox", "--single-process", "--no-zygote"] }
    browser = await puppeteer.launch(process.env.DOCKER_CONTAINER ? docker_args : npx_args);
    
    // Initialize tab manager
    tabManager = new TabManager(browser);
    
    // Get the initial page that Puppeteer creates
    const pages = await browser.pages();
    const initialPage = pages[0];
    
    // Enhance this page with grid capabilities
    await enhancePageWithGrid(initialPage);
    
    // Initialize tab management with this page
    await tabManager.initializeWithFirstPage(initialPage);
    
    // Set up console logging
    initialPage.on("console", (msg) => {
      const logEntry = `[${msg.type()}] ${msg.text()}`;
      consoleLogs.push(logEntry);
      server.notification({
        method: "notifications/resources/updated",
        params: { uri: "console://logs" },
      });
    });
  }
  
  // Return the active page from tab manager
  return tabManager!.getActivePage()!;
}

declare global {
  interface Window {
    mcpHelper: {
      logs: string[],
      originalConsole: Partial<typeof console>,
    }
    _suppressedDialogs: any[];
    _puppeteerGridDimensions: { rows: number, columns: number };
  }
}

async function handleToolCall(name: string, args: any): Promise<CallToolResult> {
  await ensureBrowser(); // Make sure browser and tab manager are initialized
  
  const currentPage = tabManager!.getActivePage();
  if (!currentPage && !name.startsWith('puppeteer_create_tab') && !name.startsWith('puppeteer_list_tabs')) {
    return {
      content: [{
        type: "text",
        text: "No active browser tab. Please create one using puppeteer_create_tab.",
      }],
      isError: true,
    };
  }

  switch (name) {
    case "puppeteer_navigate":
      await currentPage!.goto(args.url);
      return {
        content: [{
          type: "text",
          text: `Navigated to ${args.url}`,
        }],
        isError: false,
      };

    case "puppeteer_screenshot": {
      const width = args.width ?? 800;
      const height = args.height ?? 600;
      await currentPage!.setViewport({ width, height });

      const screenshot = await (args.selector ?
        (await currentPage!.$(args.selector))?.screenshot({ encoding: "base64" }) :
        currentPage!.screenshot({ encoding: "base64", fullPage: false }));

      if (!screenshot) {
        return {
          content: [{
            type: "text",
            text: args.selector ? `Element not found: ${args.selector}` : "Screenshot failed",
          }],
          isError: true,
        };
      }
      
    case "puppeteer_close_tab":
      try {
        await tabManager!.closeTab(args.tabId);
        return {
          content: [{
            type: "text",
            text: `Closed tab: ${args.tabId}`,
          }],
          isError: false,
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Failed to close tab: ${(error as Error).message}`,
          }],
          isError: true,
        };
      }
      
    // Grid navigation tools
    case "puppeteer_click_grid":
      try {
        const result = await currentPage!.clickAtGridCoord(args.row, args.col, {
          visible: args.visible ?? false
        });
        return {
          content: [{
            type: "text",
            text: result 
              ? `Clicked at grid coordinates (${args.row}, ${args.col})` 
              : `No element found at grid coordinates (${args.row}, ${args.col})`,
          }],
          isError: !result,
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Failed to click at grid coordinates: ${(error as Error).message}`,
          }],
          isError: true,
        };
      }
      
    case "puppeteer_get_element_at_grid":
      try {
        const element = await currentPage!.getElementAtGridCoord(args.row, args.col);
        if (!element) {
          return {
            content: [{
              type: "text",
              text: `No element found at grid coordinates (${args.row}, ${args.col})`,
            }],
            isError: true,
          };
        }
        return {
          content: [{
            type: "text",
            text: `Element at grid coordinates (${args.row}, ${args.col}):\n${JSON.stringify(element, null, 2)}`,
          }],
          isError: false,
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Failed to get element at grid coordinates: ${(error as Error).message}`,
          }],
          isError: true,
        };
      }
      
    case "puppeteer_toggle_grid":
      try {
        const visible = args.visible !== undefined ? args.visible : true;
        const labeled = args.labeled !== undefined ? args.labeled : true;
        await currentPage!.toggleGridVisibility(visible, labeled);
        return {
          content: [{
            type: "text",
            text: `Grid visibility ${visible ? 'enabled' : 'disabled'}${visible && labeled ? ' with labels' : ''}`,
          }],
          isError: false,
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Failed to toggle grid visibility: ${(error as Error).message}`,
          }],
          isError: true,
        };
      }
      
    case "puppeteer_get_suppressed_dialogs":
      try {
        const dialogs = await currentPage!.getSuppressedDialogs();
        return {
          content: [{
            type: "text",
            text: `Suppressed dialogs:\n${JSON.stringify(dialogs, null, 2)}`,
          }],
          isError: false,
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Failed to get suppressed dialogs: ${(error as Error).message}`,
          }],
          isError: true,
        };
      }};
      }

      screenshots.set(args.name, screenshot as string);
      server.notification({
        method: "notifications/resources/list_changed",
      });

      return {
        content: [
          {
            type: "text",
            text: `Screenshot '${args.name}' taken at ${width}x${height}`,
          } as TextContent,
          {
            type: "image",
            data: screenshot,
            mimeType: "image/png",
          } as ImageContent,
        ],
        isError: false,
      };
    }

    case "puppeteer_click":
      try {
        await currentPage!.click(args.selector);
        return {
          content: [{
            type: "text",
            text: `Clicked: ${args.selector}`,
          }],
          isError: false,
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Failed to click ${args.selector}: ${(error as Error).message}`,
          }],
          isError: true,
        };
      }

    case "puppeteer_fill":
      try {
        await currentPage!.waitForSelector(args.selector);
        await currentPage!.type(args.selector, args.value);
        return {
          content: [{
            type: "text",
            text: `Filled ${args.selector} with: ${args.value}`,
          }],
          isError: false,
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Failed to fill ${args.selector}: ${(error as Error).message}`,
          }],
          isError: true,
        };
      }

    case "puppeteer_select":
      try {
        await currentPage!.waitForSelector(args.selector);
        await currentPage!.select(args.selector, args.value);
        return {
          content: [{
            type: "text",
            text: `Selected ${args.selector} with: ${args.value}`,
          }],
          isError: false,
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Failed to select ${args.selector}: ${(error as Error).message}`,
          }],
          isError: true,
        };
      }

    case "puppeteer_hover":
      try {
        await currentPage!.waitForSelector(args.selector);
        await currentPage!.hover(args.selector);
        return {
          content: [{
            type: "text",
            text: `Hovered ${args.selector}`,
          }],
          isError: false,
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Failed to hover ${args.selector}: ${(error as Error).message}`,
          }],
          isError: true,
        };
      }

    case "puppeteer_evaluate":
      try {
        await currentPage!.evaluate(() => {
          window.mcpHelper = {
            logs: [],
            originalConsole: { ...console },
          };

          ['log', 'info', 'warn', 'error'].forEach(method => {
            (console as any)[method] = (...args: any[]) => {
              window.mcpHelper.logs.push(`[${method}] ${args.join(' ')}`);
              (window.mcpHelper.originalConsole as any)[method](...args);
            };
          });
        });

        const result = await currentPage!.evaluate(args.script);

        const logs = await currentPage!.evaluate(() => {
          Object.assign(console, window.mcpHelper.originalConsole);
          const logs = window.mcpHelper.logs;
          delete (window as any).mcpHelper;
          return logs;
        });

        return {
          content: [
            {
              type: "text",
              text: `Execution result:\n${JSON.stringify(result, null, 2)}\n\nConsole output:\n${logs.join('\n')}`,
            },
          ],
          isError: false,
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Script execution failed: ${(error as Error).message}`,
          }],
          isError: true,
        };
      }
      
    // Tab management tools
    case "puppeteer_create_tab":
      try {
        const { tabId, page } = await tabManager!.createTab(args.url, {
          active: args.active ?? false,
          title: args.title
        });
        
        // Enhance the new page with grid capabilities
        await enhancePageWithGrid(page);
        
        // Set up console logging for this page
        page.on("console", (msg) => {
          const logEntry = `[Tab ${tabId}][${msg.type()}] ${msg.text()}`;
          consoleLogs.push(logEntry);
          server.notification({
            method: "notifications/resources/updated",
            params: { uri: "console://logs" },
          });
        });
        
        return {
          content: [{
            type: "text",
            text: `Created new tab with ID: ${tabId}${args.url ? `, navigated to ${args.url}` : ''}${args.active ? ', and switched to it' : ''}`,
          }],
          isError: false,
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Failed to create tab: ${(error as Error).message}`,
          }],
          isError: true,
        };
      }
      
    case "puppeteer_switch_tab":
      try {
        await tabManager!.switchTab(args.tabId);
        return {
          content: [{
            type: "text",
            text: `Switched to tab: ${args.tabId}`,
          }],
          isError: false,
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Failed to switch to tab: ${(error as Error).message}`,
          }],
          isError: true,
        };
      }
      
    case "puppeteer_list_tabs":
      try {
        const tabs = await tabManager!.getAllTabs();
        return {
          content: [{
            type: "text",
            text: `Open tabs:\n${JSON.stringify(tabs, null, 2)}`,
          }],
          isError: false,
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Failed to list tabs: ${(error as Error).message}`,
          }],
          isError: true,
const server = new Server(
  {
    name: "example-servers/puppeteer",
    version: "0.1.0",
  },
  {
    capabilities: {
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
      name: "Browser console logs",
    },
    ...Array.from(screenshots.keys()).map(name => ({
      uri: `screenshot://${name}`,
      mimeType: "image/png",
      name: `Screenshot: ${name}`,
    })),
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri.toString();

  if (uri === "console://logs") {
    return {
      contents: [{
        uri,
        mimeType: "text/plain",
        text: consoleLogs.join("\n"),
      }],
    };
  }

  if (uri.startsWith("screenshot://")) {
    const name = uri.split("://")[1];
    const screenshot = screenshots.get(name);
    if (screenshot) {
      return {
        contents: [{
          uri,
          mimeType: "image/png",
          blob: screenshot,
        }],
      };
    }
  }

  throw new Error(`Resource not found: ${uri}`);
});

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) =>
  handleToolCall(request.params.name, request.params.arguments ?? {})
);

async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

runServer().catch(console.error);

process.stdin.on("close", () => {
  console.error("Puppeteer MCP Server closed");
  server.close();
});
