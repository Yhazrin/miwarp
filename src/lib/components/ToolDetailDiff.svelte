<!--
  ToolDetailDiff — renders Edit and Write tool details with diff views.
  Extracted from ToolDetailView.svelte.
-->
<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
  import MarkdownContent from "$lib/components/MarkdownContent.svelte";
  import {
    type PatchHunk,
    type EditResultMeta,
    adjustHunkLineNumbers,
    renderDiffHunk,
    renderCodeWithLineNumbers,
    countLines,
  } from "./tool-detail-utils";

  // Lazy-load the diff library
  let _diffFn: typeof import("diff").structuredPatch | null = null;
  const _diffPromise = import("diff").then((m) => {
    _diffFn = m.structuredPatch;
    return m.structuredPatch;
  });
  function diffLoaded(): boolean {
    return _diffFn !== null;
  }
  function getDiffFn() {
    return _diffFn!;
  }

  /** Compute a unified diff from old_string + new_string. */
  function computeFallbackPatch(
    oldStr: string,
    newStr: string,
    originalFile: string | undefined = undefined,
  ): PatchHunk[] {
    if (!diffLoaded()) return [];
    let lineOffset = 0;
    if (originalFile) {
      const idx = originalFile.indexOf(oldStr);
      if (idx !== -1) {
        lineOffset = originalFile.substring(0, idx).split("\n").length - 1;
      }
    }
    const patch = getDiffFn()("", "", oldStr, newStr, "", "", { context: 3 });
    if (lineOffset > 0) {
      for (const hunk of patch.hunks) {
        hunk.oldStart += lineOffset;
        hunk.newStart += lineOffset;
      }
    }
    return patch.hunks as PatchHunk[];
  }

  let {
    toolName,
    toolInput,
    toolUseResult,
    filePath,
    lang,
    isPlanFile,
    editResult,
    editHasPatches,
    writeResult,
    writeHasPatches,
    outputText,
    outputExpanded,
    toggleOutputExpand,
    handleCopy,
    copyFeedback,
    onPreviewFile,
  }: {
    toolName: string;
    toolInput: Record<string, unknown> | undefined;
    toolUseResult: unknown;
    filePath: string;
    lang: string;
    isPlanFile: boolean;
    editResult: EditResultMeta | undefined;
    editHasPatches: boolean;
    writeResult: EditResultMeta | undefined;
    writeHasPatches: boolean;
    outputText: string;
    outputExpanded: boolean;
    toggleOutputExpand: () => void;
    handleCopy: (text: string) => void;
    copyFeedback: string | null;
    onPreviewFile?: (path: string) => void;
  } = $props();

  let isEdit = $derived(toolName === "Edit" || toolName === "edit_file");
  let isWrite = $derived(toolName === "Write" || toolName === "write_file");
</script>

