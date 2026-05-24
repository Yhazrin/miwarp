/**
 * Browser Service - MCP Chrome browser automation integration
 *
 * Provides web fetching, browser automation, and session management
 * via the mcp__Claude_in_Chrome__ MCP tools.
 */

import { dbgWarn } from "$lib/utils/debug";

const TAG = "browser";

// eslint-disable @typescript-eslint/no-explicit-any -- MCP external function declarations
// ── MCP Function Declarations ──
declare function mcp__Claude_in_Chrome__list_connected_browsers(): Promise<any[]>;
declare function mcp__Claude_in_Chrome__select_browser(args: Record<string, unknown>): Promise<any>;
declare function mcp__Claude_in_Chrome__switch_browser(): Promise<any>;
declare function mcp__Claude_in_Chrome__tabs_context_mcp(
  args: Record<string, unknown>,
): Promise<any>;
declare function mcp__Claude_in_Chrome__tabs_create_mcp(
  args: Record<string, unknown>,
): Promise<any>;
declare function mcp__Claude_in_Chrome__tabs_close_mcp(args: Record<string, unknown>): Promise<any>;
declare function mcp__Claude_in_Chrome__navigate(args: Record<string, unknown>): Promise<any>;
declare function mcp__Claude_in_Chrome__find(args: Record<string, unknown>): Promise<any>;
declare function mcp__Claude_in_Chrome__computer(args: Record<string, unknown>): Promise<any>;
declare function mcp__Claude_in_Chrome__get_page_text(args: Record<string, unknown>): Promise<any>;
declare function mcp__Claude_in_Chrome__read_page(args: Record<string, unknown>): Promise<any>;
declare function mcp__Claude_in_Chrome__read_network_requests(
  args: Record<string, unknown>,
): Promise<any>;
declare function mcp__Claude_in_Chrome__read_console_messages(
  args: Record<string, unknown>,
): Promise<any>;
declare function mcp__Claude_in_Chrome__resize_window(args: Record<string, unknown>): Promise<any>;
declare function mcp__Claude_in_Chrome__javascript_tool(
  args: Record<string, unknown>,
): Promise<any>;

// ── Error Logging Helper ──

function withErrorLog<T>(label: string, fallback: T, fn: () => Promise<T>): Promise<T> {
  return fn().catch((error) => {
    dbgWarn(TAG, `${label}:`, error);
    return fallback;
  });
}

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

export function listBrowsers(): Promise<BrowserInfo[]> {
  return withErrorLog("listBrowsers", [], async () => {
    const browsers = await mcp__Claude_in_Chrome__list_connected_browsers();
    return browsers.map((b) => ({
      deviceId: b.deviceId,
      displayName: b.displayName,
      platform: b.platform,
      isThisComputer: b.isThisComputer,
    }));
  });
}

export function selectBrowser(deviceId: string): Promise<boolean> {
  return withErrorLog("selectBrowser", false, () =>
    mcp__Claude_in_Chrome__select_browser({ deviceId }).then(() => true),
  );
}

export function switchToBrowser(): Promise<boolean> {
  return withErrorLog("switchToBrowser", false, () =>
    mcp__Claude_in_Chrome__switch_browser().then(() => true),
  );
}

// ── Tab Management ──

export function getTabs(): Promise<TabInfo[]> {
  return withErrorLog("getTabs", [], async () => {
    const context = await mcp__Claude_in_Chrome__tabs_context_mcp({ createIfEmpty: true });
    return context.tabs.map((t: { id: number; url?: string; title?: string }) => ({
      id: t.id,
      url: t.url,
      title: t.title,
    }));
  });
}

export function createTab(): Promise<number | null> {
  return withErrorLog("createTab", null, async () => {
    const tab = await mcp__Claude_in_Chrome__tabs_create_mcp({});
    return tab.id;
  });
}

export function closeTab(tabId: number): Promise<boolean> {
  return withErrorLog("closeTab", false, () =>
    mcp__Claude_in_Chrome__tabs_close_mcp({ tabId }).then(() => true),
  );
}

// ── Navigation ──

