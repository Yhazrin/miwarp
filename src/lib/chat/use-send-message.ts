import { getTransport } from "$lib/transport";
import type { SessionStore } from "$lib/stores/session-store.svelte";
import type { Attachment, SessionMode } from "$lib/types";
import type { ThinkingTimerHandle } from "$lib/chat/use-thinking-timer.svelte";
import { detectTeamTrigger } from "$lib/services/team-dispatcher";
import { LS_PROJECT_CWD, LS_SETTINGS_CWD } from "$lib/utils/storage-keys";
import { EVT_CWD_CHANGED, EVT_RUNS_CHANGED } from "$lib/utils/bus-events";
import { dbg, dbgWarn } from "$lib/utils/debug";
import { setLastTarget, getStoredRemoteCwd, setStoredRemoteCwd } from "$lib/utils/remote-cwd";
import { normalizeCwd } from "$lib/utils/sidebar-groups";

export interface SendMessageContext {
  store: SessionStore;
  thinking: ThinkingTimerHandle;
  getRemoteHosts: () => import("$lib/types").RemoteHost[];
  showToast: (msg: string) => void;
  openFolderPicker: (opts: {
    initialHost?: string | null;
    initialPath?: string;
    hideTargetSelector?: boolean;
  }) => Promise<{ hostName: string | null; path: string } | null>;
  handleResume: (
    mode: SessionMode,
    runId?: string,
    text?: string,
    attachments?: Attachment[],
  ) => Promise<void>;
  loadCliVersionInfo: () => void;
  getPromptRef: () => { focus(): void; restoreSnapshot(s: unknown): void } | undefined;
  goto: (path: string, opts?: { replaceState?: boolean }) => void;
  setIsChatAutoScroll: (v: boolean) => void;
  setShowChatScrollHint: (v: boolean) => void;
  setTeamDispatchPrompt: (v: string) => void;
  setTeamDispatchOpen: (v: boolean) => void;
  t: (key: string, params?: Record<string, string>) => string;
  /** Workspace cwd from ?folder= or sidebar new-chat-in-folder (before localStorage sync). */
  getFolderCwdOverride?: () => string;
}

export function createSendMessage(ctx: SendMessageContext) {
  const {
    store,
    thinking,
    getRemoteHosts,
    showToast,
    openFolderPicker,
    handleResume,
    loadCliVersionInfo,
    getPromptRef,
    goto,
    setIsChatAutoScroll,
    setShowChatScrollHint,
    setTeamDispatchPrompt,
    setTeamDispatchOpen,
    t,
    getFolderCwdOverride,
  } = ctx;

  return async function sendMessage(text: string, attachments: Attachment[]) {
    if (!text.trim()) return;

    store.error = "";
    setIsChatAutoScroll(true);
    setShowChatScrollHint(false);

    const isSlash = store.isKnownSlashCommand(text);
    const slashCmd = isSlash ? (text.match(/^\/\S+/)?.[0] ?? null) : null;

    if (!store.run && !slashCmd) {
      const teamResult = detectTeamTrigger(text);
      if (teamResult) {
        setTeamDispatchPrompt(teamResult.prompt);
        setTeamDispatchOpen(true);
        return;
      }
    }

    try {
      if (!store.run) {
        const remoteHosts = getRemoteHosts();
        if (
          store.remoteHostName &&
          remoteHosts.length > 0 &&
          !remoteHosts.some((h) => h.name === store.remoteHostName)
        ) {
          dbgWarn("chat", "remote host no longer in settings — clearing target", {
            host: store.remoteHostName,
          });
          showToast(t("toast_remoteHostMissing"));
          store.remoteHostName = null;
          setLastTarget(null);
          return;
        }
        const isRemote = !!store.remoteHostName;
        let cwd = "";
        if (typeof window !== "undefined") {
          if (isRemote) {
            cwd = getStoredRemoteCwd(store.remoteHostName!);
          } else {
            cwd =
              normalizeCwd(getFolderCwdOverride?.() ?? "") ||
              normalizeCwd(localStorage.getItem(LS_PROJECT_CWD) ?? "") ||
              normalizeCwd(localStorage.getItem(LS_SETTINGS_CWD) ?? "") ||
              "";
          }
        }

        if (!cwd || cwd === "/") {
          const transport = getTransport();
          if (isRemote) {
            const result = await openFolderPicker({
              initialHost: store.remoteHostName,
              hideTargetSelector: true,
            });
            if (!result || !result.path) return;
            cwd = result.path;
            if (result.hostName) setStoredRemoteCwd(result.hostName, cwd);
          } else if (transport.isDesktop()) {
            const { open } = await import("@tauri-apps/plugin-dialog");
            const selected = await open({
              directory: true,
              title: t("layout_selectProjectFolder"),
            });
            if (!selected) return;
            cwd = selected as string;
            localStorage.setItem(LS_PROJECT_CWD, cwd);
            window.dispatchEvent(new Event(EVT_CWD_CHANGED));
          } else {
            const result = await openFolderPicker({ initialHost: null });
            if (!result || !result.path) return;
            cwd = result.path;
            if (result.hostName) {
              store.remoteHostName = result.hostName;
              setLastTarget(result.hostName);
              setStoredRemoteCwd(result.hostName, cwd);
            } else {
              localStorage.setItem(LS_PROJECT_CWD, cwd);
              window.dispatchEvent(new Event(EVT_CWD_CHANGED));
            }
          }
        }

        if (slashCmd) {
          thinking.setProcessingSlashCmd(slashCmd);
          thinking.setSlashCmdSeenRunning(false);
        }

        const runId = await store.startSession(text, cwd, attachments);
        goto(`/chat?run=${runId}`, { replaceState: true });
        window.dispatchEvent(new Event(EVT_RUNS_CHANGED));
        loadCliVersionInfo();
      } else if (
        store.useStreamSession &&
        // v1.0.6: explicit cached/stale_cached check MUST come before sessionAlive —
        // these are in SESSION_ALIVE_PHASES so sessionAlive===true, but
        // we still need to resume the CLI before sending.
        (store.phase === "cached" ||
          store.phase === "stale_cached" ||
          (!store.sessionAlive && store.run.session_id))
      ) {
        dbg("chat", "auto-resume on send", {
          runId: store.run.id,
          sessionId: store.run.session_id,
          fromCached: store.phase === "cached",
        });
        if (slashCmd) {
          thinking.setProcessingSlashCmd(slashCmd);
          thinking.setSlashCmdSeenRunning(false);
        }
        await handleResume("resume", undefined, text, attachments);
      } else {
        if (slashCmd) {
          thinking.setProcessingSlashCmd(slashCmd);
          thinking.setSlashCmdSeenRunning(false);
        }
        await store.sendMessage(text, attachments);
        requestAnimationFrame(() => getPromptRef()?.focus());
      }
    } catch (e) {
      store.error = String(e);
      thinking.setProcessingSlashCmd(null);
    }
  };
}
