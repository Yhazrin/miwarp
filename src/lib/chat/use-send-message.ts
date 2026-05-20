import { getTransport } from "$lib/transport";
import { dbg } from "$lib/utils/debug";
import { detectTeamTrigger } from "$lib/services/team-dispatcher";
import { getStoredRemoteCwd, setStoredRemoteCwd } from "$lib/utils/remote-cwd";
import type { SessionStore } from "$lib/stores/session-store.svelte";
import type { Attachment, RemoteHost } from "$lib/types";

export interface SendMessageContext {
  store: SessionStore;
  t: (key: string) => string;
  showToast: (msg: string) => void;
  goto: (path: string, opts?: { replaceState?: boolean }) => void;
  handleResume: (
    mode: string,
    overrideRunId?: string,
    initialMessage?: string,
    initialAttachments?: Attachment[],
  ) => Promise<void>;
  openFolderPicker: (opts: {
    initialHost?: string | null;
    initialPath?: string;
    hideTargetSelector?: boolean;
  }) => Promise<{ hostName: string | null; path: string } | null>;
  getRemoteHosts: () => RemoteHost[];
  setRemoteHostName: (v: string | null) => void;
  setLastTarget: (v: string | null) => void;
  getPromptRef: () => { focus(): void } | undefined;
  setProcessingSlashCmd: (v: string | null) => void;
  setSlashCmdSeenRunning: (v: boolean) => void;
  setTeamDispatchPrompt: (v: string) => void;
  setTeamDispatchOpen: (v: boolean) => void;
  setIsChatAutoScroll: (v: boolean) => void;
  setShowChatScrollHint: (v: boolean) => void;
  loadCliVersionInfo: () => void;
}

export function createSendMessage(ctx: SendMessageContext) {
  const {
    store,
    t,
    showToast,
    goto,
    handleResume,
    openFolderPicker,
    getRemoteHosts,
    setRemoteHostName,
    setLastTarget,
    getPromptRef,
    setProcessingSlashCmd,
    setSlashCmdSeenRunning,
    setTeamDispatchPrompt,
    setTeamDispatchOpen,
    setIsChatAutoScroll,
    setShowChatScrollHint,
    loadCliVersionInfo,
  } = ctx;

  async function sendMessage(text: string, attachments: Attachment[]) {
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
        if (
          store.remoteHostName &&
          getRemoteHosts().length > 0 &&
          !getRemoteHosts().some((h) => h.name === store.remoteHostName)
        ) {
          dbg("chat", "remote host no longer in settings — clearing target", {
            host: store.remoteHostName,
          });
          showToast(t("toast_remoteHostMissing"));
          setRemoteHostName(null);
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
              localStorage.getItem("ocv:project-cwd") ||
              localStorage.getItem("ocv:settings-cwd") ||
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
            localStorage.setItem("ocv:project-cwd", cwd);
            window.dispatchEvent(new Event("ocv:cwd-changed"));
          } else {
            const result = await openFolderPicker({ initialHost: null });
            if (!result || !result.path) return;
            cwd = result.path;
            if (result.hostName) {
              setRemoteHostName(result.hostName);
              setLastTarget(result.hostName);
              setStoredRemoteCwd(result.hostName, cwd);
            } else {
              localStorage.setItem("ocv:project-cwd", cwd);
              window.dispatchEvent(new Event("ocv:cwd-changed"));
            }
          }
        }

        if (slashCmd) {
          setProcessingSlashCmd(slashCmd);
          setSlashCmdSeenRunning(false);
        }

        const runId = await store.startSession(text, cwd, attachments);
        goto(`/chat?run=${runId}`, { replaceState: true });
        window.dispatchEvent(new Event("ocv:runs-changed"));
        loadCliVersionInfo();
      } else if (store.useStreamSession && !store.sessionAlive && store.run.session_id) {
        dbg("chat", "auto-resume on send", {
          runId: store.run.id,
          sessionId: store.run.session_id,
        });
        if (slashCmd) {
          setProcessingSlashCmd(slashCmd);
          setSlashCmdSeenRunning(false);
        }
        await handleResume("resume", undefined, text, attachments);
      } else {
        if (slashCmd) {
          setProcessingSlashCmd(slashCmd);
          setSlashCmdSeenRunning(false);
        }
        await store.sendMessage(text, attachments);
        requestAnimationFrame(() => getPromptRef()?.focus());
      }
    } catch (e) {
      store.error = String(e);
      setProcessingSlashCmd(null);
    }
  }

  return { sendMessage };
}