{#snippet truncateOverlay(isTruncated: boolean)}
  {#if isTruncated && !outputExpanded}
    <div
      class="pointer-events-none absolute bottom-0 inset-x-0 h-8 bg-gradient-to-t from-muted/80 to-transparent rounded-b"
    ></div>
  {/if}
{/snippet}

{#if filePath}
  {#if onPreviewFile}
    <button
      type="button"
      class="tool-file-header rounded-t w-full text-left hover:text-foreground hover:underline transition-colors"
      onclick={() => onPreviewFile?.(filePath)}
      title={t("toolDetail_previewFile") ?? filePath}>{filePath}</button
    >
  {:else}
    <div class="tool-file-header rounded-t">{filePath}</div>
  {/if}
{/if}

{#if isEdit}
  <!-- Edit: diff view -->
  {#if editHasPatches}
    {@const adjustedEditHunks = adjustHunkLineNumbers(
      editResult!.structuredPatch,
      editResult!.oldString ?? (toolInput?.old_string as string | undefined),
      editResult!.originalFile,
    )}
    <div
      class="diff-section overflow-x-auto relative {outputExpanded
        ? ''
        : 'max-h-96 overflow-y-hidden'}"
    >
      {#each adjustedEditHunks as hunk}
        <div
          class="px-3 py-1 bg-muted/50 text-[10px] font-mono text-muted-foreground/60 border-b border-border/30"
        >
          @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
        </div>
        {@html renderDiffHunk(hunk, lang)}
      {/each}
      {@render truncateOverlay(adjustedEditHunks.reduce((n, h) => n + h.lines.length, 0) > 20)}
    </div>
    {@const patchLineCount = adjustedEditHunks.reduce((n, h) => n + h.lines.length, 0)}
    {#if patchLineCount > 20}
      <button
        type="button"
        class="w-full text-xs text-muted-foreground/60 hover:text-muted-foreground py-1 transition-colors"
        onclick={toggleOutputExpand}
      >
        {outputExpanded
          ? t("common_collapse")
          : t("common_showAllLines", { count: String(patchLineCount) })}
      </button>
    {/if}
  {:else if toolInput?.old_string != null || toolInput?.new_string != null}
    {@const origFile = (toolUseResult as Record<string, unknown> | undefined)?.originalFile as
      | string
      | undefined}
    {@const fallbackHunks = computeFallbackPatch(
      String(toolInput?.old_string ?? ""),
      String(toolInput?.new_string ?? ""),
      origFile,
    )}
    <div
      class="diff-section overflow-x-auto relative {outputExpanded
        ? ''
        : 'max-h-96 overflow-y-hidden'}"
    >
      {#each fallbackHunks as hunk}
        <div
          class="px-3 py-1 bg-muted/50 text-[10px] font-mono text-muted-foreground/60 border-b border-border/30"
        >
          @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
        </div>
        {@html renderDiffHunk(hunk, lang)}
      {/each}
      {@render truncateOverlay(fallbackHunks.reduce((n, h) => n + h.lines.length, 0) > 20)}
    </div>
    {@const fallbackLineCount = fallbackHunks.reduce((n, h) => n + h.lines.length, 0)}
    {#if fallbackLineCount > 20}
      <button
        type="button"
        class="w-full text-xs text-muted-foreground/60 hover:text-muted-foreground py-1 transition-colors"
        onclick={toggleOutputExpand}
      >
        {outputExpanded
          ? t("common_collapse")
          : t("common_showAllLines", { count: String(fallbackLineCount) })}
      </button>
    {/if}
  {/if}
  {#if outputText}
    <div class="rounded bg-muted p-2 max-h-20 overflow-y-auto">
      <div class="text-[10px] font-medium text-muted-foreground/60 mb-1 uppercase tracking-wider">
        {t("tool_result")}
      </div>
      <pre
        class="text-xs font-mono whitespace-pre-wrap break-all text-muted-foreground">{outputText}</pre>
    </div>
  {/if}
{:else if isWrite}
  <!-- Write: structuredPatch diff or content preview -->
  {#if isPlanFile && typeof toolInput?.content === "string"}
    {@const planText = toolInput.content as string}
    <div
      class="rounded bg-muted p-2 relative prose-chat {outputExpanded
        ? ''
        : 'max-h-96 overflow-hidden'}"
    >
      <MarkdownContent text={planText} />
      {@render truncateOverlay(countLines(planText) > 20)}
    </div>
    {#if countLines(planText) > 20}
      <button
        type="button"
        class="w-full text-xs text-muted-foreground/60 hover:text-muted-foreground py-1 transition-colors"
        onclick={toggleOutputExpand}
      >
        {outputExpanded
          ? t("common_collapse")
          : t("common_showAllLines", { count: String(countLines(planText)) })}
      </button>
    {/if}
  {:else if writeHasPatches}
    {@const adjustedWriteHunks = adjustHunkLineNumbers(
      writeResult!.structuredPatch,
      writeResult!.oldString ?? (toolInput?.old_string as string | undefined),
      writeResult!.originalFile,
    )}
    <div
      class="diff-section overflow-x-auto relative {outputExpanded
        ? ''
        : 'max-h-96 overflow-y-hidden'}"
    >
      {#each adjustedWriteHunks as hunk}
        <div
          class="px-3 py-1 bg-muted/50 text-[10px] font-mono text-muted-foreground/60 border-b border-border/30"
        >
          @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
        </div>
        {@html renderDiffHunk(hunk, lang)}
      {/each}
      {@render truncateOverlay(adjustedWriteHunks.reduce((n, h) => n + h.lines.length, 0) > 20)}
    </div>
    {@const writePatchLines = adjustedWriteHunks.reduce((n, h) => n + h.lines.length, 0)}
    {#if writePatchLines > 20}
      <button
        type="button"
        class="w-full text-[10px] text-muted-foreground/60 hover:text-muted-foreground py-1 transition-colors"
        onclick={toggleOutputExpand}
      >
        {outputExpanded
          ? t("common_collapse")
          : t("common_showAllLines", { count: String(writePatchLines) })}
      </button>
    {/if}
  {:else if toolInput?.content}
    {@const content = String(toolInput.content)}
    {@const lines = content.split("\n")}
    {@const truncated = lines.length > 20}
    {@const displayContent =
      !outputExpanded && truncated ? lines.slice(0, 20).join("\n") + "\n..." : content}
    <div class="rounded bg-muted relative group/copy">
      <pre
        class="text-xs font-mono whitespace-pre-wrap p-2 leading-relaxed">{@html renderCodeWithLineNumbers(
          displayContent,
          lang,
        )}</pre>
      {#if truncated && !outputExpanded}
        <div class="px-2 pb-1.5 text-[10px] text-muted-foreground">
          {t("tool_linesTotal", { count: String(lines.length) })}
        </div>
      {/if}
      {@render truncateOverlay(truncated)}
      <button
        type="button"
        class="absolute top-1.5 right-1.5 text-[10px] text-muted-foreground hover:text-foreground opacity-0 group-hover/copy:opacity-100 transition-opacity"
        onclick={() => handleCopy(content)}>{copyFeedback ?? t("common_copy")}</button
      >
    </div>
    {#if truncated}
      <button
        type="button"
        class="w-full text-xs text-muted-foreground/60 hover:text-muted-foreground py-1 transition-colors"
        onclick={() => toggleOutputExpand()}
      >
        {outputExpanded
          ? t("common_collapse")
          : t("common_showAllLines", { count: String(lines.length) })}
      </button>
    {/if}
  {/if}
  {#if outputText}
    <div class="rounded bg-muted p-2 max-h-20 overflow-y-auto">
      <div class="text-[10px] font-medium text-muted-foreground/60 mb-1 uppercase tracking-wider">
        {t("tool_result")}
      </div>
      <pre
        class="text-xs font-mono whitespace-pre-wrap break-all text-muted-foreground">{outputText}</pre>
    </div>
  {/if}
{/if}
