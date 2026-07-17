<!--
  ToolDetailSearch — renders Grep, Glob, WebFetch, and WebSearch tool details.
  Extracted from ToolDetailView.svelte.
-->
<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
  import MarkdownContent from "$lib/components/MarkdownContent.svelte";
  import LinkCard from "$lib/components/LinkCard.svelte";
  import {
    type GrepResultMeta,
    type GlobResultMeta,
    type WebFetchResultMeta,
    type WebSearchResultMeta,
  } from "./tool-detail-utils";

  let {
    toolName,
    toolInput,
    grepResult,
    globResult,
    webFetchResult,
    webSearchResult,
    outputText,
    outputExpanded,
    toggleOutputExpand,
    needsExpand,
    outputLineCount,
    handleCopy,
    copyFeedback,
  }: {
    toolName: string;
    toolInput: Record<string, unknown> | undefined;
    grepResult: GrepResultMeta | undefined;
    globResult: GlobResultMeta | undefined;
    webFetchResult: WebFetchResultMeta | undefined;
    webSearchResult: WebSearchResultMeta | undefined;
    outputText: string;
    outputExpanded: boolean;
    toggleOutputExpand: () => void;
    needsExpand: boolean;
    outputLineCount: number;
    handleCopy: (text: string) => void;
    copyFeedback: string | null;
  } = $props();
</script>

