/**
 * Browser Store - Svelte 5 state management for browser automation
 *
 * Manages browser connections, tabs, and automation state.
 */
import * as browserService from "$lib/services/browser-service";
import type {
  BrowserInfo,
  TabInfo,
  PageContent,
  ScreenshotResult,
} from "$lib/services/browser-service";

// ── State Types ──

export interface BrowserState {
  connected: boolean;
  currentBrowser: BrowserInfo | null;
  browsers: BrowserInfo[];
  tabs: TabInfo[];
  activeTabId: number | null;
  currentUrl: string;
  pageContent: PageContent | null;
  lastScreenshot: ScreenshotResult | null;
  isLoading: boolean;
  error: string | null;
  history: string[];
  historyIndex: number;
}

export type BrowserAction =
  | { type: "CONNECT"; browser: BrowserInfo }
  | { type: "DISCONNECT" }
  | { type: "SET_BROWSERS"; browsers: BrowserInfo[] }
  | { type: "SET_TABS"; tabs: TabInfo[] }
  | { type: "SET_ACTIVE_TAB"; tabId: number }
  | { type: "NAVIGATE"; url: string }
  | { type: "SET_PAGE_CONTENT"; content: PageContent }
  | { type: "SET_SCREENSHOT"; screenshot: ScreenshotResult | null }
  | { type: "SET_LOADING"; loading: boolean }
  | { type: "SET_ERROR"; error: string | null }
  | { type: "GO_BACK" }
  | { type: "GO_FORWARD" }
  | { type: "REFRESH" };

// ── Store Implementation ──

