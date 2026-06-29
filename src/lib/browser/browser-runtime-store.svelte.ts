/**
 * Browser Runtime Store - Svelte 5 状态管理
 *
 * 管理浏览器运行时的全局状态
 */

export interface BrowserProfile {
  id: string;
  name: string;
  engine: "chrome" | "webview";
  dataDirectory: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface BrowserSession {
  sessionId: string;
  profileId: string;
  engine: string;
  debuggingUrl: string;
  createdAt: string;
  tabs: BrowserTab[];
}

export interface BrowserTab {
  targetId: string;
  url: string;
  title: string;
  attached: boolean;
}

export interface BrowserObservation {
  url: string;
  title: string;
  visibleText: string;
  screenshot: string | null;
  viewport: { width: number; height: number };
  interactiveElements: InteractiveElement[];
}

export interface InteractiveElement {
  refId: string;
  role: string;
  name: string;
  bounds: [number, number, number, number];
}

export type BrowserAction =
  | { type: "Click"; x: number; y: number }
  | { type: "Type"; text: string }
  | { type: "Scroll"; deltaX: number; deltaY: number }
  | { type: "Navigate"; url: string }
  | { type: "GoBack" }
  | { type: "GoForward" }
  | { type: "Refresh" }
  | { type: "Close" };

// 内部状态包装，避免在 $state 中直接使用 const
interface StoreState {
  profiles: BrowserProfile[];
  sessions: BrowserSession[];
  currentSession: BrowserSession | null;
  currentObservation: BrowserObservation | null;
  isLoading: boolean;
  error: string | null;
}

export function createBrowserRuntimeStore() {
  const state = $state<StoreState>({
    profiles: [],
    sessions: [],
    currentSession: null,
    currentObservation: null,
    isLoading: false,
    error: null,
  });

  async function loadProfiles() {
    state.isLoading = true;
    state.error = null;
    try {
      // TODO: 调用Tauri命令
      console.log("[browser] loadProfiles - TODO");
    } catch (e) {
      state.error = String(e);
    } finally {
      state.isLoading = false;
    }
  }

  async function createProfile(name: string, engine: "chrome" | "webview") {
    state.isLoading = true;
    state.error = null;
    try {
      console.log("[browser] createProfile - TODO");
      return null;
    } catch (e) {
      state.error = String(e);
      throw e;
    } finally {
      state.isLoading = false;
    }
  }

  async function launchProfile(profileId: string) {
    state.isLoading = true;
    state.error = null;
    try {
      console.log("[browser] launchProfile - TODO");
      return null;
    } catch (e) {
      state.error = String(e);
      throw e;
    } finally {
      state.isLoading = false;
    }
  }

  async function listTabs(sessionId: string) {
    state.error = null;
    try {
      console.log("[browser] listTabs - TODO");
      return [];
    } catch (e) {
      state.error = String(e);
      throw e;
    }
  }

  async function observe(tabId: string) {
    state.isLoading = true;
    state.error = null;
    try {
      console.log("[browser] observe - TODO");
      return null;
    } catch (e) {
      state.error = String(e);
      throw e;
    } finally {
      state.isLoading = false;
    }
  }

  async function navigate(tabId: string, url: string) {
    state.error = null;
    try {
      console.log("[browser] navigate - TODO");
    } catch (e) {
      state.error = String(e);
      throw e;
    }
  }

  async function perform(action: BrowserAction) {
    state.error = null;
    try {
      console.log("[browser] perform - TODO", action);
    } catch (e) {
      state.error = String(e);
      throw e;
    }
  }

  async function closeSession(sessionId: string) {
    state.error = null;
    try {
      console.log("[browser] closeSession - TODO");
    } catch (e) {
      state.error = String(e);
      throw e;
    }
  }

  return {
    get profiles() {
      return state.profiles;
    },
    get sessions() {
      return state.sessions;
    },
    get currentSession() {
      return state.currentSession;
    },
    get currentObservation() {
      return state.currentObservation;
    },
    get isLoading() {
      return state.isLoading;
    },
    get error() {
      return state.error;
    },
    loadProfiles,
    createProfile,
    launchProfile,
    listTabs,
    observe,
    navigate,
    perform,
    closeSession,
  };
}

export const browserRuntime = createBrowserRuntimeStore();
