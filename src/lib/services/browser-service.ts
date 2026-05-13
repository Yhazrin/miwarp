/**
 * Browser Service - MCP Chrome browser automation integration
 *
 * Provides web fetching, browser automation, and session management
 * via the mcp__Claude_in_Chrome__ MCP tools.
 */

// ── Types ──

export interface BrowserInfo {
  deviceId: string;
  displayName: string;
  platform: string;
  isThisComputer: boolean;
}

export interface TabInfo {
  id: number;
  url?: string;
  title?: string;
}

export interface PageContent {
  text: string;
  elements: PageElement[];
}

export interface PageElement {
  ref: string;
  tag: string;
  text?: string;
  attributes: Record<string, string>;
  visible: boolean;
}

export interface ScreenshotResult {
  imageUrl: string;
  width: number;
  height: number;
}

export interface NavigationResult {
  url: string;
  tabId: number;
  success: boolean;
}

// ── Browser Connection ──

export async function listBrowsers(): Promise<BrowserInfo[]> {
  try {
    const browsers = await mcp__Claude_in_Chrome__list_connected_browsers();
    return browsers.map((b) => ({
      deviceId: b.deviceId,
      displayName: b.displayName,
      platform: b.platform,
      isThisComputer: b.isThisComputer,
    }));
  } catch (error) {
    console.error("Failed to list browsers:", error);
    return [];
  }
}

export async function selectBrowser(deviceId: string): Promise<boolean> {
  try {
    await mcp__Claude_in_Chrome__select_browser({ deviceId });
    return true;
  } catch (error) {
    console.error("Failed to select browser:", error);
    return false;
  }
}

export async function switchToBrowser(): Promise<boolean> {
  try {
    await mcp__Claude_in_Chrome__switch_browser();
    return true;
  } catch (error) {
    console.error("Failed to switch browser:", error);
    return false;
  }
}

// ── Tab Management ──

export async function getTabs(): Promise<TabInfo[]> {
  try {
    const context = await mcp__Claude_in_Chrome__tabs_context_mcp({ createIfEmpty: true });
    return context.tabs.map((t) => ({
      id: t.id,
      url: t.url,
      title: t.title,
    }));
  } catch (error) {
    console.error("Failed to get tabs:", error);
    return [];
  }
}

export async function createTab(): Promise<number | null> {
  try {
    const tab = await mcp__Claude_in_Chrome__tabs_create_mcp({});
    return tab.id;
  } catch (error) {
    console.error("Failed to create tab:", error);
    return null;
  }
}

export async function closeTab(tabId: number): Promise<boolean> {
  try {
    await mcp__Claude_in_Chrome__tabs_close_mcp({ tabId });
    return true;
  } catch (error) {
    console.error("Failed to close tab:", error);
    return false;
  }
}

// ── Navigation ──

export async function navigate(url: string, tabId?: number): Promise<NavigationResult> {
  try {
    const context = await mcp__Claude_in_Chrome__tabs_context_mcp({ createIfEmpty: true });
    const targetTabId = tabId ?? context.tabs[0]?.id ?? 0;

    await mcp__Claude_in_Chrome__navigate({
      url,
      tabId: targetTabId,
    });

    return {
      url,
      tabId: targetTabId,
      success: true,
    };
  } catch (error) {
    console.error("Navigation failed:", error);
    return {
      url,
      tabId: tabId ?? 0,
      success: false,
    };
  }
}

export async function goBack(tabId: number): Promise<boolean> {
  try {
    await mcp__Claude_in_Chrome__navigate({ url: "back", tabId });
    return true;
  } catch (error) {
    console.error("Go back failed:", error);
    return false;
  }
}

export async function goForward(tabId: number): Promise<boolean> {
  try {
    await mcp__Claude_in_Chrome__navigate({ url: "forward", tabId });
    return true;
  } catch (error) {
    console.error("Go forward failed:", error);
    return false;
  }
}

// ── Element Interaction ──

