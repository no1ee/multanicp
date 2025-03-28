# Usage Examples for Enhanced Puppeteer MCP

This document provides examples of how to use the enhanced features of the Puppeteer MCP server, including the invisible grid system, alert suppression, and tab management.

## Basic Setup

First, make sure you have the Puppeteer MCP server running:

```bash
# Using NPX
npx -y @modelcontextprotocol/server-puppeteer

# Or using Docker
docker run -i --rm --init -e DOCKER_CONTAINER=true mcp/puppeteer
```

## Tab Management Examples

### Creating and Managing Tabs

```javascript
// Create a new tab and navigate to a URL
const result1 = await callTool("puppeteer_create_tab", {
  url: "https://example.com",
  active: true
});
// Result: Created new tab with ID: tab_2, navigated to https://example.com, and switched to it

// List all open tabs
const result2 = await callTool("puppeteer_list_tabs", {});
// Result: Shows all open tabs with their IDs, URLs, and active status

// Switch to a specific tab
const result3 = await callTool("puppeteer_switch_tab", {
  tabId: "tab_1"
});
// Result: Switched to tab: tab_1

// Close a tab
const result4 = await callTool("puppeteer_close_tab", {
  tabId: "tab_2"
});
// Result: Closed tab: tab_2
```

## Grid Navigation Examples

### Using the Invisible Grid System

```javascript
// Navigate to a page
await callTool("puppeteer_navigate", {
  url: "https://example.com"
});

// Click on an element using grid coordinates
await callTool("puppeteer_click_grid", {
  row: 5,
  col: 3
});
// Result: Clicked at grid coordinates (5, 3)

// Get information about an element at specific coordinates
const result = await callTool("puppeteer_get_element_at_grid", {
  row: 10,
  col: 8
});
// Result: Returns details about the element at that position

// For debugging: Make the grid visible temporarily
await callTool("puppeteer_toggle_grid", {
  visible: true,
  labeled: true
});
// Result: Grid visibility enabled with labels

// Hide the grid again
await callTool("puppeteer_toggle_grid", {
  visible: false
});
// Result: Grid visibility disabled
```

## Alert Suppression Examples

### Handling Alerts Automatically

```javascript
// Navigate to a page with alerts
await callTool("puppeteer_navigate", {
  url: "https://example.com"
});

// Execute JavaScript that would trigger alerts
await callTool("puppeteer_evaluate", {
  script: `
    alert("This alert will be suppressed");
    const userConfirmed = confirm("This confirm will return true automatically");
    const userInput = prompt("This prompt will return 'Automated response'");
    
    document.body.innerHTML += '<p>Confirm result: ' + userConfirmed + '</p>';
    document.body.innerHTML += '<p>Prompt input: ' + userInput + '</p>';
  `
});

// Check what alerts were suppressed
const suppressedDialogs = await callTool("puppeteer_get_suppressed_dialogs", {});
// Result: Shows a list of all suppressed dialogs with their types, messages, and timestamps
```

## Combined Examples

### Multi-Tab Workflow

```javascript
// Create first tab for research
await callTool("puppeteer_create_tab", {
  url: "https://en.wikipedia.org",
  active: true,
  title: "Research Tab"
});

// Create second tab for note-taking
await callTool("puppeteer_create_tab", {
  url: "https://example.com/notes",
  active: false,
  title: "Notes Tab"
});

// In the research tab, search for information
await callTool("puppeteer_fill", {
  selector: "#searchInput",
  value: "Web automation"
});

await callTool("puppeteer_click", {
  selector: "#searchButton"
});

// Take a screenshot of the search results
await callTool("puppeteer_screenshot", {
  name: "search_results"
});

// Switch to the notes tab
await callTool("puppeteer_list_tabs", {});
// Find the tab ID for the Notes Tab

await callTool("puppeteer_switch_tab", {
  tabId: "tab_3" // Use the actual tab ID from the list
});

// Fill in notes using information from research
await callTool("puppeteer_fill", {
  selector: "#note-content",
  value: "Web automation refers to the process of using software tools to control web browsers..."
});
```

### Grid-Based Form Filling

```javascript
// Navigate to a login form
await callTool("puppeteer_navigate", {
  url: "https://example.com/login"
});

// Using grid coordinates to interact with the form
// First, identify where the username field is
await callTool("puppeteer_toggle_grid", { visible: true });
// Visually identify coordinates

// Click on username field
await callTool("puppeteer_click_grid", {
  row: 8,
  col: 5
});

// Type username using standard fill (after clicking)
await callTool("puppeteer_evaluate", {
  script: `document.activeElement.value = "testuser";`
});

// Click on password field
await callTool("puppeteer_click_grid", {
  row: 10,
  col: 5
});

// Type password
await callTool("puppeteer_evaluate", {
  script: `document.activeElement.value = "password123";`
});

// Click login button
await callTool("puppeteer_click_grid", {
  row: 12,
  col: 5
});

// Handle any alerts that might appear (they'll be suppressed automatically)
await callTool("puppeteer_get_suppressed_dialogs", {});
```

## Tips for Effective Usage

1. **Tab Organization**: Name your tabs meaningfully using the `title` parameter when creating them
2. **Grid Debugging**: Use `puppeteer_toggle_grid` with `visible: true` to see the grid during development
3. **Alert Handling**: Regularly check suppressed dialogs when working with forms or interactive pages
4. **Screenshots**: Take screenshots as you navigate to maintain a visual record of the automation
5. **Combining Approaches**: Use traditional selectors when they're reliable, and grid coordinates when the page structure is complex or dynamic

These examples demonstrate the power and flexibility of the enhanced Puppeteer MCP server for complex web automation tasks.
