/**
 * Composable: chat page controller.
 *
 * Owns the `sendMessage` and `loadRunProgressive` logic, plus the
 * slash-command processing indicator state. Delegates UI-specific side
 * effects (toast, scroll, folder picker) back to the component via callbacks.
 */
import { goto, replaceState } from "$app/navigation";
import { tick } from "svelte";
import { getTransport } from "$lib/transport";
import * as api from "$lib/api";
import { loadCliVersionInfo } from "$lib/stores";
import type { SessionStore } from "$lib/stores";
import type { Attachment, SessionMode, RemoteHost, UserSettings } from "$lib/types";
import { dbg, dbgWarn } from "$lib/utils/debug";
import { t } from "$lib/i18n/index.svelte";
import { setLastTarget, getStoredRemoteCwd, setStoredRemoteCwd } from "$lib/utils/remote-cwd";
import { PROJECT_CWD_KEY } from "$lib/utils/storage-keys";
import type { useProgressiveTimeline } from "$lib/chat/use-progressive-timeline.svelte";
import type { useChatScroll } from "$lib/chat/use-chat-scroll.svelte";
import type { useTeamDispatch } from "$lib/chat/use-team-dispatch.svelte";
import type { useProjectPreload } from "$lib/chat/use-project-preload.svelte";
import type PromptInput from "$lib/components/PromptInput.svelte";