export async function findElement(query: string, tabId: number): Promise<PageElement[]> {
  try {
    const elements = await mcp__Claude_in_Chrome__find({ query, tabId });
    return elements.map((el) => ({
      ref: el.ref,
      tag: el.tag ?? "unknown",
      text: el.text,
      attributes: el.attributes ?? {},
      visible: el.visible ?? true,
    }));
  } catch (error) {
    console.error("Find element failed:", error);
    return [];
  }
}

export async function clickElement(coordinate: [number, number], tabId: number): Promise<boolean> {
  try {
    await mcp__Claude_in_Chrome__computer({
      action: "left_click",
      coordinate,
      tabId,
    });
    return true;
  } catch (error) {
    console.error("Click failed:", error);
    return false;
  }
}

export async function doubleClick(coordinate: [number, number], tabId: number): Promise<boolean> {
  try {
    await mcp__Claude_in_Chrome__computer({
      action: "double_click",
      coordinate,
      tabId,
    });
    return true;
  } catch (error) {
    console.error("Double click failed:", error);
    return false;
  }
}

export async function rightClick(coordinate: [number, number], tabId: number): Promise<boolean> {
  try {
    await mcp__Claude_in_Chrome__computer({
      action: "right_click",
      coordinate,
      tabId,
    });
    return true;
  } catch (error) {
    console.error("Right click failed:", error);
    return false;
  }
}

export async function typeText(text: string, tabId: number): Promise<boolean> {
  try {
    await mcp__Claude_in_Chrome__computer({
      action: "type",
      text,
      tabId,
    });
    return true;
  } catch (error) {
    console.error("Type text failed:", error);
    return false;
  }
}

export async function pressKey(key: string, tabId: number): Promise<boolean> {
  try {
    await mcp__Claude_in_Chrome__computer({
      action: "key",
      text: key,
      tabId,
    });
    return true;
  } catch (error) {
    console.error("Press key failed:", error);
    return false;
  }
}

export async function scroll(
  direction: "up" | "down" | "left" | "right",
  coordinate: [number, number],
  scrollAmount: number = 3,
  tabId?: number,
): Promise<boolean> {
  try {
    const context = await mcp__Claude_in_Chrome__tabs_context_mcp({});
    const targetTabId = tabId ?? context.tabs[0]?.id ?? 0;

    await mcp__Claude_in_Chrome__computer({
      action: "scroll",
      coordinate,
      scroll_direction: direction,
      scroll_amount: scrollAmount,
      tabId: targetTabId,
    });
    return true;
  } catch (error) {
    console.error("Scroll failed:", error);
    return false;
  }
}

// ── Content Extraction ──

export async function getPageContent(tabId: number): Promise<PageContent> {
  try {
    const text = await mcp__Claude_in_Chrome__get_page_text({ tabId });
    const page = await mcp__Claude_in_Chrome__read_page({ tabId });

    const elements: PageElement[] = page.map((el) => ({
      ref: el.ref ?? "",
      tag: el.tag ?? "unknown",
      text: el.text ?? "",
      attributes: el.attributes ?? {},
      visible: true,
    }));

    return { text, elements };
  } catch (error) {
    console.error("Failed to get page content:", error);
    return { text: "", elements: [] };
  }
}

export async function readAccessibilityTree(tabId: number, depth: number = 15): Promise<string> {
  try {
    const page = await mcp__Claude_in_Chrome__read_page({ depth, tabId });
    return JSON.stringify(page, null, 2);
  } catch (error) {
    console.error("Failed to read accessibility tree:", error);
    return "";
  }
}

// ── Screenshot ──

export async function takeScreenshot(
  tabId: number,
  saveToDisk: boolean = true,
): Promise<ScreenshotResult | null> {
  try {
    const result = await mcp__Claude_in_Chrome__computer({
      action: "screenshot",
      tabId,
      save_to_disk: saveToDisk,
    });

    if (result) {
      return {
        imageUrl: result.imageUrl ?? "",
        width: result.width ?? 0,
        height: result.height ?? 0,
      };
    }
    return null;
  } catch (error) {
    console.error("Screenshot failed:", error);
    return null;
  }
}

