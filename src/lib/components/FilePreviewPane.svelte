<script lang="ts">
  import { getGitDiff, readTextFile, readFileBase64, writeTextFile, statTextFile } from "$lib/api";
  import { dbg } from "$lib/utils/debug";
  import { fileName as pathFileName } from "$lib/utils/format";
  import { t } from "$lib/i18n/index.svelte";
  import Spinner from "$lib/components/Spinner.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import { classifyPath, getExtension, isImage, isPreviewable } from "$lib/utils/preview-ext";
  import { validateInspectorPath } from "$lib/utils/inspector-path";
  import {
    shouldLoadCodeEditor,
    shouldLoadMarkdownRenderer,
    shouldShowHighlightedCode,
  } from "./preview-pane-loader";
  import type CodeEditor from "./CodeEditor.svelte";
  import type HighlightedCode from "./HighlightedCode.svelte";
  import type MiMarkdownRenderer from "./MiMarkdownRenderer.svelte";

  // ── Props ──
  let {
    cwd,
    path,
    mode = "preview",
    editable = false,
    editCapable = false,
    isRemote = false,
    scopeKey = "",
    active = true,
    /**
     * Bumping this value forces the pane to re-fetch the current file even when
     * `path` and `scopeKey` are unchanged. The parent uses it for "Retry" — the
     * pane internally listens via $effect alongside the other dependency props.
     */
    reloadToken = 0,
    onLoaded,
    onLoadFailed,
    onCloseDiff,
    onDirtyChange,
    onToggleEditMode,
  }: {
    cwd: string;
    path: string;
    mode?: "preview" | "diff";
    editable?: boolean;
    /** When true, show explicit enter/exit edit controls (explorer page). */
    editCapable?: boolean;
    isRemote?: boolean;
    scopeKey?: string;
    /** When false (parent tab inactive), do NOT initiate new loads; existing content is preserved. */
    active?: boolean;
    reloadToken?: number;
    onLoaded?: (path: string) => void;
    onLoadFailed?: (path: string, err: string) => void;
    onCloseDiff?: () => void;
    /** Fires whenever fileDirty transitions; parents can use this for navigation guards. */
    onDirtyChange?: (dirty: boolean) => void;
    /** Parent-owned edit toggle (explorer: read-only preview until user clicks Edit). */
    onToggleEditMode?: (editing: boolean) => void;
  } = $props();

  // ── State ──
  /**
   * Single authoritative load state. The pane itself owns loading/error/too-large
   * entirely — the parent must NEVER gate mount() on these. They are surfaced as
   * overlay rendering inside the pane, so the pane remains mounted across file
   * switches and retries.
   */
  type LoadState = "idle" | "loading" | "ready" | "error" | "too_large" | "remote_unsupported";

  let loadState = $state<LoadState>("idle");

  let fileContent = $state("");
  let imageDataUrl = $state("");
  let originalContent = "";
  let fileError = $state("");
  let fileDirty = $state(false);
  let fileSaving = $state(false);
  let editorMode = $state<"edit" | "rendered">("edit");
  let fileSize = $state(0);

  /** Files larger than this are not auto-previewed (CodeMirror init becomes very slow). */
  const MAX_PREVIEW_SIZE = 1_000_000; // 1MB

  /** Diff lines beyond this fall back to a summary notice instead of rendering each `<tr>`.
   *  Full virtualized diff viewer is a separate P2 effort. */
  const MAX_DIFF_LINES = 5000;

  let diffContent = $state("");
  let diffLoading = $state(false);

  /**
   * Local retry counter — the in-pane "Retry" button bumps this to re-fire the
   * same `$effect` without requiring the parent to track loading state.
   */
  let retryCounter = $state(0);

  let loadSeq = 0;

  // ── Diff parsing ──
  interface DiffLine {
    text: string;
    type: "add" | "del" | "context" | "hunk" | "header";
    oldNum: number | null;
    newNum: number | null;
  }

  function parseDiffLines(raw: string): DiffLine[] {
    const result: DiffLine[] = [];
    let oldLine = 0;
    let newLine = 0;
    for (const text of raw.split("\n")) {
      if (text.startsWith("@@")) {
        const match = text.match(/@@ -(\d+)(?:,\d+)? \+(\d+)/);
        if (match) {
          oldLine = parseInt(match[1], 10);
          newLine = parseInt(match[2], 10);
        }
        result.push({ text, type: "hunk", oldNum: null, newNum: null });
      } else if (
        text.startsWith("diff ") ||
        text.startsWith("index ") ||
        text.startsWith("---") ||
        text.startsWith("+++")
      ) {
        result.push({ text, type: "header", oldNum: null, newNum: null });
      } else if (text.startsWith("+")) {
        result.push({ text, type: "add", oldNum: null, newNum: newLine });
        newLine++;
      } else if (text.startsWith("-")) {
        result.push({ text, type: "del", oldNum: oldLine, newNum: null });
        oldLine++;
      } else {
        result.push({ text, type: "context", oldNum: oldLine, newNum: newLine });
        oldLine++;
        newLine++;
      }
    }
    return result;
  }

  // ── Loaders ──
  async function loadPreview(p: string, c: string): Promise<void> {
    // v1.0.6 / 5.3: path safety check before loading
    const validation = validateInspectorPath(p, c);
    if (!validation.valid) {
      fileError = validation.reason ?? "Path not allowed";
      fileContent = "";
      loadState = "error";
      return;
    }

    const seq = ++loadSeq;
    fileError = "";
    fileSize = 0;
    const ext = getExtension(p);
    editorMode = isPreviewable(ext) ? "rendered" : "edit";
    loadState = "loading";
    fileDirty = false;
    imageDataUrl = "";

    try {
      if (isImage(ext)) {
        const [base64, mime] = await readFileBase64(p, c);
        if (seq !== loadSeq) return;
        imageDataUrl = `data:${mime};base64,${base64}`;
        fileContent = "";
        originalContent = "";
      } else {
        // Stat first (cheap metadata) so multi-MB files don't pay readTextFile's full
        // disk-read + IPC + JS string allocation cost just to be discarded by the size guard.
        // Stat failures fall through to readTextFile so the existing error path stays intact.
        let preReadSize: number | null = null;
        try {
          preReadSize = await statTextFile(p, c);
          if (seq !== loadSeq) return;
        } catch (e) {
          dbg("preview-pane", "stat failed, falling through to read", { path: p, err: String(e) });
        }
        if (preReadSize !== null && preReadSize > MAX_PREVIEW_SIZE) {
          fileSize = preReadSize;
          loadState = "too_large";
          fileContent = "";
          originalContent = "";
        } else {
          const content = await readTextFile(p, c);
          if (seq !== loadSeq) return;
          fileSize = content.length;
          // Defense-in-depth: stat may return stale/inaccurate size on some filesystems
          // (e.g. sparse files, network mounts). Re-check after read.
          if (content.length > MAX_PREVIEW_SIZE) {
            loadState = "too_large";
            fileContent = "";
            originalContent = "";
          } else {
            fileContent = content;
            originalContent = content;
          }
        }
      }
      dbg("preview-pane", "file loaded", {
        path: p,
        size: fileSize,
        state: loadState,
      });
      // Mark ready only when seq still matches (avoid clobbering a newer load).
      if (seq === loadSeq) loadState = "ready";
      onLoaded?.(p);
    } catch (e) {
      if (seq !== loadSeq) return;
      fileContent = "";
      originalContent = "";
      imageDataUrl = "";
      fileError = String(e);
      if (seq === loadSeq) loadState = "error";
      onLoadFailed?.(p, String(e));
    }
  }

  async function loadDiff(p: string, c: string): Promise<void> {
    const seq = ++loadSeq;
    diffLoading = true;
    diffContent = "";
    try {
      let content = await getGitDiff(c, false, p);
      if (!content.trim()) {
        content = await getGitDiff(c, true, p);
      }
      if (seq !== loadSeq) return;
      diffContent = content;
    } catch (e) {
      if (seq !== loadSeq) return;
      diffContent = String(e);
    } finally {
      if (seq === loadSeq) diffLoading = false;
    }
  }

  async function saveFile(): Promise<void> {
    if (!path || fileSaving || !fileDirty || !editable || isRemote) return;
    // Snapshot what we're writing — user keystrokes during await must not be silently
    // marked as saved.
    const contentToSave = fileContent;
    fileSaving = true;
    try {
      await writeTextFile(path, contentToSave, cwd);
      originalContent = contentToSave;
      // Re-evaluate dirty against the latest content; if user typed during the write,
      // they remain dirty against the just-persisted snapshot.
      fileDirty = fileContent !== contentToSave;
      dbg("preview-pane", "file saved", { path, dirtyAfterSave: fileDirty });
    } catch (e) {
      dbg("preview-pane", "save error", e);
    } finally {
      fileSaving = false;
    }
  }

  // ── Reactive load ──
  // Svelte 5: read all reactive props inside the effect to register dependency tracking.
  $effect(() => {
    // Establish dependencies: cwd, path, mode, scopeKey, isRemote, active, reloadToken.
    // reloadToken lets parents force a re-fetch without changing path; retryCounter
    // lets the pane's own "Retry" button do the same internally.
    void scopeKey;
    void reloadToken;
    void retryCounter;
    const _cwd = cwd;
    const _path = path;
    const _mode = mode;
    const _isRemote = isRemote;
    const _active = active;

    // Inactive (parent tab hidden): keep already-loaded content visible, but don't
    // initiate new IPC loads on cwd/path/mode/scopeKey/reloadToken changes.
    if (!_active) return;

    // Reset on remote or empty path
    if (_isRemote) {
      ++loadSeq;
      diffLoading = false;
      fileContent = "";
      originalContent = "";
      imageDataUrl = "";
      diffContent = "";
      fileError = "";
      fileDirty = false;
      loadState = "remote_unsupported";
      return;
    }

    if (!_path) {
      ++loadSeq;
      diffLoading = false;
      fileContent = "";
      originalContent = "";
      imageDataUrl = "";
      diffContent = "";
      fileError = "";
      fileDirty = false;
      loadState = "idle";
      return;
    }

    if (_mode === "diff") {
      // Diff mode has no editable buffer — clear any lingering preview dirty state so
      // navigation guards (parent's onDirtyChange mirror) don't keep prompting after the
      // user already confirmed discard to enter diff.
      fileDirty = false;
      originalContent = fileContent;
      loadDiff(_path, _cwd);
    } else {
      loadPreview(_path, _cwd);
    }
  });

  // Track dirty state when CodeEditor updates content
  $effect(() => {
    if (loadState !== "loading") {
      fileDirty = fileContent !== originalContent;
    }
  });

  // Notify parent of dirty transitions (for navigation guards in editable contexts)
  let _lastDirty = false;
  $effect(() => {
    const d = fileDirty;
    if (d !== _lastDirty) {
      _lastDirty = d;
      onDirtyChange?.(d);
    }
  });

  // ── Derived ──
  let kind = $derived(classifyPath(path));
  let displayName = $derived(path ? pathFileName(path) : "");
  let canSave = $derived(editable && !isRemote && !fileSaving);

  const editorLoadInput = $derived({
    path,
    mode,
    editable,
    isRemote,
    loadState,
    editorMode,
  });

  // ── Lazy-loaded components ──
  //
  // CodeEditor and MiMarkdownRenderer each pull a heavy dep graph (CodeMirror ~1.5MB,
  // markdown + TOC + lightbox). We dynamically import them only when the relevant
  // state lands, instead of statically importing at module load. The loaded component
  // is cached: navigating between files that both need CodeEditor does NOT re-import.

  // Type-only imports keep the lazy chunk boundary clean: the *type* is erased at
  // build time, so this doesn't pull CodeEditor / MiMarkdownRenderer into the
  // initial bundle — only the dynamic import() below does, and only on demand.
  let CodeEditorComponent = $state<typeof CodeEditor | null>(null);
  let MiMarkdownRendererComponent = $state<typeof MiMarkdownRenderer | null>(null);
  let HighlightedCodeComponent = $state<typeof HighlightedCode | null>(null);
  /** Track in-flight imports so concurrent triggers don't double-fetch. */
  let codeEditorLoading: Promise<void> | null = null;
  let markdownRendererLoading: Promise<void> | null = null;
  let highlightedCodeLoading: Promise<void> | null = null;

  const codeEditorTrigger = $derived(shouldLoadCodeEditor(editorLoadInput));

  const markdownRendererTrigger = $derived(
    shouldLoadMarkdownRenderer({
      path,
      mode,
      editorMode,
      loadState,
      hasContent: !!fileContent,
    }),
  );

  const showHighlightedCode = $derived(shouldShowHighlightedCode(editorLoadInput));

  // Kick off CodeEditor import the first time the trigger fires. Once loaded,
  // stays loaded — the chunk is already in memory and CodeMirror's onMount cost is
  // a one-shot regardless of filePath, so re-importing on every navigation would
  // just waste a network round-trip.
  $effect(() => {
    if (!codeEditorTrigger) return;
    if (CodeEditorComponent !== null) return;
    if (codeEditorLoading) return;
    codeEditorLoading = (async () => {
      try {
        const mod = await import("./CodeEditor.svelte");
        CodeEditorComponent = mod.default;
      } catch (e) {
        dbg("preview-pane", "code-editor dynamic import failed", String(e));
      } finally {
        codeEditorLoading = null;
      }
    })();
  });

  $effect(() => {
    if (!markdownRendererTrigger) return;
    if (MiMarkdownRendererComponent !== null) return;
    if (markdownRendererLoading) return;
    markdownRendererLoading = (async () => {
      try {
        const mod = await import("./MiMarkdownRenderer.svelte");
        MiMarkdownRendererComponent = mod.default;
      } catch (e) {
        dbg("preview-pane", "markdown renderer dynamic import failed", String(e));
      } finally {
        markdownRendererLoading = null;
      }
    })();
  });

  $effect(() => {
    if (!showHighlightedCode) return;
    if (HighlightedCodeComponent !== null) return;
    if (highlightedCodeLoading) return;
    highlightedCodeLoading = (async () => {
      try {
        const mod = await import("./HighlightedCode.svelte");
        HighlightedCodeComponent = mod.default;
      } catch (e) {
        dbg("preview-pane", "highlighted code dynamic import failed", String(e));
      } finally {
        highlightedCodeLoading = null;
      }
    })();
  });
