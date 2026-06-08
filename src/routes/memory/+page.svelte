<script lang="ts">
  import { onMount } from "svelte";
  import { beforeNavigate } from "$app/navigation";
  import { page } from "$app/stores";
  import * as api from "$lib/api";
  import { LS_PROJECT_CWD } from "$lib/utils/storage-keys";
  import {
    EVT_PROJECT_CHANGED, EVT_MEMORY_SELECT, EVT_MEMORY_FILE_SELECTED, EVT_FILE_DIRTY,
  } from "$lib/utils/bus-events";
  import Button from "$lib/components/Button.svelte";
  import MarkdownContent from "$lib/components/MarkdownContent.svelte";
  import CodeEditor from "$lib/components/CodeEditor.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import SkeletonLine from "$lib/components/SkeletonLine.svelte";
  import { showToast } from "$lib/stores/toast-store.svelte";
  import { dbgWarn } from "$lib/utils/debug";
  import { memoryStore } from "$lib/stores/memory-store.svelte";
  import { getMemoryStats } from "$lib/services/memory-service";

  let viewMode = $state<"edit" | "preview">("edit");
  let content = $state("");
  let savedContent = $state("");
  let loading = $state(true);
  let saving = $state(false);
  let error = $state("");

  // The cwd that was active when the current content was loaded.
  // Used by save() so that switching projects before saving doesn't break permissions.
  let saveCwd = $state("");

  // Custom file from ?file= query param (overrides sidebar selection)
  let customFile = $derived($page.url.searchParams.get("file") ?? "");

  // Selected file path — set by sidebar click or initial auto-select
  let selectedFile = $state("");

  let projectCwd = $state(
    typeof window !== "undefined" ? (localStorage.getItem(LS_PROJECT_CWD) ?? "") : "",
  );

  // Memory stats display
  let memoryStats = $state<{
    wordCount: number;
    lineCount: number;
    hasFrontmatter: boolean;
  } | null>(null);

  let currentPath = $derived(customFile || selectedFile);

  // Page title: show filename for custom file, otherwise file label
  let pageTitle = $derived.by(() => {
    if (customFile) return customFile.split(/[/\\]/).pop() ?? "File";
    if (selectedFile) return selectedFile.split(/[/\\]/).pop() ?? "File";
    return "Memory";
  });

  // Only show preview toggle for markdown files
  let isMarkdown = $derived(currentPath.endsWith(".md"));

  // Dirty state: content differs from last saved/loaded version
  let isDirty = $derived(content !== savedContent);

  // Notify layout sidebar of dirty state
  $effect(() => {
    window.dispatchEvent(
      new CustomEvent(EVT_FILE_DIRTY, {
        detail: { path: currentPath, dirty: isDirty },
      }),
    );
  });

  // Update memory stats when content changes
  $effect(() => {
    if (content) {
      const stats = getMemoryStats(content);
      memoryStats = {
        wordCount: stats.wordCount,
        lineCount: stats.lineCount,
        hasFrontmatter: stats.hasFrontmatter,
      };
    } else {
      memoryStats = null;
    }
  });

  // --- Sequence guards for race condition protection ---
  let loadSeq = 0;
  let projectChangeSeq = 0;
  let autoSelectSeq = 0;

  /** Load file content. Pass explicit path to avoid $derived timing issues in event callbacks. */
  async function loadContentForPath(explicitPath: string) {
    const seq = ++loadSeq;
    if (!explicitPath) {
      content = "";
      savedContent = "";
      loading = false;
      return;
    }
    loading = true;
    error = "";
    try {
      // Use saveCwd if already established (e.g. Reload after cancelled project switch),
      // fall back to projectCwd for first load or after confirmed project switch.
      const cwdSnapshot = saveCwd || projectCwd;
      const text = await api.readTextFile(explicitPath, cwdSnapshot || undefined);
      if (seq !== loadSeq) return; // stale — discard
      content = text;
      savedContent = text;
      saveCwd = cwdSnapshot;
    } catch (e) {
      if (seq !== loadSeq) return;
      const msg = String(e);
      if (msg.includes("No such file") || msg.includes("not found")) {
        content = "";
        savedContent = "";
        saveCwd = projectCwd;
      } else {
        content = "";
        savedContent = "";
        saveCwd = projectCwd;
        error = msg;
      }
    } finally {
      if (seq === loadSeq) loading = false;
    }
  }

  /** Convenience wrapper: load content for the current path. */
  function loadContent() {
    loadContentForPath(currentPath);
  }

  /** Auto-select first existing file from candidates (initial load). */
  async function autoSelectFirst() {
    const seq = ++autoSelectSeq;
    try {
      const candidates = await api.listMemoryFiles(projectCwd || undefined);
      if (seq !== autoSelectSeq) return; // stale — discard

      // Update memory store with candidates
      memoryStore["_candidates"] = candidates;

      // Prefer first existing project file
      const existing = candidates.find((f) => f.exists && f.scope === "project");
      const fallback = candidates.find((f) => f.exists) ?? candidates[0];
      const pick = existing ?? fallback;
      if (pick) {
        selectedFile = pick.path;
        memoryStore.setSelectedPath(pick.path);
        // Sync sidebar highlight — but only when not in customFile mode,
        // otherwise the sidebar would highlight a file the editor isn't showing.
        if (!customFile) {
          window.dispatchEvent(
            new CustomEvent(EVT_MEMORY_FILE_SELECTED, { detail: { path: pick.path } }),
          );
        }
      }
    } catch (e) {
      if (seq !== autoSelectSeq) return;
      dbgWarn("memory", "autoSelectFirst failed", e);
    }
  }

  /** Guard a file switch: confirm dirty state before switching.
   *  When `exists` is false the file hasn't been created yet — skip the API
   *  round-trip so the editor doesn't flash a loading spinner. */
  function guardedFileSwitch(newPath: string, exists = true) {
    if (newPath === selectedFile) return; // same file — no-op
    if (isDirty && !confirm(t("memory_discardConfirm"))) return;
    saveCwd = ""; // reset so next load uses current projectCwd
    selectedFile = newPath;
    // Ack sidebar: highlight now confirmed (layout waits for this before updating)
    window.dispatchEvent(
      new CustomEvent(EVT_MEMORY_FILE_SELECTED, { detail: { path: newPath } }),
    );
    if (exists) {
      loadContentForPath(newPath);
    } else {
      // New file — set empty content directly, no loading flash
      ++loadSeq; // cancel any in-flight load
      content = "";
      savedContent = "";
      loading = false;
      saveCwd = projectCwd;
    }
  }

  /** Async variant for project change: refresh candidates -> auto-select -> load. */
  async function guardedProjectChange(newCwd: string) {
    // Always sync projectCwd with layout (layout already committed the switch).
    // This prevents page vs sidebar project mismatch on cancel.
    projectCwd = newCwd;
    if (isDirty && !confirm(t("memory_discardConfirm"))) return;
    // Confirmed — reset saveCwd so loadContentForPath picks up the new projectCwd
    saveCwd = "";
    const seq = ++projectChangeSeq;
    await autoSelectFirst();
    if (seq !== projectChangeSeq) return;
    await loadContent();
  }

  // customFile (query param) changes are SvelteKit navigations —
  // already guarded by beforeNavigate's dirty confirm.
  // Use a non-reactive tracker to avoid state_referenced_locally warning.
  let _customFileInit = false;
  let _prevCustomFile: string | undefined;
  $effect(() => {
    const f = customFile;
    if (!_customFileInit) {
      // First run — record initial value, let onMount handle initial load
      _customFileInit = true;
      _prevCustomFile = f;
      return;
    }
    if (f === _prevCustomFile) return;
    _prevCustomFile = f;
    // Cancel any in-flight chains so they don't overwrite
    ++projectChangeSeq;
    ++loadSeq;
    ++autoSelectSeq;
    if (f) {
      // Entering customFile mode — load the custom file directly
      loadContentForPath(f);
    } else {
      // Exiting customFile mode — selectedFile may be stale (old project).
      // Re-select best file for current project, then load its content.
      autoSelectFirst().then(() => {
        loadContentForPath(selectedFile);
      });
    }
  });

  // Initial load
  onMount(async () => {
    try {
      if (!customFile) {
        await autoSelectFirst();
      }
      await loadContent();
    } catch (e) {
      dbgWarn("memory-page", "initial load failed", e);
    }
  });

  // Listen for sidebar file selection
  onMount(() => {
    function onMemorySelect(e: Event) {
      const detail = (e as CustomEvent).detail;
      const path = detail?.path ?? "";
      if (path) {
        guardedFileSwitch(path, detail?.exists ?? true);
      }
    }
    window.addEventListener(EVT_MEMORY_SELECT, onMemorySelect);
    return () => window.removeEventListener(EVT_MEMORY_SELECT, onMemorySelect);
  });

  // Sync projectCwd when layout changes it
  onMount(() => {
    function onProjectChanged(e: Event) {
      const cwd = (e as CustomEvent).detail?.cwd ?? "";
      if (cwd === projectCwd) return;
      if (customFile) {
        projectCwd = cwd;
        // Fire-and-forget: refresh selectedFile for the new project so it's
        // correct when user later exits ?file= mode (no dirty check needed
        // since currentPath uses customFile, not selectedFile).
        autoSelectFirst();
        return;
      }
      guardedProjectChange(cwd);
    }
    window.addEventListener(EVT_PROJECT_CHANGED, onProjectChanged);
    return () => window.removeEventListener(EVT_PROJECT_CHANGED, onProjectChanged);
  });

  // Warn before navigating away with unsaved changes
  beforeNavigate(({ cancel }) => {
    if (isDirty && !confirm(t("memory_discardConfirm"))) {
      cancel();
    }
  });

  onMount(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (content !== savedContent) {
        e.preventDefault();
      }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  });

  async function save() {
    const path = currentPath;
    if (!path) return;
    saving = true;
    error = "";
    try {
      await api.writeTextFile(path, content, saveCwd || undefined);
      savedContent = content;
      memoryStore.setSavedContent(content);
      // Notify layout to refresh candidates (updates exists status in sidebar)
      window.dispatchEvent(new Event("ocv:memory-file-saved"));
      showToast(t("memory_saved"), "success");
    } catch (e) {
      error = String(e);
    } finally {
      saving = false;
    }
  }

  /**
   * Consolidate memory files: merge duplicates, fix stale entries, update index.
   */
  async function consolidateMemory() {
    if (!confirm(t("memory_consolidateConfirm"))) {
      return;
    }
    saving = true;
    error = "";
    try {
      const result = await memoryStore.consolidateMemory();
      if (result.errors.length > 0) {
        error = result.errors.join(", ");
      } else {
        showToast(t("memory_saved"), "success");
      }
    } catch (e) {
      error = String(e);
    } finally {
      saving = false;
    }
  }

  /**
   * Sync memory state across sessions.
   */
  async function syncMemory() {
    saving = true;
    error = "";
    try {
      await memoryStore.syncMemory();
      showToast(t("memory_saved"), "success");
    } catch (e) {
      error = String(e);
    } finally {
      saving = false;
    }
  }