export function navigate(url: string, tabId?: number): Promise<NavigationResult> {
  return withErrorLog<NavigationResult>(
    "navigate",
    { url, tabId: tabId ?? 0, success: false },
    async () => {
      const context = await mcp__Claude_in_Chrome__tabs_context_mcp({ createIfEmpty: true });
      const targetTabId = tabId ?? context.tabs[0]?.id ?? 0;
      await mcp__Claude_in_Chrome__navigate({ url, tabId: targetTabId });
      return { url, tabId: targetTabId, success: true };
    },
  );
}

export function goBack(tabId: number): Promise<boolean> {
  return withErrorLog("goBack", false, () =>
    mcp__Claude_in_Chrome__navigate({ url: "back", tabId }).then(() => true),
  );
}

export function goForward(tabId: number): Promise<boolean> {
  return withErrorLog("goForward", false, () =>
    mcp__Claude_in_Chrome__navigate({ url: "forward", tabId }).then(() => true),
  );
}

// ── Element Interaction ──

export function findElement(query: string, tabId: number): Promise<PageElement[]> {
  return withErrorLog("findElement", [], async () => {
    const elements = await mcp__Claude_in_Chrome__find({ query, tabId });
    return elements.map(
      (el: {
        ref: string;
        tag?: string;
        text?: string;
        attributes?: Record<string, string>;
        visible?: boolean;
      }) => ({
        ref: el.ref,
        tag: el.tag ?? "unknown",
        text: el.text,
        attributes: el.attributes ?? {},
        visible: el.visible ?? true,
      }),
    );
  });
}

export function clickElement(coordinate: [number, number], tabId: number): Promise<boolean> {
  return withErrorLog("clickElement", false, () =>
    mcp__Claude_in_Chrome__computer({ action: "left_click", coordinate, tabId }).then(() => true),
  );
}

export function doubleClick(coordinate: [number, number], tabId: number): Promise<boolean> {
  return withErrorLog("doubleClick", false, () =>
    mcp__Claude_in_Chrome__computer({ action: "double_click", coordinate, tabId }).then(() => true),
  );
}

export function rightClick(coordinate: [number, number], tabId: number): Promise<boolean> {
  return withErrorLog("rightClick", false, () =>
    mcp__Claude_in_Chrome__computer({ action: "right_click", coordinate, tabId }).then(() => true),
  );
}

export function typeText(text: string, tabId: number): Promise<boolean> {
  return withErrorLog("typeText", false, () =>
    mcp__Claude_in_Chrome__computer({ action: "type", text, tabId }).then(() => true),
  );
}

export function pressKey(key: string, tabId: number): Promise<boolean> {
  return withErrorLog("pressKey", false, () =>
    mcp__Claude_in_Chrome__computer({ action: "key", text: key, tabId }).then(() => true),
  );
}

export function scroll(
  direction: "up" | "down" | "left" | "right",
  coordinate: [number, number],
  scrollAmount: number = 3,
  tabId?: number,
): Promise<boolean> {
  return withErrorLog("scroll", false, async () => {
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
  });
}

// ── Content Extraction ──

export function getPageContent(tabId: number): Promise<PageContent> {
  return withErrorLog<PageContent>("getPageContent", { text: "", elements: [] }, async () => {
    const text = await mcp__Claude_in_Chrome__get_page_text({ tabId });
    const page = await mcp__Claude_in_Chrome__read_page({ tabId });
    const elements: PageElement[] = page.map(
      (el: { ref?: string; tag?: string; text?: string; attributes?: Record<string, string> }) => ({
        ref: el.ref ?? "",
        tag: el.tag ?? "unknown",
        text: el.text ?? "",
        attributes: el.attributes ?? {},
        visible: true,
      }),
    );
    return { text, elements };
  });
}

export function readAccessibilityTree(tabId: number, depth: number = 15): Promise<string> {
  return withErrorLog("readAccessibilityTree", "", async () => {
    const page = await mcp__Claude_in_Chrome__read_page({ depth, tabId });
    return JSON.stringify(page, null, 2);
  });
}

// ── Screenshot ──

