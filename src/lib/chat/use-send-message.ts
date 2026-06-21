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
import {
  SendCoordinator,
  SendCoordinatorError,
  type SendDraft,
  type SendStatusEvent,
} from "$lib/chat/send-coordinator";

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
  /** Logical-folder id from ?sf= (sidebar "new session in folder"). */
  consumePendingSubFolderId?: () => string;
  /**
   * v1.0.9: source-of-truth for the prompt input component. The
   * coordinator uses this to clear the draft only after transport
   * acceptance, and to restore the draft on failure. Optional for
   * callers that wire draft retention through `PromptInput` directly.
   */
  promptInputRef?: () =>
    | {
        getInputSnapshot?: () => import("$lib/types").PromptInputSnapshot | unknown;
        restoreSnapshot?: (snap: import("$lib/types").PromptInputSnapshot) => void;
        clearInput?: () => void;
      }
    | undefined;
}

export interface SendMessageHandle {
  sendMessage: (
    text: string,
    attachments: Attachment[],
    creationMode?: "single" | "worktree",
    folderId?: string,
  ) => Promise<void>;
  coordinator: SendCoordinator;
  /** Most recent event; UI can read for the banner. */
  latest: SendStatusEvent | null;
  /** True when a submit is in flight. */
  inFlight: boolean;
}

export function createSendMessage(ctx: SendMessageContext): SendMessageHandle {
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
    consumePendingSubFolderId,
    promptInputRef,
  } = ctx;

  function clearDraftIfOwnedBy(runId: string) {
    const ref = promptInputRef?.();
    if (!ref?.clearInput) return;
    if (store.run?.id !== runId) return;
    ref.clearInput();
  }

  function restoreDraft(snapshot: SendDraft) {
    const ref = promptInputRef?.();
    if (!ref?.restoreSnapshot) return;
    const snap: import("$lib/types").PromptInputSnapshot = {
      text: snapshot.text,
      attachments:
        (snapshot.attachments as import("$lib/types").PromptInputSnapshot["attachments"]) ?? [],
      pastedBlocks: [],
      pathRefs: [],
    };
    ref.restoreSnapshot(snap);
  }

  const coordinator = new SendCoordinator({
    onAccepted: (event) => {
      dbg("send", "onAccepted", { runId: event.runId, clientMessageId: event.clientMessageId });
      clearDraftIfOwnedBy(event.runId);
    },
    onFailure: (event) => {
      dbgWarn("send", "onFailure", {
        runId: event.runId,
        code: event.error?.code,
        retryable: event.error?.retryable,
      });
      // For retryable failures, the SendStatusBanner will surface a Retry
      // CTA that re-uses the captured draft snapshot.
    },
  });

  let latest: SendStatusEvent | null = null;
  coordinator.subscribe((event) => {
    latest = event;
  });

  async function sendMessage(
    text: string,
    attachments: Attachment[],
    creationMode?: "single" | "worktree",
    folderId?: string,
  ): Promise<void> {
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

    const draft: SendDraft = { text, attachments };

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

        // Re-check after folder picker — user may have navigated or sent another message
        if (!store.canSend) return;

        const resolvedFolderId =
          folderId ?? (consumePendingSubFolderId ? consumePendingSubFolderId() : "");

        // For new sessions, the runId is created by startSession. We must
        // not enter the coordinator with a placeholder — instead, register
        // the startSession call directly. The promise resolves when the
        // IPC returns; that's our "accepted" signal.
        try {
          const runId = await store.startSession(
            text,
            cwd,
            attachments,
            undefined,
            creationMode,
            resolvedFolderId || undefined,
          );
          // Run created — clear the draft (this is a new session so the
          // banner logic would also clear on accept if coordinator.acknowledge is called).
          clearDraftIfOwnedBy(runId);
          goto(`/chat?run=${runId}`, { replaceState: true });
          window.dispatchEvent(new Event(EVT_RUNS_CHANGED));
          loadCliVersionInfo();
        } catch (startError) {
          // Restore the draft so the user can retry without retyping.
          restoreDraft(draft);
          store.error = String(startError);
          showToast(t("send_status_failed_unknown"));
          throw startError;
        }
      } else if (
        store.useStreamSession &&
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
        // Resumes resolve on IPC accept; clear the draft.
        clearDraftIfOwnedBy(store.run.id);
      } else {
        if (slashCmd) {
          thinking.setProcessingSlashCmd(slashCmd);
          thinking.setSlashCmdSeenRunning(false);
        }
        await coordinator.submit({
          runId: store.run.id,
          sessionId: store.run.session_id ?? null,
          draft,
          cause: "continue",
          transport: async (clientMessageId) => {
            await store.sendMessage(text, attachments, clientMessageId);
          },
        });
        requestAnimationFrame(() => getPromptRef()?.focus());
      }
    } catch (e) {
      thinking.setProcessingSlashCmd(null);
      // The send-coordinator already surfaced a failed event with the draft.
      // Restore from the captured draft snapshot in case the prompt input
      // store lost it (e.g. legacy callers).
      if (e instanceof SendCoordinatorError) {
        restoreDraft(draft);
      }
    }
  }

  return {
    sendMessage,
    coordinator,
    get latest() {
      return latest;
    },
    get inFlight() {
      return coordinator.busy;
    },
  } as SendMessageHandle;
}
