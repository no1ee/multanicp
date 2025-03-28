# Puppeteer

A Model Context Protocol server that provides browser automation capabilities using Puppeteer. This enhanced version adds alert suppression, invisible grid system, and tab management features. This server enables LLMs to interact with web pages, take screenshots, and execute JavaScript in a real browser environment.

## Components

### Tools

#### Basic Browser Interaction
- **puppeteer_navigate**
  - Navigate to any URL in the browser
  - Input: `url` (string)

- **puppeteer_screenshot**
  - Capture screenshots of the entire page or specific elements
  - Inputs:
    - `name` (string, required): Name for the screenshot
    - `selector` (string, optional): CSS selector for element to screenshot
    - `width` (number, optional, default: 800): Screenshot width
    - `height` (number, optional, default: 600): Screenshot height

- **puppeteer_click**
  - Click elements on the page
  - Input: `selector` (string): CSS selector for element to click

- **puppeteer_hover**
  - Hover elements on the page
  - Input: `selector` (string): CSS selector for element to hover

- **puppeteer_fill**
  - Fill out input fields
  - Inputs:
    - `selector` (string): CSS selector for input field
    - `value` (string): Value to fill

- **puppeteer_select**
  - Select an element with SELECT tag
  - Inputs:
    - `selector` (string): CSS selector for element to select
    - `value` (string): Value to select

- **puppeteer_evaluate**
  - Execute JavaScript in the browser console
  - Input: `script` (string): JavaScript code to execute

#### Tab Management
- **puppeteer_create_tab**
  - Create a new browser tab
  - Inputs:
    - `url` (string, optional): URL to navigate to in the new tab
    - `active` (boolean, optional, default: false): Whether to switch to the new tab
    - `title` (string, optional): Custom title for the tab

- **puppeteer_switch_tab**
  - Switch to a different browser tab
  - Input: `tabId` (string): ID of the tab to switch to

- **puppeteer_list_tabs**
  - List all open browser tabs
  - No inputs required

- **puppeteer_close_tab**
  - Close a browser tab
  - Input: `tabId` (string): ID of the tab to close

#### Grid Navigation System
- **puppeteer_click_grid**
  - Click at specific grid coordinates
  - Inputs:
    - `row` (number): Grid row coordinate
    - `col` (number): Grid column coordinate
    - `visible` (boolean, optional, default: false): Show visual feedback of the click

- **puppeteer_get_element_at_grid**
  - Get information about element at specific grid coordinates
  - Inputs:
    - `row` (number): Grid row coordinate
    - `col` (number): Grid column coordinate

- **puppeteer_toggle_grid**
  - Toggle grid visibility (for debugging)
  - Inputs:
    - `visible` (boolean, optional, default: true): Whether grid should be visible
    - `labeled` (boolean, optional, default: true): Show coordinate labels in grid cells

#### Alert Handling
- **puppeteer_get_suppressed_dialogs**
  - Get a list of suppressed dialogs (alerts, confirms, prompts)
  - No inputs required

### Resources

The server provides access to two types of resources:

1. **Console Logs** (`console://logs`)
   - Browser console output in text format
   - Includes all console messages from the browser

2. **Screenshots** (`screenshot://<name>`)
   - PNG images of captured screenshots
   - Accessible via the screenshot name specified during capture

## Key Features

- Browser automation
- Multi-tab support
- Invisible grid navigation system 
- Automatic alert suppression
- Console log monitoring
- Screenshot capabilities
- JavaScript execution
- Basic web interaction (navigation, clicking, form filling)

## Enhanced Features

### Alert Suppression
All browser alerts, confirms, and prompts are automatically suppressed without interrupting script execution. This ensures smooth automation even on pages with intrusive dialogs. You can retrieve a log of all suppressed dialogs.

### Invisible Grid System
A coordinate-based navigation system that overlays the page with an invisible grid. This enables clicking and interacting with elements based on their position on the screen rather than DOM selectors. The grid:
- Is fixed to the viewport, maintaining accuracy during scrolling
- Can be toggled visible for debugging purposes
- Provides coordinate-to-element and element-to-coordinate mapping
- Allows for precise spatial navigation

### Tab Management
Full support for working with multiple browser tabs, allowing:
- Creating new tabs with custom options
- Switching between tabs
- Listing all open tabs with metadata
- Closing tabs

## Configuration to use Puppeteer Server
Here's the Claude Desktop configuration to use the Puppeter server:

### Docker

**NOTE** The docker implementation will use headless chromium, where as the NPX version will open a browser window.

```json
{
  "mcpServers": {
    "puppeteer": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "--init", "-e", "DOCKER_CONTAINER=true", "mcp/puppeteer"]
    }
  }
}
```

### NPX

```json
{
  "mcpServers": {
    "puppeteer": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-puppeteer"]
    }
  }
}
```

## Build

Docker build:

```bash
docker build -t mcp/puppeteer -f src/puppeteer/Dockerfile .
```

## License

This MCP server is licensed under the MIT License. This means you are free to use, modify, and distribute the software, subject to the terms and conditions of the MIT License. For more details, please see the LICENSE file in the project repository.
