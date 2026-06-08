import * as api from "$lib/api";
import { LS_PREVIEW_URL } from "$lib/utils/storage-keys";
import { EVT_RUNS_CHANGED } from "$lib/utils/bus-events";
import { dbg, dbgWarn } from "$lib/utils/debug";
import { buildSummaryHtml } from "$lib/chat/utils/summary-html";
import { uuid } from "$lib/utils/uuid";
import {
  normalizeProcessVisibility,
  persistCachedProcessVisibility,
  type ProcessVisibility,
} from "$lib/utils/process-visibility";
import type { SessionStore } from "$lib/stores/session-store.svelte";
import type { UserSettings } from "$lib/types";
import type { ToolActivityPanelTab } from "$lib/components/chat/tool-panel-tab";

export interface BtwStateData {
  active: boolean;
  btwId: string | null;
  question: string;
  answer: string;
  error: string | null;
  loading: boolean;
}

export interface ChatActionsContext {
  store: SessionStore;
  t: (key: string, params?: Record<string, string>) => string;
  showToast: (msg: string) => void;
  setBtwState: (v: BtwStateData) => void;
  setVerboseEnabled: (v: boolean) => void;
  setRequestedPreviewUrl: (v: string | null) => void;
  setSidebarRequestedTab: (v: ToolActivityPanelTab | null) => void;
  getSidebarCollapsed: () => boolean;
  setSidebarCollapsed: (v: boolean) => void;
  getSettings: () => UserSettings | null;
  setSettings: (v: UserSettings | null) => void;
  getPromptRef: () => { setValue(text: string): void } | undefined;
}

