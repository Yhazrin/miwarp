/**
 * Lightweight chat view cache — persists UI state across navigation.
 *
 * NOT persisted: timeline data, store contents, xterm state.
 * ONLY persisted: last run id, last chat URL, UI view state (scroll, tab, sidebar).
 */

import type { ToolActivityPanelTab } from "$lib/components/chat/tool-panel-tab";

const STORAGE_KEY = "ocv:chat-view-cache";

export interface ChatViewCache {
  lastRunId: string;
  lastChatHref: string;
  scrollTopByRun: Record<string, number>;
  toolPanelActiveTab: ToolActivityPanelTab;
  sidebarCollapsed: boolean;
  requestedPreviewPath: string | null;
  renderLimitByRun: Record<string, number>;
}

function defaultCache(): ChatViewCache {
  return {
    lastRunId: "",
    lastChatHref: "",
    scrollTopByRun: {},
    toolPanelActiveTab: "workspace",
    sidebarCollapsed: false,
    requestedPreviewPath: null,
    renderLimitByRun: {},
  };
}

function loadFromStorage(): ChatViewCache {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ChatViewCache>;
      return { ...defaultCache(), ...parsed };
    }
  } catch {
    // ignore
  }
  return defaultCache();
}

function saveToStorage(c: ChatViewCache) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
  } catch {
    // ignore
  }
}

// Module-level singleton — survives page component destruction
const _cache = loadFromStorage();

export const chatViewCache: ChatViewCache = {
  get lastRunId() {
    return _cache.lastRunId;
  },
  set lastRunId(v: string) {
    _cache.lastRunId = v;
    saveToStorage(_cache);
  },

  get lastChatHref() {
    return _cache.lastChatHref;
  },
  set lastChatHref(v: string) {
    _cache.lastChatHref = v;
    saveToStorage(_cache);
  },

  get scrollTopByRun() {
    return _cache.scrollTopByRun;
  },

  get toolPanelActiveTab() {
    return _cache.toolPanelActiveTab;
  },
  set toolPanelActiveTab(v: ToolActivityPanelTab) {
    _cache.toolPanelActiveTab = v;
    saveToStorage(_cache);
  },

  get sidebarCollapsed() {
    return _cache.sidebarCollapsed;
  },
  set sidebarCollapsed(v: boolean) {
    _cache.sidebarCollapsed = v;
    saveToStorage(_cache);
  },

  get requestedPreviewPath() {
    return _cache.requestedPreviewPath;
  },
  set requestedPreviewPath(v: string | null) {
    _cache.requestedPreviewPath = v;
    saveToStorage(_cache);
  },

  get renderLimitByRun() {
    return _cache.renderLimitByRun;
  },
};

/** Call when leaving the chat page to persist UI state for the current run. */
export function saveChatViewState(opts: {
  runId: string;
  scrollTop: number;
  toolPanelActiveTab: ToolActivityPanelTab;
  sidebarCollapsed: boolean;
  requestedPreviewPath: string | null;
  renderLimit: number;
}) {
  const {
    runId,
    scrollTop,
    toolPanelActiveTab,
    sidebarCollapsed,
    requestedPreviewPath,
    renderLimit,
  } = opts;

  if (runId) {
    _cache.scrollTopByRun[runId] = scrollTop;
    _cache.renderLimitByRun[runId] = renderLimit;
    _cache.lastRunId = runId;
  }
  _cache.toolPanelActiveTab = toolPanelActiveTab;
  _cache.sidebarCollapsed = sidebarCollapsed;
  _cache.requestedPreviewPath = requestedPreviewPath;

  saveToStorage(_cache);
}

/** Update lastChatHref when URL changes to a valid run URL. */
export function updateLastChatHref(runId: string, href: string) {
  if (runId && href.includes("run=")) {
    _cache.lastChatHref = href;
    _cache.lastRunId = runId;
    saveToStorage(_cache);
  }
}

/** Get cached scroll top for a run, or 0 if none. */
export function getCachedScrollTop(runId: string): number {
  return _cache.scrollTopByRun[runId] ?? 0;
}

/** Get cached render limit for a run, or undefined if none. */
export function getCachedRenderLimit(runId: string): number | undefined {
  return _cache.renderLimitByRun[runId];
}