{#snippet truncateOverlay(isTruncated: boolean)}
  {#if isTruncated && !outputExpanded}
    <div
      class="pointer-events-none absolute bottom-0 inset-x-0 h-8 bg-gradient-to-t from-muted/80 to-transparent rounded-b"
    ></div>
  {/if}
{/snippet}

{#if toolName === "Grep" || toolName === "search_files"}
  <!-- Grep: pattern + path input, monospace results -->
  <div class="rounded bg-muted p-2 max-h-20 overflow-y-auto">
    <div class="text-xs font-mono text-muted-foreground flex items-center gap-2">
      <span>
        {#if toolInput?.pattern}<span class="text-miwarp-accent-violet"
            >/{toolInput.pattern}/</span
          >{/if}
        {#if toolInput?.path}<span class="text-muted-foreground/60 ml-2">{toolInput.path}</span
          >{/if}
        {#if toolInput?.glob}<span class="text-muted-foreground/60 ml-2"
            >--glob {toolInput.glob}</span
          >{/if}
      </span>
      {#if grepResult}
        <span class="text-[10px] text-muted-foreground ml-auto shrink-0">
          {grepResult.numFiles !== 1
            ? t("tool_files", { count: String(grepResult.numFiles) })
            : t("tool_file", { count: String(grepResult.numFiles) })}
          {#if grepResult.numLines != null}, {grepResult.numLines !== 1
              ? t("tool_matches", { count: String(grepResult.numLines) })
              : t("tool_match", { count: String(grepResult.numLines) })}{/if}
        </span>
      {/if}
    </div>
  </div>
  {#if outputText}
    <div
      class="rounded bg-muted p-2 relative group/copy {outputExpanded
        ? ''
        : 'max-h-96 overflow-hidden'}"
    >
      <pre
        class="text-xs font-mono whitespace-pre-wrap break-all text-muted-foreground">{outputText}</pre>
      <button
        type="button"
        class="absolute top-1.5 right-1.5 text-[10px] text-muted-foreground hover:text-foreground opacity-0 group-hover/copy:opacity-100 transition-opacity"
        onclick={() => handleCopy(outputText)}>{copyFeedback ?? t("common_copy")}</button
      >
      {@render truncateOverlay(needsExpand)}
    </div>
    {#if needsExpand}
      <button
        type="button"
        class="w-full text-[10px] text-muted-foreground/60 hover:text-muted-foreground py-1 transition-colors"
        onclick={toggleOutputExpand}
      >
        {outputExpanded
          ? t("common_collapse")
          : t("common_showAllLines", { count: String(outputLineCount) })}
      </button>
    {/if}
  {/if}
{:else if toolName === "Glob" || toolName === "list_directory"}
  <!-- Glob: pattern + path input, file list -->
  <div class="rounded bg-muted p-2 max-h-20 overflow-y-auto">
    <div class="text-xs font-mono text-muted-foreground flex items-center gap-2">
      <span>
        {#if toolInput?.pattern}<span class="text-miwarp-accent-violet"
            >{toolInput.pattern}</span
          >{/if}
        {#if toolInput?.path}<span class="text-muted-foreground/60 ml-2"
            >in {toolInput.path}</span
          >{/if}
      </span>
      {#if globResult}
        <span class="text-[10px] text-muted-foreground ml-auto shrink-0">
          {globResult.numFiles !== 1
            ? t("tool_files", { count: String(globResult.numFiles) })
            : t("tool_file", { count: String(globResult.numFiles) })}
          {#if globResult.truncated}<span class="text-[hsl(var(--miwarp-status-warning)/0.8)]">
              {t("tool_truncated")}</span
            >{/if}
        </span>
      {/if}
    </div>
  </div>
  {#if outputText}
    <div class="rounded bg-muted p-2 relative {outputExpanded ? '' : 'max-h-96 overflow-hidden'}">
      <pre
        class="text-xs font-mono whitespace-pre-wrap break-all text-muted-foreground">{outputText}</pre>
      {@render truncateOverlay(needsExpand)}
    </div>
    {#if needsExpand}
      <button
        type="button"
        class="w-full text-[10px] text-muted-foreground/60 hover:text-muted-foreground py-1 transition-colors"
        onclick={toggleOutputExpand}
      >
        {outputExpanded
          ? t("common_collapse")
          : t("common_showAllLines", { count: String(outputLineCount) })}
      </button>
    {/if}
  {/if}
{:else if toolName === "WebFetch"}
  <!-- WebFetch: URL + HTTP status + response metadata -->
  <div class="rounded bg-muted p-2 max-h-20 overflow-y-auto">
    <div class="text-xs font-mono text-muted-foreground flex items-center gap-2">
      <span class="text-miwarp-status-info truncate">{toolInput?.url ?? ""}</span>
      {#if webFetchResult}
        <span class="ml-auto shrink-0 flex items-center gap-1.5 text-[10px]">
          <span
            class="px-1.5 py-0.5 rounded font-medium {webFetchResult.code < 400
              ? 'bg-[hsl(var(--miwarp-status-success)/0.15)] text-miwarp-status-success'
              : 'bg-[hsl(var(--miwarp-status-error)/0.15)] text-miwarp-status-error'}"
          >
            {webFetchResult.code}
            {webFetchResult.codeText}
          </span>
          <span class="text-muted-foreground/50">
            {webFetchResult.bytes < 1024
              ? `${webFetchResult.bytes} B`
              : `${(webFetchResult.bytes / 1024).toFixed(1)} KB`}
          </span>
        </span>
      {/if}
    </div>
  </div>
  {#if outputText}
    <div
      class="rounded bg-muted p-2 relative prose-chat {outputExpanded
        ? ''
        : 'max-h-96 overflow-hidden'}"
    >
      <MarkdownContent text={outputText} />
      {@render truncateOverlay(needsExpand)}
    </div>
    {#if needsExpand}
      <button
        type="button"
        class="w-full text-[10px] text-muted-foreground/60 hover:text-muted-foreground py-1 transition-colors"
        onclick={toggleOutputExpand}
      >
        {outputExpanded
          ? t("common_collapse")
          : t("common_showAllLines", { count: String(outputLineCount) })}
      </button>
    {/if}
  {/if}
{:else if toolName === "WebSearch"}
  <!-- WebSearch: query + structured result links -->
  <div class="rounded bg-muted p-2 max-h-20 overflow-y-auto">
    <div class="text-xs font-mono text-muted-foreground truncate">
      <span class="text-miwarp-status-info">{toolInput?.query ?? ""}</span>
      {#if webSearchResult}
        <span class="text-[10px] text-muted-foreground ml-2">
          {t("tool_resultsCount", {
            count: String(webSearchResult.results.filter((r) => typeof r !== "string").length),
          })}
        </span>
      {/if}
    </div>
  </div>
  {#if webSearchResult}
    <div
      class="rounded bg-muted p-2 relative space-y-1 {outputExpanded
        ? ''
        : 'max-h-96 overflow-hidden'}"
    >
      {#each webSearchResult.results as entry}
        {#if typeof entry !== "string" && entry.content}
          {#each entry.content as link}
            <LinkCard title={link.title} url={link.url} />
          {/each}
        {/if}
      {/each}
      {@render truncateOverlay(needsExpand)}
    </div>
  {:else if outputText}
    <div
      class="rounded bg-muted p-2 relative prose-chat {outputExpanded
        ? ''
        : 'max-h-96 overflow-hidden'}"
    >
      <MarkdownContent text={outputText} />
      {@render truncateOverlay(needsExpand)}
    </div>
  {/if}
  {#if needsExpand}
    <button
      type="button"
      class="w-full text-[10px] text-muted-foreground/60 hover:text-muted-foreground py-1 transition-colors"
      onclick={toggleOutputExpand}
    >
      {outputExpanded
        ? t("common_collapse")
        : t("common_showAllLines", { count: String(outputLineCount) })}
    </button>
  {/if}
{/if}