export function createChatActions(ctx: ChatActionsContext) {
  const {
    store,
    t,
    showToast,
    setBtwState,
    setVerboseEnabled,
    setRequestedPreviewUrl,
    setSidebarRequestedTab,
    getSidebarCollapsed,
    setSidebarCollapsed,
    getSettings,
    setSettings,
    getPromptRef,
  } = ctx;

  function appendCommandOutput(text: string) {
    const cmdId = uuid();
    store.timeline = [
      ...store.timeline,
      {
        kind: "command_output" as const,
        id: cmdId,
        anchorId: cmdId,
        content: text,
        ts: new Date().toISOString(),
      },
    ];
  }

  async function handleSummarize() {
    if (!store.run) {
      dbgWarn("chat", "handleSummarize: no run");
      showToast(t("export_noConversation"));
      return;
    }
    dbg("chat", "handleSummarize: start");
    try {
      showToast(t("summarize_generating"));
      const summaryResult = await api.summarizeConversation(store.run.id);
      const { summary, markdown } = summaryResult;
      const title = store.run.name ?? store.run.prompt?.slice(0, 80) ?? "Conversation Summary";
      const html = buildSummaryHtml(title, {
        summary,
        markdown,
        model: store.model,
        cwd: store.effectiveCwd,
        startedAt: store.run.started_at,
        turnCount: store.numTurns || 0,
      });
      const { save } = await import("@tauri-apps/plugin-dialog");
      const path = await save({
        defaultPath: `summary-${Date.now()}.html`,
        filters: [{ name: "HTML", extensions: ["html"] }],
      });
      if (!path) {
        dbg("chat", "handleSummarize: user cancelled");
        return;
      }
      await api.writeHtmlExport(path, html);
      dbg("chat", "handleSummarize: done", { path });
      showToast(t("summarize_success"));
    } catch (e) {
      dbgWarn("chat", "handleSummarize failed", e);
      showToast(t("summarize_failed"));
    }
  }

  async function handleRename(name: string) {
    if (!store.run) return;
    try {
      await api.renameRun(store.run.id, name);
      store.run = { ...store.run, name };
      window.dispatchEvent(new Event(EVT_RUNS_CHANGED));
      dbg("chat", "renamed run", { id: store.run.id, name });
    } catch (e) {
      dbgWarn("chat", "rename failed", e);
    }
  }

  async function handleFastModeSwitch(mode: "on" | "off") {
    const enabling = mode === "on";
    const current = store.fastModeState === "on";
    if (enabling === current) {
      appendCommandOutput(t(enabling ? "fast_alreadyOn" : "fast_alreadyOff"));
      return;
    }
    try {
      await api.updateCliConfig({ fastMode: enabling });
      store.fastModeState = enabling ? "on" : "";
      dbg("chat", "fastMode set", { mode });
      showToast(t(enabling ? "toast_fastModeOn" : "toast_fastModeOff"));
      appendCommandOutput(t(enabling ? "fast_enabled" : "fast_disabled"));
    } catch (e) {
      dbgWarn("chat", "fastMode set failed:", e);
    }
  }

  async function handleBtwSend(question: string) {
    if (!store.run?.id) return;
    dbg("chat", "btwSend", { runId: store.run.id, question: question.slice(0, 50) });
    setBtwState({ active: true, btwId: null, question, answer: "", error: null, loading: true });
    try {
      const btwId = await api.sideQuestion(store.run.id, question);
      setBtwState({ active: true, btwId, question, answer: "", error: null, loading: false });
    } catch (e) {
      setBtwState({
        active: true,
        btwId: null,
        question,
        answer: "",
        error: String(e),
        loading: false,
      });
    }
  }

  function openPreviewInSidebar(url?: string) {
    const targetUrl = url?.trim() || localStorage.getItem(LS_PREVIEW_URL) || "";
    if (!targetUrl) {
      appendCommandOutput(t("preview_usage"));
      return;
    }
    setRequestedPreviewUrl(targetUrl);
    setSidebarRequestedTab("preview");
    if (getSidebarCollapsed()) setSidebarCollapsed(false);
    appendCommandOutput(t("preview_opened"));
  }

  async function handleRalphCancel() {
    if (!store.run?.id) return;
    try {
      const result = await api.cancelRalphLoop(store.run.id);
      if (result.immediate) {
        appendCommandOutput(`Loop cancelled (iteration ${result.iteration})`);
      } else {
        appendCommandOutput(
          `Loop will stop after current iteration (iteration ${result.iteration})`,
        );
      }
    } catch (err) {
      appendCommandOutput(
        `Failed to cancel loop: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async function handleStop() {
    await store.stop();
    window.dispatchEvent(new Event(EVT_RUNS_CHANGED));
  }

  function fillPrompt(text: string) {
    getPromptRef()?.setValue(text);
  }

  async function toggleCliConfigBool(key: string) {
    try {
      const config = await api.getCliConfig();
      const current = config[key] === true;
      await api.updateCliConfig({ [key]: !current });
      dbg("chat", `toggled ${key}`, { from: current, to: !current });
      if (key === "fastMode") {
        store.fastModeState = !current ? "on" : "";
        dbg("chat", "fastMode UI mirrored", { state: store.fastModeState });
      } else if (key === "verbose") {
        setVerboseEnabled(!current);
        dbg("chat", "verbose UI mirrored", { verbose: !current });
      }
      const label =
        key === "fastMode"
          ? !current
            ? "toast_fastModeOn"
            : "toast_fastModeOff"
          : !current
            ? "toast_verboseOn"
            : "toast_verboseOff";
      showToast(t(label as Parameters<typeof t>[0]));
    } catch (e) {
      dbgWarn("chat", `toggle ${key} failed:`, e);
    }
  }

  async function handleProcessVisibilityChange(mode: ProcessVisibility) {
    const prev = getSettings();
    persistCachedProcessVisibility(mode);
    if (prev) setSettings({ ...prev, process_visibility: mode });
    try {
      const updated = await api.updateUserSettings({ process_visibility: mode });
      setSettings(updated);
      persistCachedProcessVisibility(normalizeProcessVisibility(updated.process_visibility));
    } catch {
      setSettings(prev);
      if (prev) {
        persistCachedProcessVisibility(normalizeProcessVisibility(prev.process_visibility));
      }
    }
  }

  return {
    appendCommandOutput,
    handleSummarize,
    handleRename,
    handleFastModeSwitch,
    handleBtwSend,
    openPreviewInSidebar,
    handleRalphCancel,
    handleStop,
    fillPrompt,
    toggleCliConfigBool,
    handleProcessVisibilityChange,
  };
}