</script>

<!--
  Layout strategy:
  - editable=false (chat right panel): uses HighlightedCode (hljs <pre>). No CodeMirror
    in the chat context. This avoids CodeMirror's style-mod CSS injection which causes
    ~2.5s style recalc storms in WKWebView every time langCompartment.reconfigure runs
    (verified by replacing CodeEditor with raw <pre>: clicks went from 2s → 10ms).
  - editable=true (explorer page): keeps CodeEditor for editing capabilities. Explorer
    is a separate page where the one-time CodeMirror cost is acceptable.
  All other states (loading/error/image/markdown/empty/diff/remote) render as absolute
  overlays on top of the bottom-layer CodeEditor/HighlightedCode.
-->
<div class="flex h-full flex-col overflow-hidden">
  <!-- Preview header (only in preview mode with a real path) -->
  {#if !isRemote && path && mode === "preview"}
    <div class="flex items-center gap-2 border-b px-3 py-1.5 shrink-0">
      <svg
        class="h-3.5 w-3.5 shrink-0 opacity-40"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        ><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path
          d="M14 2v4a2 2 0 0 0 2 2h4"
        /></svg
      >
      <span class="text-sm font-medium text-foreground min-w-0 truncate">{displayName}</span>
      {#if fileDirty}
        <span
          class="h-2 w-2 rounded-full bg-miwarp-status-warning shrink-0"
          title={t("explorer_modified")}
        ></span>
      {/if}
      <span class="text-[11px] text-muted-foreground truncate flex-1 min-w-0">{path}</span>
      {#if kind === "markdown"}
        <div class="flex rounded-md border bg-background p-0.5 shrink-0">
          <button
            type="button"
            class="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition-colors
              {editorMode === 'edit'
              ? 'bg-muted text-foreground'
              : 'text-muted-foreground hover:text-foreground'}"
            onclick={() => (editorMode = "edit")}
          >
            {t("common_edit")}
          </button>
          <button
            type="button"
            class="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition-colors
              {editorMode === 'rendered'
              ? 'bg-muted text-foreground'
              : 'text-muted-foreground hover:text-foreground'}"
            onclick={() => (editorMode = "rendered")}
          >
            {t("common_preview")}
          </button>
        </div>
      {/if}
      {#if editCapable && kind !== "image" && mode === "preview"}
        {#if editable}
          <button
            type="button"
            class="rounded-md border border-sidebar-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors shrink-0 hover:bg-muted hover:text-foreground"
            onclick={() => onToggleEditMode?.(false)}
          >
            {t("explorer_exitEditMode")}
          </button>
        {:else}
          <button
            type="button"
            class="rounded-md border border-sidebar-border px-2.5 py-1 text-[11px] font-medium text-foreground transition-colors shrink-0 hover:bg-muted"
            onclick={() => onToggleEditMode?.(true)}
          >
            {t("explorer_enterEditMode")}
          </button>
        {/if}
      {/if}
      {#if editable && kind !== "image"}
        <button
          type="button"
          class="rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors shrink-0 disabled:opacity-40 {fileDirty
            ? 'bg-primary text-primary-foreground hover:bg-primary/90'
            : 'bg-muted text-muted-foreground cursor-default'}"
          disabled={!fileDirty || !canSave || editorMode === "rendered"}
          title={editorMode === "rendered" ? t("explorer_saveDisabledInPreview") : ""}
          onclick={saveFile}
        >
          {fileSaving ? t("explorer_saving") : t("explorer_save")}
        </button>
      {/if}
    </div>
  {/if}

  <!-- Diff header (only in diff mode) -->
  {#if !isRemote && path && mode === "diff"}
    <div class="flex items-center gap-2 border-b px-3 py-1.5 shrink-0">
      {#if onCloseDiff}
        <button
          type="button"
          class="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          onclick={() => onCloseDiff?.()}
          title={t("explorer_closeDiff")}
          aria-label={t("explorer_closeDiff")}
        >
          <Icon name="chevron-left" size="md" />
        </button>
      {/if}
      <span class="text-sm font-medium text-foreground flex-1 min-w-0 truncate">{path}</span>
    </div>
  {/if}

  <!-- Content area: renderers mount on-demand — no hidden CodeEditor layer -->
  <div class="flex-1 overflow-hidden min-h-0 relative">
    {#if codeEditorTrigger && CodeEditorComponent}
      <CodeEditorComponent
        bind:content={fileContent}
        filePath={path || ""}
        onsave={saveFile}
        class="h-full"
      />
    {:else if codeEditorTrigger}
      <!-- CodeEditor chunk still loading (post-Edit click) — show a brief spinner so the
           preview surface doesn't flash empty before CodeMirror mounts. -->
      <div class="flex h-full items-center justify-center bg-background">
        <Spinner size="md" />
      </div>
    {:else if showHighlightedCode && HighlightedCodeComponent}
      <HighlightedCodeComponent content={fileContent} filePath={path || ""} class="h-full" />
    {:else if showHighlightedCode}
      <!-- HighlightedCode chunk still loading — show a brief spinner so the
           preview surface doesn't flash empty before hljs + github-dark CSS arrive. -->
      <div class="flex h-full items-center justify-center bg-background">
        <Spinner size="md" />
      </div>
    {/if}

    <!-- Overlays: only one rendered at a time -->
    {#if isRemote}
      <div class="absolute inset-0 flex items-center justify-center p-4 bg-background">
        <div class="flex flex-col items-center gap-2 text-center">
          <svg
            class="h-8 w-8 text-muted-foreground/40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            ><circle cx="12" cy="12" r="10" /><path d="M2 12h20" /><path
              d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"
            /></svg
          >
          <p class="text-sm text-muted-foreground">{t("preview_remoteUnsupported")}</p>
        </div>
      </div>
    {:else if !path}
      <div class="absolute inset-0 flex items-center justify-center p-4 bg-background">
        <div class="flex flex-col items-center gap-2 text-center">
          <svg
            class="h-8 w-8 text-muted-foreground/30"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            ><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path
              d="M14 2v4a2 2 0 0 0 2 2h4"
            /></svg
          >
          <p class="text-sm text-muted-foreground">{t("filesPanel_noPreviewSelected")}</p>
        </div>
      </div>
    {:else if mode === "diff"}
      <div class="absolute inset-0 overflow-auto bg-background">
        {#if diffLoading}
          <div class="flex items-center justify-center py-12">
            <Spinner size="md" />
          </div>
        {:else if diffContent.trim()}
          {@const diffLines = parseDiffLines(diffContent)}
          {#if diffLines.length > MAX_DIFF_LINES}
            <div class="flex flex-col items-center gap-2 py-12 text-center px-4">
              <Icon name="triangle-alert" size="lg" class="text-muted-foreground/40" />
              <p class="text-sm text-muted-foreground">
                {t("explorer_diffTooLarge")}
              </p>
              <p class="text-xs text-muted-foreground/70">
                {diffLines.length}
                {t("explorer_diffLines")}
              </p>
            </div>
          {:else}
            <table class="w-full text-xs font-mono border-collapse">
              <tbody>
                {#each diffLines as dl}
                  <tr
                    class={dl.type === "add"
                      ? "bg-[hsl(var(--miwarp-status-success)/0.1)]"
                      : dl.type === "del"
                        ? "bg-[hsl(var(--miwarp-status-error)/0.1)]"
                        : dl.type === "hunk"
                          ? "bg-[hsl(var(--miwarp-status-info)/0.05)]"
                          : ""}
                  >
                    <td
                      class="select-none text-right pr-1 pl-2 text-muted-foreground/40 w-[1%] whitespace-nowrap {dl.type ===
                        'hunk' || dl.type === 'header'
                        ? 'border-y border-border/30'
                        : ''}">{dl.oldNum ?? ""}</td
                    >
                    <td
                      class="select-none text-right pr-2 text-muted-foreground/40 w-[1%] whitespace-nowrap {dl.type ===
                        'hunk' || dl.type === 'header'
                        ? 'border-y border-border/30'
                        : ''}">{dl.newNum ?? ""}</td
                    >
                    <td
                      class="whitespace-pre pr-4 {dl.type === 'add'
                        ? 'text-miwarp-status-success'
                        : dl.type === 'del'
                          ? 'text-miwarp-status-error'
                          : dl.type === 'hunk'
                            ? 'text-miwarp-status-info'
                            : dl.type === 'header'
                              ? 'font-bold text-foreground'
                              : ''} {dl.type === 'hunk' || dl.type === 'header'
                        ? 'border-y border-border/30 py-1'
                        : ''}">{dl.text}</td
                    >
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}
        {:else}
          <div class="flex flex-col items-center gap-2 py-12 text-center">
            <Icon name="check" size="lg" class="text-muted-foreground/40" />
            <p class="text-sm text-muted-foreground">{t("explorer_noChanges")}</p>
          </div>
        {/if}
      </div>
    {:else if loadState === "loading"}
      <div class="absolute inset-0 flex items-center justify-center bg-background">
        <Spinner size="md" />
      </div>
    {:else if loadState === "error"}
      <div
        class="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 bg-background"
      >
        <p class="text-sm text-destructive text-center max-w-[400px]">{fileError}</p>
        <button
          type="button"
          class="rounded-md px-3 py-1.5 text-xs font-medium bg-muted text-foreground hover:bg-muted/80 transition-colors"
          onclick={() => {
            // Bumping the local retry counter is enough — the $effect above
            // watches both `path` and `retryCounter` and re-runs loadPreview
            // on every change. This keeps the retry self-contained inside the
            // pane and avoids reintroducing the parent-driven deadlock.
            retryCounter += 1;
          }}
        >
          {t("common_retry")}
        </button>
      </div>
    {:else if loadState === "too_large"}
      <div class="absolute inset-0 flex items-center justify-center p-4 bg-background">
        <p class="text-xs text-muted-foreground text-center">
          {t("preview_tooLarge")} ({Math.round(fileSize / 1024)} KB)
        </p>
      </div>
    {:else if kind === "image" && imageDataUrl}
      <div
        class="absolute inset-0 flex items-center justify-center overflow-auto p-4 bg-[hsl(var(--miwarp-text-primary)/0.05)]"
      >
        <img
          src={imageDataUrl}
          alt={displayName}
          class="max-w-full max-h-full object-contain rounded"
        />
      </div>
    {:else if editorMode === "rendered" && kind === "markdown"}
      <div class="absolute inset-0 overflow-y-auto p-4 bg-background">
        {#if fileContent && MiMarkdownRendererComponent}
          <!-- v1.0.6: use MiMarkdownRenderer for document-level rendering (TOC, callout, lightbox) -->
          <MiMarkdownRendererComponent
            text={fileContent}
            basePath={path.replace(/[/\\][^/\\]*$/, "")}
            showToc={fileContent.length > 2000}
          />
        {:else if fileContent}
          <!-- Markdown renderer chunk still loading — show a lightweight placeholder so the
               layout doesn't flash. The chunk is small (~30KB) so this is brief. -->
          <div class="flex items-center justify-center py-12">
            <Spinner size="md" />
          </div>
        {:else}
          <p class="text-sm text-muted-foreground italic">{t("explorer_emptyFile")}</p>
        {/if}
      </div>
    {/if}
  </div>
</div>
