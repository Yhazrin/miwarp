/**
 * Browser Runtime Store - Svelte 5 状态管理
 *
 * 管理浏览器运行时的全局状态。所有 Tauri 通信经过 `src/lib/api/browser-runtime.ts`，
 * 当前活跃 session 的 `sessionId` 保留在 store 里，让 BrowserPanel 不必每次
 * 显式传 sessionId。
 */

import {
  type BrowserActionDto,
  type BrowserObservationDto,
  type BrowserProfileDto,
  type BrowserSessionDto,
  type BrowserTabDto,
  type BrowserEngine,
  closeBrowserSession,
  createBrowserProfile,
  deleteBrowserProfile,
  launchBrowserProfile,
  listBrowserProfiles,
  listBrowserSessions,
  listBrowserTabs,
  navigateBrowserTab,
  observeBrowserTab,
  performBrowserAction,
} from "$lib/api/browser-runtime";

export type {
  BrowserActionDto as BrowserAction,
  BrowserObservationDto as BrowserObservation,
  BrowserProfileDto as BrowserProfile,
  BrowserSessionDto as BrowserSession,
  BrowserTabDto as BrowserTab,
  BrowserEngine,
};

interface StoreState {
  profiles: BrowserProfileDto[];
  sessions: BrowserSessionDto[];
  currentSessionId: string | null;
  currentTabId: string | null;
  currentObservation: BrowserObservationDto | null;
  isLoading: boolean;
  error: string | null;
}

export function createBrowserRuntimeStore() {
  const state = $state<StoreState>({
    profiles: [],
    sessions: [],
    currentSessionId: null,
    currentTabId: null,
    currentObservation: null,
    isLoading: false,
    error: null,
  });

  function setError(message: string) {
    state.error = message;
  }

  function clearError() {
    state.error = null;
  }

  async function loadProfiles() {
    state.isLoading = true;
    clearError();
    try {
      state.profiles = await listBrowserProfiles();
    } catch (e) {
      setError(String(e));
    } finally {
      state.isLoading = false;
    }
  }

  async function createProfile(name: string, engine: BrowserEngine) {
    state.isLoading = true;
    clearError();
    try {
      const profile = await createBrowserProfile(name, engine);
      state.profiles = [...state.profiles, profile];
      return profile;
    } catch (e) {
      setError(String(e));
      throw e;
    } finally {
      state.isLoading = false;
    }
  }

  async function deleteProfile(profileId: string) {
    clearError();
    try {
      await deleteBrowserProfile(profileId);
      state.profiles = state.profiles.filter((p) => p.id !== profileId);
    } catch (e) {
      setError(String(e));
      throw e;
    }
  }

  async function launchProfile(profileId: string, runtimeName?: string) {
    state.isLoading = true;
    clearError();
    try {
      const session = await launchBrowserProfile(profileId, runtimeName);
      state.sessions = [...state.sessions, session];
      state.currentSessionId = session.sessionId;
      state.currentTabId = session.tabs[0]?.targetId ?? null;
      state.currentObservation = null;
      return session;
    } catch (e) {
      setError(String(e));
      throw e;
    } finally {
      state.isLoading = false;
    }
  }

  async function refreshSessions() {
    clearError();
    try {
      state.sessions = await listBrowserSessions();
      // If current session no longer exists, drop it.
      if (
        state.currentSessionId &&
        !state.sessions.some((s) => s.sessionId === state.currentSessionId)
      ) {
        state.currentSessionId = null;
        state.currentTabId = null;
        state.currentObservation = null;
      }
    } catch (e) {
      setError(String(e));
      throw e;
    }
  }

  async function listTabs(sessionId: string): Promise<BrowserTabDto[]> {
    clearError();
    try {
      return await listBrowserTabs(sessionId);
    } catch (e) {
      setError(String(e));
      throw e;
    }
  }

  async function selectTab(tabId: string) {
    state.currentTabId = tabId;
    state.currentObservation = null;
  }

  async function observe(tabId?: string) {
    const sessionId = state.currentSessionId;
    const effectiveTabId = tabId ?? state.currentTabId;
    if (!sessionId || !effectiveTabId) return null;
    state.isLoading = true;
    clearError();
    try {
      const observation = await observeBrowserTab(sessionId, effectiveTabId);
      state.currentObservation = observation;
      return observation;
    } catch (e) {
      setError(String(e));
      throw e;
    } finally {
      state.isLoading = false;
    }
  }

  async function navigate(tabId: string, url: string) {
    const sessionId = state.currentSessionId;
    if (!sessionId) return;
    clearError();
    try {
      await navigateBrowserTab(sessionId, tabId, url);
      state.currentTabId = tabId;
    } catch (e) {
      setError(String(e));
      throw e;
    }
  }

  async function perform(action: BrowserActionDto) {
    const sessionId = state.currentSessionId;
    const tabId = state.currentTabId;
    if (!sessionId || !tabId) return;
    clearError();
    try {
      await performBrowserAction(sessionId, tabId, action);
    } catch (e) {
      setError(String(e));
      throw e;
    }
  }

  async function closeSession(sessionId?: string) {
    const target = sessionId ?? state.currentSessionId;
    if (!target) return;
    clearError();
    try {
      await closeBrowserSession(target);
      state.sessions = state.sessions.filter((s) => s.sessionId !== target);
      if (state.currentSessionId === target) {
        state.currentSessionId = null;
        state.currentTabId = null;
        state.currentObservation = null;
      }
    } catch (e) {
      setError(String(e));
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
    get currentSessionId() {
      return state.currentSessionId;
    },
    get currentTabId() {
      return state.currentTabId;
    },
    /** Backwards-compat: return the live session object (or null). */
    get currentSession(): BrowserSessionDto | null {
      return state.sessions.find((s) => s.sessionId === state.currentSessionId) ?? null;
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
    deleteProfile,
    launchProfile,
    refreshSessions,
    listTabs,
    selectTab,
    observe,
    navigate,
    perform,
    closeSession,
  };
}

export const browserRuntime = createBrowserRuntimeStore();