function createBrowserStore() {
  const state = $state<BrowserState>({
    connected: false,
    currentBrowser: null,
    browsers: [],
    tabs: [],
    activeTabId: null,
    currentUrl: "",
    pageContent: null,
    lastScreenshot: null,
    isLoading: false,
    error: null,
    history: [],
    historyIndex: -1,
  });

  // ── Reducers ──

  function dispatch(action: BrowserAction): void {
    switch (action.type) {
      case "CONNECT":
        state.connected = true;
        state.currentBrowser = action.browser;
        break;

      case "DISCONNECT":
        state.connected = false;
        state.currentBrowser = null;
        state.tabs = [];
        state.activeTabId = null;
        state.currentUrl = "";
        state.pageContent = null;
        break;

      case "SET_BROWSERS":
        state.browsers = action.browsers;
        break;

      case "SET_TABS":
        state.tabs = action.tabs;
        break;

      case "SET_ACTIVE_TAB": {
        state.activeTabId = action.tabId;
        // Update current URL from tab info
        const activeTab = state.tabs.find((t) => t.id === action.tabId);
        if (activeTab?.url) {
          state.currentUrl = activeTab.url;
        }
        break;
      }

      case "NAVIGATE":
        // Add to history
        if (state.history[state.historyIndex] !== action.url) {
          state.history = [...state.history.slice(0, state.historyIndex + 1), action.url];
          state.historyIndex = state.history.length - 1;
        }
        state.currentUrl = action.url;
        break;

      case "SET_PAGE_CONTENT":
        state.pageContent = action.content;
        break;

      case "SET_SCREENSHOT":
        state.lastScreenshot = action.screenshot;
        break;

      case "SET_LOADING":
        state.isLoading = action.loading;
        break;

      case "SET_ERROR":
        state.error = action.error;
        break;

      case "GO_BACK":
        if (state.historyIndex > 0) {
          state.historyIndex--;
          state.currentUrl = state.history[state.historyIndex];
        }
        break;

      case "GO_FORWARD":
        if (state.historyIndex < state.history.length - 1) {
          state.historyIndex++;
          state.currentUrl = state.history[state.historyIndex];
        }
        break;

      case "REFRESH":
        // Trigger page reload
        break;
    }
  }

  // ── Actions ──

  async function connect(browser: BrowserInfo): Promise<boolean> {
    dispatch({ type: "SET_LOADING", loading: true });
    dispatch({ type: "SET_ERROR", error: null });

    try {
      const success = await browserService.selectBrowser(browser.deviceId);
      if (success) {
        dispatch({ type: "CONNECT", browser });
        await refreshTabs();
        return true;
      } else {
        dispatch({ type: "SET_ERROR", error: "Failed to connect to browser" });
        return false;
      }
    } catch (error) {
      dispatch({ type: "SET_ERROR", error: String(error) });
      return false;
    } finally {
      dispatch({ type: "SET_LOADING", loading: false });
    }
  }

  async function disconnect(): Promise<void> {
    dispatch({ type: "DISCONNECT" });
  }

  async function refreshBrowsers(): Promise<void> {
    const browsers = await browserService.listBrowsers();
    dispatch({ type: "SET_BROWSERS", browsers });
  }

  async function refreshTabs(): Promise<void> {
    const tabs = await browserService.getTabs();
    dispatch({ type: "SET_TABS", tabs });
    if (tabs.length > 0 && state.activeTabId === null) {
      dispatch({ type: "SET_ACTIVE_TAB", tabId: tabs[0].id });
    }
  }

  async function setActiveTab(tabId: number): Promise<void> {
    dispatch({ type: "SET_ACTIVE_TAB", tabId });
    await loadPageContent();
  }

  async function navigate(url: string): Promise<boolean> {
    if (!state.activeTabId) return false;

    dispatch({ type: "SET_LOADING", loading: true });
    dispatch({ type: "SET_ERROR", error: null });

    try {
      const result = await browserService.navigate(url, state.activeTabId);
      if (result.success) {
        dispatch({ type: "NAVIGATE", url });
        await loadPageContent();
        return true;
      } else {
        dispatch({ type: "SET_ERROR", error: "Navigation failed" });
        return false;
      }
    } catch (error) {
      dispatch({ type: "SET_ERROR", error: String(error) });
      return false;
    } finally {
      dispatch({ type: "SET_LOADING", loading: false });
    }
  }

  async function goBack(): Promise<void> {
    if (!state.activeTabId) return;
    await browserService.goBack(state.activeTabId);
    dispatch({ type: "GO_BACK" });
    await loadPageContent();
  }

  async function goForward(): Promise<void> {
    if (!state.activeTabId) return;
    await browserService.goForward(state.activeTabId);
    dispatch({ type: "GO_FORWARD" });
    await loadPageContent();
  }

  async function refresh(): Promise<void> {
    if (!state.activeTabId) return;
    await loadPageContent();
  }

  async function loadPageContent(): Promise<void> {
    if (!state.activeTabId) return;

    try {
      const content = await browserService.getPageContent(state.activeTabId);
      dispatch({ type: "SET_PAGE_CONTENT", content });
    } catch (error) {
      console.error("Failed to load page content:", error);
    }
  }

  async function takeScreenshot(): Promise<ScreenshotResult | null> {
    if (!state.activeTabId) return null;

    try {
      const result = await browserService.takeScreenshot(state.activeTabId);
      if (result) {
        dispatch({ type: "SET_SCREENSHOT", screenshot: result });
      }
      return result;
    } catch (error) {
      console.error("Screenshot failed:", error);
      return null;
    }
  }

  async function clickAt(coordinate: [number, number]): Promise<boolean> {
    if (!state.activeTabId) return false;
    return browserService.clickElement(coordinate, state.activeTabId);
  }

  async function type(text: string): Promise<boolean> {
    if (!state.activeTabId) return false;
    return browserService.typeText(text, state.activeTabId);
  }

  async function findElements(query: string): Promise<Array<{ ref: string; text?: string }>> {
    if (!state.activeTabId) return [];
    const elements = await browserService.findElement(query, state.activeTabId);
    return elements.map((el) => ({ ref: el.ref, text: el.text }));
  }

  async function executeScript(code: string): Promise<unknown> {
    if (!state.activeTabId) return null;
    return browserService.executeJavaScript(code, state.activeTabId);
  }

  async function getNetworkRequests(): Promise<
    Array<{ url: string; method: string; status: number }>
  > {
    return browserService.getNetworkRequests(undefined, state.activeTabId ?? undefined);
  }

  async function getConsoleMessages(): Promise<string[]> {
    return browserService.getConsoleMessages(undefined, false, state.activeTabId ?? undefined);
  }

  async function createNewTab(): Promise<number | null> {
    const tabId = await browserService.createTab();
    if (tabId !== null) {
      await refreshTabs();
    }
    return tabId;
  }

  async function closeCurrentTab(): Promise<boolean> {
    if (!state.activeTabId) return false;
    const success = await browserService.closeTab(state.activeTabId);
    if (success) {
      await refreshTabs();
    }
    return success;
  }

  return {
    get state() {
      return state;
    },
    connect,
    disconnect,
    refreshBrowsers,
    refreshTabs,
    setActiveTab,
    navigate,
    goBack,
    goForward,
    refresh,
    takeScreenshot,
    clickAt,
    type,
    findElements,
    executeScript,
    getNetworkRequests,
    getConsoleMessages,
    createNewTab,
    closeCurrentTab,
    dispatch,
  };
}

export const browserStore = createBrowserStore();