export function useChatController(opts: {
  store: SessionStore;
  progressive: ReturnType<typeof useProgressiveTimeline>;
  preload: ReturnType<typeof useProjectPreload>;
  chatScroll: ReturnType<typeof useChatScroll>;
  team: ReturnType<typeof useTeamDispatch>;

  // Component-provided callbacks
  getSearchParam: (key: string) => string | null;
  getChatAreaRef: () => HTMLDivElement | undefined;
  scrollToMessage: (ts: string) => Promise<void>;
  handleResume: (
    mode: SessionMode,
    overrideRunId?: string,
    initialMessage?: string,
    initialAttachments?: Attachment[],
  ) => Promise<void>;
  showChatToast: (msg: string) => void;
  openFolderPicker: (opts: {
    initialHost?: string | null;
    hideTargetSelector?: boolean;
  }) => Promise<{ hostName: string | null; path: string } | null>;
  promptRef: () => PromptInput | undefined;
  getRemoteHosts: () => RemoteHost[];
  getSettings: () => UserSettings | null;
  /** Called at the start of loadRunProgressive to reset component state. */
  onBeforeLoadRun: () => void;
  /** Read shared scroll-in-flight flag from component. */
  getScrollToInFlight: () => boolean;
  /** Write shared scroll-in-flight flag (component keeps the reactive state). */
  setScrollToInFlight: (v: boolean) => void;
}) {
  const { store, progressive, preload, chatScroll, team } = opts;

  // ── Slash command processing indicator ──
  let processingSlashCmd = $state<string | null>(null);
  let slashCmdSeenRunning = $state(false);

  $effect(() => {
    if (!processingSlashCmd) return;
    if (store.isRunning) slashCmdSeenRunning = true;
    if (
      store.streamingText ||
      store.thinkingText ||
      store.error ||
      store.phase === "failed" ||
      store.phase === "completed" ||
      store.phase === "stopped" ||
      (slashCmdSeenRunning && store.phase === "idle")
    ) {
      processingSlashCmd = null;
      slashCmdSeenRunning = false;
    }
  });

  // ── loadRunProgressive ──

  async function loadRunProgressive(
    id: string,
    xtermRef?: { clear(): void; writeText(s: string): void },
  ) {
    opts.onBeforeLoadRun();
    const gen = progressive.resetForNewRun();

    const scrollTo = opts.getSearchParam("scrollTo");
    if (scrollTo) opts.setScrollToInFlight(true);

    await store.loadRun(id, xtermRef);

    if (id && store.effectiveCwd) {
      preload.reloadProjectData(store.effectiveCwd);
    }

    // Cross-reference MCP servers with config disabled state
    if (store.mcpServers.length > 0) {
      try {
        const disabledNames = await api.getDisabledMcpServers();
        if (disabledNames.length > 0) {
          const disabledSet = new Set(disabledNames);
          const patched = store.mcpServers.map((s) =>
            disabledSet.has(s.name) && s.status !== "disabled" ? { ...s, status: "disabled" } : s,
          );
          if (patched.some((s, i) => s !== store.mcpServers[i])) {
            store.updateMcpServers(patched);
            dbg("chat", "patched MCP disabled state", { disabledNames });
          }
        }
      } catch {
        // non-critical, ignore
      }
    }

    if (gen !== progressive.progressiveGen) return;
    dbg("chat", "loadRun complete", {
      timeline: store.timeline.length,
      renderLimit: progressive.renderLimit,
      gen,
    });

    if (scrollTo) {
      await tick();
      await opts.scrollToMessage(scrollTo);
      opts.setScrollToInFlight(false);
      const url = new URL(window.location.href);
      url.searchParams.delete("scrollTo");
      replaceState(url, {});
    } else {
      await tick();
      requestAnimationFrame(() => {
        const chatArea = opts.getChatAreaRef();
        if (chatArea) chatArea.scrollTop = chatArea.scrollHeight;
      });
    }
  }

  // ── sendMessage ──

  async function sendMessage(text: string, attachments: Attachment[]) {
    if (!text.trim()) return;

    store.error = "";
    chatScroll.isChatAutoScroll = true;
    chatScroll.showChatScrollHint = false;

    const isSlash = store.isKnownSlashCommand(text);
    const slashCmd = isSlash ? (text.match(/^\/\S+/)?.[0] ?? null) : null;

    // ── @team / /team detection ──
    if (!store.run && !slashCmd) {
      const { detectTeamTrigger } = await import("$lib/services/team-dispatcher");
      const teamResult = detectTeamTrigger(text);
      if (teamResult) {
        team.teamDispatchPrompt = teamResult.prompt;
        team.teamDispatchOpen = true;
        return;
      }
    }

    try {
      if (!store.run) {
        // First message: create run
        const remoteHosts = opts.getRemoteHosts();
        if (
          store.remoteHostName &&
          remoteHosts.length > 0 &&
          !remoteHosts.some((h) => h.name === store.remoteHostName)
        ) {
          dbgWarn("chat", "remote host no longer in settings — clearing target", {
            host: store.remoteHostName,
          });
          opts.showChatToast(t("toast_remoteHostMissing"));
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
              localStorage.getItem(PROJECT_CWD_KEY) ||
              localStorage.getItem("ocv:settings-cwd") ||
              "";
          }
        }

        if (!cwd || cwd === "/") {
          const transport = getTransport();
          if (isRemote) {
            const result = await opts.openFolderPicker({
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
            localStorage.setItem(PROJECT_CWD_KEY, cwd);
            window.dispatchEvent(new Event("ocv:cwd-changed"));
          } else {
            const result = await opts.openFolderPicker({ initialHost: null });
            if (!result || !result.path) return;
            cwd = result.path;
            if (result.hostName) {
              store.remoteHostName = result.hostName;
              setLastTarget(result.hostName);
              setStoredRemoteCwd(result.hostName, cwd);
            } else {
              localStorage.setItem(PROJECT_CWD_KEY, cwd);
              window.dispatchEvent(new Event("ocv:cwd-changed"));
            }
          }
        }

        if (slashCmd) {
          processingSlashCmd = slashCmd;
          slashCmdSeenRunning = false;
        }

        const runId = await store.startSession(text, cwd, attachments);
        goto(`/chat?run=${runId}`, { replaceState: true });
        window.dispatchEvent(new Event("ocv:runs-changed"));
        loadCliVersionInfo();
      } else if (store.useStreamSession && !store.sessionAlive && store.run.session_id) {
        // Stopped stream session: atomic resume + send
        dbg("chat", "auto-resume on send", {
          runId: store.run.id,
          sessionId: store.run.session_id,
        });
        if (slashCmd) {
          processingSlashCmd = slashCmd;
          slashCmdSeenRunning = false;
        }
        await opts.handleResume("resume", undefined, text, attachments);
      } else {
        // Subsequent message
        if (slashCmd) {
          processingSlashCmd = slashCmd;
          slashCmdSeenRunning = false;
        }
        await store.sendMessage(text, attachments);
        requestAnimationFrame(() => opts.promptRef()?.focus());
      }
    } catch (e) {
      store.error = String(e);
      processingSlashCmd = null;
    }
  }

  return {
    get processingSlashCmd() {
      return processingSlashCmd;
    },
    get slashCmdSeenRunning() {
      return slashCmdSeenRunning;
    },
    loadRunProgressive,
    sendMessage,
  };
}
