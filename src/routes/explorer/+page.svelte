<script lang="ts">
  import { dbg, dbgWarn } from "$lib/utils/debug";
  import { onMount } from "svelte";
  import FilePreviewPane from "$lib/components/FilePreviewPane.svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import Spinner from "$lib/components/Spinner.svelte";
  import { getCachedFile, setCachedFile, clearCachedFile } from "$lib/utils/explorer-state";

  // ── State ──

  let selectedFilePath = $state("");
  let diffViewFile = $state<string | null>(null);
  let activeView = $state<"preview" | "diff">("preview");

  let projectCwd = $state(
    typeof window !== "undefined" ? (localStorage.getItem("ocv:project-cwd") ?? "") : "",
  );

  /** True while we're restoring from cache — onLoadFailed should clear that cache entry. */
  let restoringFromCache = false;

  /** Mirror of FilePreviewPane.fileDirty for navigation guards. */
  let paneDirty = $state(false);

  /** Track loading and error state from FilePreviewPane callbacks. */
  let fileLoading = $state(false);
  let fileError = $state<string | null>(null);

  /** Returns true if it's safe to navigate away (no dirty changes, or user confirmed discard). */
  function canDiscardEdits(): boolean {
    if (!paneDirty) return true;
    return confirm(t("explorer_discardConfirm"));
  }

  // ── Pane control ──

  function selectFile(path: string) {
    if (path === selectedFilePath && activeView === "preview") return;
    if (!canDiscardEdits()) return;
    selectedFilePath = path;
    activeView = "preview";
    diffViewFile = null;
    fileLoading = !!path;
    fileError = null;
  }

  function openFileDiff(filePath: string) {
    if (!canDiscardEdits()) return;
    diffViewFile = filePath;
    activeView = "diff";
  }

  function closeDiffView() {
    diffViewFile = null;
    activeView = "preview";
  }

  function handleLoaded(p: string) {
    setCachedFile(projectCwd, p);
    restoringFromCache = false;
    fileLoading = false;
    fileError = null;
  }

  function handleLoadFailed(p: string, err: string) {
    fileLoading = false;
    fileError = err;
    if (restoringFromCache) {
      dbgWarn("explorer", "cache restore failed, clearing", { cwd: projectCwd, cached: p, err });
      clearCachedFile(projectCwd);
      selectedFilePath = "";
      restoringFromCache = false;
      fileError = null;
      window.dispatchEvent(new CustomEvent("ocv:explorer-file-selected", { detail: { path: "" } }));
    }
  }

  // ── Lifecycle ──

  onMount(() => {
    function onExplorerFile(e: Event) {
      const path = (e as CustomEvent).detail?.path;
      if (path) selectFile(path);
    }
    window.addEventListener("ocv:explorer-file", onExplorerFile);

    function onExplorerDiff(e: Event) {
      const path = (e as CustomEvent).detail?.path;
      if (path) openFileDiff(path);
    }
    window.addEventListener("ocv:explorer-diff", onExplorerDiff);

    function onProjectChanged(e: Event) {
      const cwd = (e as CustomEvent).detail?.cwd ?? "";
      if (cwd === projectCwd) return;
      if (!canDiscardEdits()) return;

      // Save current project state before switching
      if (projectCwd && selectedFilePath) {
        setCachedFile(projectCwd, selectedFilePath);
      }

      // Switch project; pane will see scopeKey change and reset
      projectCwd = cwd;
      diffViewFile = null;
      activeView = "preview";

      const cached = getCachedFile(cwd);
      if (cached) {
        dbg("explorer", "restoring cached file on project switch", { cwd, cached });
        restoringFromCache = true;
        selectedFilePath = cached;
        window.dispatchEvent(
          new CustomEvent("ocv:explorer-file-selected", { detail: { path: cached } }),
        );
      } else {
        dbg("explorer", "no cache for project, clearing", { cwd });
        selectedFilePath = "";
        window.dispatchEvent(
          new CustomEvent("ocv:explorer-file-selected", { detail: { path: "" } }),
        );
      }
    }
    window.addEventListener("ocv:project-changed", onProjectChanged);

    // Restore cached file state on mount
    const cached = getCachedFile(projectCwd);
    if (cached && !selectedFilePath) {
      dbg("explorer", "restoring cached file on mount", { cwd: projectCwd, cached });
      restoringFromCache = true;
      selectedFilePath = cached;
      window.dispatchEvent(
        new CustomEvent("ocv:explorer-file-selected", { detail: { path: cached } }),
      );
    }

    return () => {
      if (projectCwd && selectedFilePath) {
        dbg("explorer", "saving file state on unmount", {
          cwd: projectCwd,
          file: selectedFilePath,
        });
        setCachedFile(projectCwd, selectedFilePath);
      }
      window.removeEventListener("ocv:explorer-file", onExplorerFile);
      window.removeEventListener("ocv:explorer-diff", onExplorerDiff);
      window.removeEventListener("ocv:project-changed", onProjectChanged);
    };
  });

  // Path passed to pane: in diff mode use diffViewFile, else selectedFilePath
  let panePath = $derived(activeView === "diff" ? (diffViewFile ?? "") : selectedFilePath);
</script>

<div class="flex h-full flex-col overflow-hidden">
  {#if !panePath && !fileLoading}
    <div class="flex h-full items-center justify-center bg-background">
      <EmptyState
        icon="&#128196;"
        title={t("explorer_noFileSelected")}
        description={t("explorer_emptyStateDesc")}
      />
    </div>
  {:else if fileLoading && !fileError}
    <div class="flex h-full flex-col items-center justify-center gap-3 bg-background">
      <Spinner size="md" />
      <p class="text-sm text-muted-foreground">{t("explorer_loading")}</p>
    </div>
  {:else if fileError}
    <div class="flex h-full flex-col items-center justify-center gap-3 bg-background p-4">
      <svg
        class="h-8 w-8 text-destructive/60"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line
          x1="12"
          y1="16"
          x2="12.01"
          y2="16"
        />
      </svg>
      <p class="text-sm font-medium text-foreground">{t("explorer_loadFailed")}</p>
      <p class="text-xs text-muted-foreground text-center max-w-[300px]">{fileError}</p>
      <button type="button"
        class="mt-2 rounded-md px-3 py-1.5 text-xs font-medium bg-muted text-foreground hover:bg-muted/80 transition-colors"
        onclick={() => {
          fileError = null;
          fileLoading = !!selectedFilePath;
        }}
      >
        {t("common_retry")}
      </button>
    </div>
  {:else}
    <FilePreviewPane
      cwd={projectCwd}
      path={panePath}
      mode={activeView}
      editable={true}
      isRemote={false}
      scopeKey={projectCwd}
      onLoaded={handleLoaded}
      onLoadFailed={handleLoadFailed}
      onCloseDiff={closeDiffView}
      onDirtyChange={(d) => (paneDirty = d)}
    />
  {/if}
</div>