export function takeScreenshot(
  tabId: number,
  saveToDisk: boolean = true,
): Promise<ScreenshotResult | null> {
  return withErrorLog<ScreenshotResult | null>("takeScreenshot", null, async () => {
    const result = await mcp__Claude_in_Chrome__computer({
      action: "screenshot",
      tabId,
      save_to_disk: saveToDisk,
    });
    return result
      ? {
          imageUrl: result.imageUrl ?? "",
          width: result.width ?? 0,
          height: result.height ?? 0,
        }
      : null;
  });
}

export function zoomRegion(
  region: [number, number, number, number],
  tabId: number,
): Promise<ScreenshotResult | null> {
  return withErrorLog<ScreenshotResult | null>("zoomRegion", null, async () => {
    const result = await mcp__Claude_in_Chrome__computer({
      action: "zoom",
      region,
      tabId,
      save_to_disk: true,
    });
    return result
      ? {
          imageUrl: result.imageUrl ?? "",
          width: result.width ?? 0,
          height: result.height ?? 0,
        }
      : null;
  });
}

// ── Network & Console ──

export function getNetworkRequests(
  urlPattern?: string,
  tabId?: number,
): Promise<Array<{ url: string; method: string; status: number }>> {
  return withErrorLog("getNetworkRequests", [], async () => {
    const context = await mcp__Claude_in_Chrome__tabs_context_mcp({});
    const targetTabId = tabId ?? context.tabs[0]?.id ?? 0;
    const requests = await mcp__Claude_in_Chrome__read_network_requests({
      tabId: targetTabId,
      urlPattern,
    });
    return requests.map((req: { url?: string; method?: string; status?: number }) => ({
      url: req.url ?? "",
      method: req.method ?? "GET",
      status: req.status ?? 0,
    }));
  });
}

export function getConsoleMessages(
  pattern?: string,
  onlyErrors: boolean = false,
  tabId?: number,
): Promise<string[]> {
  return withErrorLog("getConsoleMessages", [], async () => {
    const context = await mcp__Claude_in_Chrome__tabs_context_mcp({});
    const targetTabId = tabId ?? context.tabs[0]?.id ?? 0;
    return mcp__Claude_in_Chrome__read_console_messages({
      tabId: targetTabId,
      pattern,
      onlyErrors,
    });
  });
}

// ── Web Fetch (Alternative to MCP WebFetch) ──

export function fetchUrl(url: string): Promise<{
  content: string;
  statusCode: number;
  headers: Record<string, string>;
} | null> {
  return withErrorLog("fetchUrl", null, async () => {
    const response = await fetch(url);
    const content = await response.text();
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    return { content, statusCode: response.status, headers };
  });
}

// ── Drag & Drop ──

export function dragDrop(
  start: [number, number],
  end: [number, number],
  tabId: number,
): Promise<boolean> {
  return withErrorLog("dragDrop", false, () =>
    mcp__Claude_in_Chrome__computer({
      action: "left_click_drag",
      coordinate: end,
      start_coordinate: start,
      tabId,
    }).then(() => true),
  );
}

// ── Hover ──

export function hover(coordinate: [number, number], tabId: number): Promise<boolean> {
  return withErrorLog("hover", false, () =>
    mcp__Claude_in_Chrome__computer({ action: "hover", coordinate, tabId }).then(() => true),
  );
}

// ── Window Management ──

export function resizeWindow(width: number, height: number, tabId?: number): Promise<boolean> {
  return withErrorLog("resizeWindow", false, async () => {
    const context = await mcp__Claude_in_Chrome__tabs_context_mcp({});
    const targetTabId = tabId ?? context.tabs[0]?.id ?? 0;
    await mcp__Claude_in_Chrome__resize_window({ width, height, tabId: targetTabId });
    return true;
  });
}

// ── JavaScript Execution ──

export function executeJavaScript(code: string, tabId: number): Promise<unknown> {
  return withErrorLog("executeJavaScript", null, () =>
    mcp__Claude_in_Chrome__javascript_tool({ action: "javascript_exec", text: code, tabId }),
  );
}
