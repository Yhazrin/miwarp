/**
 * URL-derived state composable — extracted from +page.svelte.
 *
 * Manages all URL search-param derived reactive state and the effects
 * that consume ?folder=, ?host=, ?resume=, ?sf= params.
 */
import { untrack } from "svelte";
import { replaceState } from "$app/navigation";
import type { RemoteHost } from "$lib/types";
import { dbg, dbgWarn } from "$lib/utils/debug";
import { setLastTarget, setStoredRemoteCwd } from "$lib/utils/remote-cwd";
import { normalizeCwd } from "$lib/utils/sidebar-groups";

type SessionTerminalRef = {
  clear(): void;
  writeText(text: string): void;
};

export interface UrlParamsDeps {
  pageUrl: () => URL; // () => $page.url
  store: {
    remoteHostName: string | null;
    sessionCwd: string;
    effectiveCwd: string;
    loadRun: (id: string, xtermRef?: SessionTerminalRef) => Promise<void> | void;
    resumeInFlight: boolean;
    run: { readonly id: string } | null;
    timeline: readonly unknown[];
  };
  getRemoteHosts: () => RemoteHost[];
  chatViewCache: {
    lastRunId: string;
    toolPanelActiveTab: unknown;
    sidebarCollapsed: boolean;
    requestedPreviewPath: string | null;
  };
  getPromptRef: () => { focus: () => void } | undefined;
  getSettingsCache: () => unknown;
  getXtermRef: () => SessionTerminalRef | undefined;
  setFolderCwdOverride: (v: string) => void;
  setSelectedWorkspaceCwd: (v: string) => void;
}

export function createUrlParams(deps: UrlParamsDeps) {
  // URL-derived primitive values (avoids $effect re-trigger on unrelated URL changes)
  const runId = $derived(deps.pageUrl().searchParams.get("run") ?? "");
  const hasNewParam = $derived(deps.pageUrl().searchParams.has("new"));
  const hasResumeParam = $derived(deps.pageUrl().searchParams.has("resume"));
  const folderParam = $derived(deps.pageUrl().searchParams.get("folder"));
  const hostParam = $derived(deps.pageUrl().searchParams.get("host"));

  // Pending logical-folder from ?sf=<folderId> (sidebar "new session in folder")
  let pendingSubFolderId = $state<string>("");
  $effect(() => {
    const sf = deps.pageUrl().searchParams.get("sf");
    if (sf) pendingSubFolderId = sf;
  });

  // Consume ?folder= and/or ?host= params → switch target/folder, then clean URL
  $effect(() => {
    const folder = folderParam;
    const host = hostParam;
    if (!folder && !host) return;
    untrack(() => {
      dbg("chat", "url params", { folder, host });
      let resolvedHost: string | null = null;
      if (host !== null) {
        if (host === "") {
          resolvedHost = null;
        } else {
          const hosts = deps.getRemoteHosts();
          if (hosts.length === 0 || hosts.some((h) => h.name === host)) {
            resolvedHost = host;
          } else {
            dbgWarn("chat", "URL ?host= references unknown remote — ignoring", { host });
            resolvedHost = null;
          }
        }
        deps.store.remoteHostName = resolvedHost;
        setLastTarget(resolvedHost);
      }
      if (folder) {
        const normalizedFolder = normalizeCwd(folder);
        if (resolvedHost) {
          setStoredRemoteCwd(resolvedHost, normalizedFolder);
        } else if (normalizedFolder) {
          try {
            localStorage.setItem("ocv:project-cwd", normalizedFolder);
          } catch {
            // localStorage may fail in restricted contexts
          }
          window.dispatchEvent(new Event("ocv:cwd-changed"));
        }
        deps.setFolderCwdOverride(normalizedFolder);
        deps.setSelectedWorkspaceCwd(normalizedFolder);
        deps.store.sessionCwd = normalizedFolder;
        deps.chatViewCache.lastRunId = "";
        deps.store.loadRun("", deps.getXtermRef());
      }
      const clean = new URL(deps.pageUrl());
      clean.searchParams.delete("folder");
      clean.searchParams.delete("host");
      clean.searchParams.delete("sf");
      replaceState(clean, {});
      requestAnimationFrame(() => deps.getPromptRef()?.focus());
    });
  });

  function consumePendingSubFolderId(): string {
    const v = pendingSubFolderId;
    pendingSubFolderId = "";
    return v;
  }

  return {
    get runId() {
      return runId;
    },
    get hasNewParam() {
      return hasNewParam;
    },
    get hasResumeParam() {
      return hasResumeParam;
    },
    get pendingSubFolderId() {
      return pendingSubFolderId;
    },
    consumePendingSubFolderId,
  };
}