export async function zoomRegion(
  region: [number, number, number, number],
  tabId: number,
): Promise<ScreenshotResult | null> {
  try {
    const result = await mcp__Claude_in_Chrome__computer({
      action: "zoom",
      region,
      tabId,
      save_to_disk: true,
    });

    if (result) {
      return {
        imageUrl: result.imageUrl ?? "",
        width: result.width ?? 0,
        height: result.height ?? 0,
      };
    }
    return null;
  } catch (error) {
    console.error("Zoom failed:", error);
    return null;
  }
}

// ── Network & Console ──

export async function getNetworkRequests(
  urlPattern?: string,
  tabId?: number,
): Promise<Array<{ url: string; method: string; status: number }>> {
  try {
    const context = await mcp__Claude_in_Chrome__tabs_context_mcp({});
    const targetTabId = tabId ?? context.tabs[0]?.id ?? 0;

    const requests = await mcp__Claude_in_Chrome__read_network_requests({
      tabId: targetTabId,
      urlPattern,
    });

    return requests.map((req) => ({
      url: req.url ?? "",
      method: req.method ?? "GET",
      status: req.status ?? 0,
    }));
  } catch (error) {
    console.error("Failed to get network requests:", error);
    return [];
  }
}

export async function getConsoleMessages(
  pattern?: string,
  onlyErrors: boolean = false,
  tabId?: number,
): Promise<string[]> {
  try {
    const context = await mcp__Claude_in_Chrome__tabs_context_mcp({});
    const targetTabId = tabId ?? context.tabs[0]?.id ?? 0;

    const messages = await mcp__Claude_in_Chrome__read_console_messages({
      tabId: targetTabId,
      pattern,
      onlyErrors,
    });

    return messages;
  } catch (error) {
    console.error("Failed to get console messages:", error);
    return [];
  }
}

// ── Web Fetch (Alternative to MCP WebFetch) ──

export async function fetchUrl(url: string): Promise<{
  content: string;
  statusCode: number;
  headers: Record<string, string>;
} | null> {
  try {
    const response = await fetch(url);
    const content = await response.text();
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    return {
      content,
      statusCode: response.status,
      headers,
    };
  } catch (error) {
    console.error("Fetch failed:", error);
    return null;
  }
}

// ── Drag & Drop ──

export async function dragDrop(
  start: [number, number],
  end: [number, number],
  tabId: number,
): Promise<boolean> {
  try {
    await mcp__Claude_in_Chrome__computer({
      action: "left_click_drag",
      coordinate: end,
      start_coordinate: start,
      tabId,
    });
    return true;
  } catch (error) {
    console.error("Drag failed:", error);
    return false;
  }
}

// ── Hover ──

export async function hover(coordinate: [number, number], tabId: number): Promise<boolean> {
  try {
    await mcp__Claude_in_Chrome__computer({
      action: "hover",
      coordinate,
      tabId,
    });
    return true;
  } catch (error) {
    console.error("Hover failed:", error);
    return false;
  }
}

// ── Window Management ──

export async function resizeWindow(
  width: number,
  height: number,
  tabId?: number,
): Promise<boolean> {
  try {
    const context = await mcp__Claude_in_Chrome__tabs_context_mcp({});
    const targetTabId = tabId ?? context.tabs[0]?.id ?? 0;

    await mcp__Claude_in_Chrome__resize_window({
      width,
      height,
      tabId: targetTabId,
    });
    return true;
  } catch (error) {
    console.error("Resize window failed:", error);
    return false;
  }
}

// ── JavaScript Execution ──

export async function executeJavaScript(code: string, tabId: number): Promise<unknown> {
  try {
    const result = await mcp__Claude_in_Chrome__javascript_tool({
      action: "javascript_exec",
      text: code,
      tabId,
    });
    return result;
  } catch (error) {
    console.error("JavaScript execution failed:", error);
    return null;
  }
}
