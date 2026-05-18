/**
 * Context Relay Store: reactive state for context relay UI
 */
import type { ContextClip, ContextRelayTarget } from "./context-clip-types";
import { sendToTarget, getRecentSessions, type RelayResult } from "./context-relay-service";
import type { TaskRun } from "$lib/types";

/** State for the relay modal */
interface RelayModalState {
  open: boolean;
  clip: ContextClip | null;
  additionalInstructions: string;
  allTargets: TaskRun[];
  loading: boolean;
  sending: boolean;
  lastResult: RelayResult | null;
  currentRunId: string;
  currentCwd: string;
  searchQuery: string;
}

/** Create the context relay store */
function createContextRelayStore() {
  const state = $state<RelayModalState>({
    open: false,
    clip: null,
    additionalInstructions: "",
    allTargets: [],
    loading: false,
    sending: false,
    lastResult: null,
    currentRunId: "",
    currentCwd: "/",
    searchQuery: "",
  });

  /** Open the relay modal with a clip */
  async function openModal(clip: ContextClip, currentRunId: string, currentCwd: string) {
    state.clip = clip;
    state.additionalInstructions = "";
    state.lastResult = null;
    state.currentRunId = currentRunId;
    state.currentCwd = currentCwd;
    state.searchQuery = "";
    state.open = true;

    // Load recent sessions in background
    if (state.allTargets.length === 0) {
      state.loading = true;
      try {
        state.allTargets = await getRecentSessions(20);
      } finally {
        state.loading = false;
      }
    }
  }

  /** Close the relay modal */
  function closeModal() {
    state.open = false;
    state.clip = null;
    state.additionalInstructions = "";
    state.lastResult = null;
    state.searchQuery = "";
  }

  /** Set additional instructions */
  function setInstructions(text: string) {
    state.additionalInstructions = text;
  }

  /** Set search query */
  function setSearchQuery(query: string) {
    state.searchQuery = query;
  }

  /** Filtered targets based on search query */
  function getFilteredTargets(): TaskRun[] {
    if (!state.searchQuery.trim()) {
      return state.allTargets.filter((t) => t.id !== state.currentRunId).slice(0, 10);
    }
    const query = state.searchQuery.toLowerCase();
    return state.allTargets
      .filter((t) => {
        if (t.id === state.currentRunId) return false;
        const name = t.name?.toLowerCase() ?? "";
        const prompt = t.prompt?.toLowerCase() ?? "";
        return name.includes(query) || prompt.includes(query);
      })
      .slice(0, 10);
  }

  /** Send the clip to a target */
  async function relayToTarget(target: ContextRelayTarget): Promise<RelayResult> {
    if (!state.clip) {
      return { success: false, error: "No clip to send" };
    }

    state.sending = true;
    state.lastResult = null;

    try {
      const result = await sendToTarget(
        state.clip,
        target,
        state.additionalInstructions || undefined,
      );
      state.lastResult = result;
      return result;
    } finally {
      state.sending = false;
    }
  }

  /** Create a new session with this clip */
  async function relayToNewSession(): Promise<RelayResult> {
    return relayToTarget({ type: "new", cwd: state.currentCwd });
  }

  /** Send to current active session */
  async function relayToCurrent(): Promise<RelayResult> {
    if (!state.currentRunId) {
      return { success: false, error: "No active session" };
    }
    return relayToTarget({ type: "current", runId: state.currentRunId });
  }

  /** Send to a specific session */
  async function relayToSession(runId: string): Promise<RelayResult> {
    return relayToTarget({ type: "session", runId });
  }

  /** Clear last result */
  function clearResult() {
    state.lastResult = null;
  }

  return {
    get open() {
      return state.open;
    },
    get clip() {
      return state.clip;
    },
    get additionalInstructions() {
      return state.additionalInstructions;
    },
    get allTargets() {
      return state.allTargets;
    },
    get loading() {
      return state.loading;
    },
    get sending() {
      return state.sending;
    },
    get lastResult() {
      return state.lastResult;
    },
    get currentRunId() {
      return state.currentRunId;
    },
    get currentCwd() {
      return state.currentCwd;
    },
    get searchQuery() {
      return state.searchQuery;
    },
    getFilteredTargets,
    openModal,
    closeModal,
    setInstructions,
    setSearchQuery,
    relayToTarget,
    relayToNewSession,
    relayToCurrent,
    relayToSession,
    clearResult,
  };
}

/** Singleton store instance */
export const contextRelayStore = createContextRelayStore();