</script>

<div class="flex h-full flex-col">
  <!-- Header bar: filename + dirty dot + path + edit/preview toggle -->
  <div class="flex items-center justify-between border-b px-4 py-2 shrink-0">
    <div class="flex items-center gap-3 min-w-0">
      <span class="text-sm font-medium truncate">{pageTitle}</span>
      {#if isDirty}
        <span class="h-2 w-2 rounded-full bg-primary shrink-0" title={t("memory_unsavedChanges")}
        ></span>
      {/if}
      {#if currentPath}
        <span
          class="text-[11px] text-muted-foreground truncate hidden sm:inline"
          title={currentPath}>{currentPath}</span
        >
      {/if}
    </div>
    <div class="flex items-center gap-2 shrink-0">
      {#if isMarkdown}
        <div class="flex rounded-md border bg-background p-0.5">
          <button type="button"
            class="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition-colors
              {viewMode === 'edit'
              ? 'bg-muted text-foreground'
              : 'text-muted-foreground hover:text-foreground'}"
            onclick={() => (viewMode = "edit")}
          >
            <svg
              class="h-3 w-3"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              ><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /><path
                d="m15 5 4 4"
              /></svg
            >
            {t("common_edit")}
          </button>
          <button type="button"
            class="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition-colors
              {viewMode === 'preview'
              ? 'bg-muted text-foreground'
              : 'text-muted-foreground hover:text-foreground'}"
            onclick={() => (viewMode = "preview")}
          >
            <svg
              class="h-3 w-3"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              ><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><circle
                cx="12"
                cy="12"
                r="3"
              /></svg
            >
            {t("common_preview")}
          </button>
        </div>
      {/if}
    </div>
  </div>

  <!-- Content area -->
  {#if !currentPath}
    <div class="flex flex-1 flex-col items-center justify-center gap-3">
      <svg
        class="h-10 w-10 text-muted-foreground/30"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        ><path
          d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"
        /></svg
      >
      <p class="text-sm text-muted-foreground">{t("memory_setProjectFirst")}</p>
    </div>
  {:else if loading}
    <div class="flex flex-1 flex-col gap-3 p-4">
      <SkeletonLine width="40%" height="1.25rem" />
      <SkeletonLine width="100%" height="0.75rem" />
      <SkeletonLine width="90%" height="0.75rem" />
      <SkeletonLine width="95%" height="0.75rem" />
      <SkeletonLine width="60%" height="0.75rem" />
      <div class="h-4"></div>
      <SkeletonLine width="35%" height="1.25rem" />
      <SkeletonLine width="100%" height="0.75rem" />
      <SkeletonLine width="80%" height="0.75rem" />
    </div>
  {:else if viewMode === "preview" && isMarkdown}
    <div class="flex-1 overflow-y-auto p-4">
      {#if content}
        <MarkdownContent text={content} />
      {:else}
        <p class="text-sm text-muted-foreground italic">{t("memory_noContent")}</p>
      {/if}
    </div>
  {:else}
    <CodeEditor bind:content filePath={currentPath} onsave={save} class="flex-1" />
  {/if}

  <!-- Error -->
  {#if error}
    <div
      class="shrink-0 border-t border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive"
    >
      {error}
    </div>
  {/if}

  <!-- Bottom action bar -->
  {#if currentPath && !loading}
    <div class="flex items-center justify-between border-t px-4 py-2 shrink-0">
      <div class="flex items-center gap-2">
        <Button onclick={save} loading={saving}>
          {#snippet children()}
            {t("common_save")}
          {/snippet}
        </Button>
        <Button variant="outline" onclick={loadContent}>
          {#snippet children()}
            {t("memory_reload")}
          {/snippet}
        </Button>
      </div>
      <div class="flex items-center gap-2">
        {#if memoryStats}
          <span class="text-xs text-muted-foreground">
            {memoryStats.wordCount} words, {memoryStats.lineCount} lines
            {#if memoryStats.hasFrontmatter}
              <span class="ml-1 text-primary" title={t("memory_hasFrontmatter")}>*</span>
            {/if}
          </span>
        {/if}
        <Button
          variant="outline"
          size="sm"
          onclick={consolidateMemory}
          loading={memoryStore.consolidating}
        >
          {#snippet children()}
            Consolidate
          {/snippet}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onclick={syncMemory}
          loading={memoryStore.syncState.syncInProgress}
        >
          {#snippet children()}
            Sync
          {/snippet}
        </Button>
      </div>
    </div>
  {/if}
</div>
