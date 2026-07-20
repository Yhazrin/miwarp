<script lang="ts">
  import { onDestroy } from "svelte";
  import { t } from "$lib/i18n/index.svelte";
  import { dbg } from "$lib/utils/debug";
  import { ansiToHtml, hasAnsiCodes, stripAnsi } from "$lib/utils/ansi";
  import { colorizeCommand } from "$lib/utils/shell-colorize";
  import type { BusToolItem } from "$lib/types";
  import {
    extractOutputText,
    getLanguageFromPath,
    isImagePath,
    isPlanFilePath,
    extractImageBlocks,
    copyToClipboard,
  } from "$lib/utils/tool-rendering";
  import MarkdownContent from "$lib/components/MarkdownContent.svelte";
  import TeamToolDetail from "$lib/components/TeamToolDetail.svelte";
  import {
    highlightBlock,
    renderCodeWithLineNumbers,
    countLines,
    extractBashResult,
    extractEditResult,
    extractWriteResult,
    extractGlobResult,
    extractGrepResult,
    extractWebFetchResult,
    extractWebSearchResult,
    extractTaskResult,
    extractTodoResult,
    extractSkillResult,
    extractExitPlanResult,
    extractNotebookResult,
  } from "./tool-detail-utils";
  import ToolDetailDiff from "./ToolDetailDiff.svelte";
  import ToolDetailSearch from "./ToolDetailSearch.svelte";

  const TEAM_TOOLS = new Set([
    "TeamCreate",
    "TaskCreate",
    "TaskUpdate",
    "TaskList",
    "TaskGet",
    "TeamDelete",
    "SendMessage",
  ]);
  function isTeamTool(name: string): boolean {
    return TEAM_TOOLS.has(name);
  }

  let {
    tool,
    isInputStreaming = false,
    onPreviewFile,
    expertPayload = false,
  }: {
    tool: BusToolItem;
    isInputStreaming?: boolean;
    onPreviewFile?: (path: string) => void;
    /** Expert mode: show raw JSON / full payload blocks where applicable. */
    expertPayload?: boolean;
  } = $props();

  // ── Derived data ──

  let outputText = $derived(extractOutputText(tool.output));
  let imageBlocks = $derived(extractImageBlocks(tool.output));
  let filePath = $derived((tool.input?.file_path as string) ?? (tool.input?.path as string) ?? "");
  let lang = $derived(getLanguageFromPath(filePath));
  let isPlanFile = $derived(isPlanFilePath(filePath));

  let fileResult = $derived(
    tool.tool_use_result?.file as import("./tool-detail-utils").FileResultMeta | undefined,
  );
  let readContent = $derived(fileResult?.content ?? outputText);
  let readStartLine = $derived(fileResult?.startLine ?? 1);
  let readLineInfo = $derived(
    fileResult
      ? `Lines ${fileResult.startLine}\u2013${fileResult.startLine + fileResult.numLines - 1} of ${fileResult.totalLines}`
      : "",
  );

  let bashResult = $derived(extractBashResult(tool));
  let editResult = $derived(extractEditResult(tool));
  let editHasPatches = $derived(
    editResult?.structuredPatch != null && editResult.structuredPatch.length > 0,
  );
  let writeResult = $derived(extractWriteResult(tool));
  let writeHasPatches = $derived(
    writeResult?.structuredPatch != null && writeResult.structuredPatch.length > 0,
  );
  let globResult = $derived(extractGlobResult(tool));
  let grepResult = $derived(extractGrepResult(tool));
  let webFetchResult = $derived(extractWebFetchResult(tool));
  let webSearchResult = $derived(extractWebSearchResult(tool));
  let taskResult = $derived(extractTaskResult(tool));
  let todoResult = $derived(extractTodoResult(tool));
  let skillResult = $derived(extractSkillResult(tool));
  let exitPlanResult = $derived(extractExitPlanResult(tool));
  let notebookResult = $derived(extractNotebookResult(tool));

  // ── Bash terminal rendering ──

  let commandHtml = $derived(
    tool.input?.command ? colorizeCommand(tool.input.command as string) : "",
  );
  let stdoutStripped = $derived(bashResult?.stdout ? stripAnsi(bashResult.stdout) : "");
  let stderrStripped = $derived(bashResult?.stderr ? stripAnsi(bashResult.stderr) : "");
  let outputStripped = $derived(outputText ? stripAnsi(outputText) : "");
  let terminalPlainText = $derived(
    bashResult ? [stdoutStripped, stderrStripped].filter(Boolean).join("\n") : outputStripped,
  );

  const ANSI_SIZE_LIMIT = 200_000;

  function safeAnsiHtml(raw: string | undefined, label: string): string | null {
    if (!raw || !hasAnsiCodes(raw)) return null;
    if (raw.length > ANSI_SIZE_LIMIT) {
      dbg("ToolDetailView", `ansi-skip-${label}`, { len: raw.length, reason: "size-limit" });
      return null;
    }
    dbg("ToolDetailView", `ansi-${label}`, { len: raw.length });
    return ansiToHtml(raw);
  }

  let stdoutHtml = $derived.by(() => {
    if (tool.status === "running") return null;
    return safeAnsiHtml(bashResult?.stdout, "stdout");
  });
  let stderrHtml = $derived.by(() => {
    if (tool.status === "running") return null;
    return safeAnsiHtml(bashResult?.stderr, "stderr");
  });
  let outputHtml = $derived.by(() => {
    if (bashResult || tool.status === "running") return null;
    return safeAnsiHtml(outputText, "fallback");
  });

  // ── Output expand/collapse ──

  let outputExpanded = $state(false);
  let outputLineCount = $derived(
    tool.tool_name === "Bash" || tool.tool_name === "bash"
      ? countLines(terminalPlainText)
      : countLines(outputText),
  );
  let needsExpand = $derived(outputLineCount > 20);

  let fallbackRef = $state<HTMLDivElement>();
  let fallbackNeedsExpand = $state(false);

  $effect(() => {
    const el = fallbackRef;
    const isExpanded = outputExpanded;
    if (!el) return;
    function checkOverflow() {
      if (!outputExpanded) {
        fallbackNeedsExpand = el!.scrollHeight > el!.clientHeight;
      }
    }
    if (!isExpanded) {
      queueMicrotask(checkOverflow);
    }
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(checkOverflow);
      ro.observe(el);
      return () => ro.disconnect();
    }
  });

  function toggleOutputExpand() {
    outputExpanded = !outputExpanded;
    dbg("ToolDetailView", outputExpanded ? "expand" : "collapse", {
      tool: tool.tool_name,
      outputLineCount,
    });
  }

  let copyFeedback = $state<string | null>(null);
  let copyTimeout: ReturnType<typeof setTimeout> | undefined;

  function handleCopy(text: string) {
    copyToClipboard(text);
    copyFeedback = t("common_copied");
    clearTimeout(copyTimeout);
    copyTimeout = setTimeout(() => {
      copyFeedback = null;
    }, 1500);
  }

  onDestroy(() => {
    if (copyTimeout) {
      clearTimeout(copyTimeout);
      copyTimeout = undefined;
    }
  });

  // Detect which tool type for routing
  let isDiffTool = $derived(
    tool.tool_name === "Edit" ||
      tool.tool_name === "edit_file" ||
      tool.tool_name === "Write" ||
      tool.tool_name === "write_file",
  );
  let isSearchTool = $derived(
    tool.tool_name === "Grep" ||
      tool.tool_name === "search_files" ||
      tool.tool_name === "Glob" ||
      tool.tool_name === "list_directory" ||
      tool.tool_name === "WebFetch" ||
      tool.tool_name === "WebSearch",
  );
</script>

<div
  class="mt-2 space-y-1.5"
  role="presentation"
  onclick={(e) => e.stopPropagation()}
  onkeydown={(e) => e.stopPropagation()}
>
  {#snippet truncateOverlay(isTruncated: boolean)}
    {#if isTruncated && !outputExpanded}
      <div
        class="pointer-events-none absolute bottom-0 inset-x-0 h-8 bg-gradient-to-t from-muted/80 to-transparent rounded-b"
      ></div>
    {/if}
  {/snippet}

  {#if isDiffTool}
    <ToolDetailDiff
      toolName={tool.tool_name}
      toolInput={tool.input as Record<string, unknown> | undefined}
      toolUseResult={tool.tool_use_result}
      {filePath}
      {lang}
      {isPlanFile}
      {editResult}
      {editHasPatches}
      {writeResult}
      {writeHasPatches}
      {outputText}
      {outputExpanded}
      {toggleOutputExpand}
      {handleCopy}
      {copyFeedback}
      {onPreviewFile}
    />
  {:else if isSearchTool}
    <ToolDetailSearch
      toolName={tool.tool_name}
      toolInput={tool.input as Record<string, unknown> | undefined}
      {grepResult}
      {globResult}
      {webFetchResult}
      {webSearchResult}
      {outputText}
      {outputExpanded}
      {toggleOutputExpand}
      {needsExpand}
      {outputLineCount}
      {handleCopy}
      {copyFeedback}
    />
  {:else if tool.tool_name === "Bash" || tool.tool_name === "bash"}
    <!-- Bash: terminal-style rendering -->
    {#if tool.input?.command}
      <div
        class="tool-terminal relative group/copy {outputExpanded ? '' : 'max-h-96 overflow-hidden'}"
      >
        <div>{@html commandHtml}</div>
        {#if bashResult}
          {#if bashResult.stdout}
            {#if stdoutHtml}
              <div class="mt-1 text-muted-foreground/80">{@html stdoutHtml}</div>
            {:else}
              <div class="mt-1 text-muted-foreground/80">{stdoutStripped}</div>
            {/if}
          {/if}
          {#if bashResult.stderr}
            {#if stderrHtml}
              <div class="mt-1 text-[hsl(var(--miwarp-status-error)/0.8)]">{@html stderrHtml}</div>
            {:else}
              <div class="mt-1 text-[hsl(var(--miwarp-status-error)/0.8)]">{stderrStripped}</div>
            {/if}
          {/if}
          {#if bashResult.interrupted}
            <div class="mt-1 text-[hsl(var(--miwarp-status-warning)/0.8)] text-[10px]">
              {t("tool_interrupted")}
            </div>
          {/if}
        {:else if outputText}
          {#if outputHtml}
            <div class="mt-1 text-muted-foreground/80">{@html outputHtml}</div>
          {:else}
            <div class="mt-1 text-muted-foreground/80">{outputStripped}</div>
          {/if}
        {/if}
        {#if isInputStreaming || tool.status === "running"}
          <span
            class="inline-block w-1.5 h-3 ml-0.5 bg-[hsl(var(--miwarp-status-success)/0.5)] animate-pulse align-middle"
          ></span>
        {/if}
        <button
          type="button"
          class="absolute top-1.5 right-1.5 text-xs text-muted-foreground hover:text-foreground opacity-0 group-hover/copy:opacity-100 transition-opacity"
          onclick={() => handleCopy(`$ ${tool.input?.command}\n${terminalPlainText}`)}
          >{copyFeedback ?? t("common_copy")}</button
        >
        {@render truncateOverlay(needsExpand)}
      </div>
      {#if needsExpand}
        <button
          type="button"
          class="w-full text-xs text-muted-foreground/60 hover:text-muted-foreground py-1 transition-colors"
          onclick={toggleOutputExpand}
        >
          {outputExpanded
            ? t("common_collapse")
            : t("common_showAllLines", { count: String(outputLineCount) })}
        </button>
      {/if}
    {/if}
  {:else if tool.tool_name === "Read" || tool.tool_name === "read_file"}
    <!-- Read: syntax-highlighted code with line numbers or image -->
    {#if filePath}
      <div class="tool-file-header flex items-center justify-between rounded-t">
        {#if onPreviewFile}
          <button
            type="button"
            class="truncate text-left hover:text-foreground hover:underline transition-colors min-w-0"
            onclick={() => onPreviewFile?.(filePath)}
            title={t("toolDetail_previewFile") ?? filePath}>{filePath}</button
          >
        {:else}
          <span class="truncate">{filePath}</span>
        {/if}
        <div class="flex items-center gap-2 shrink-0">
          {#if readLineInfo}
            <span class="text-[10px] text-muted-foreground/60">{readLineInfo}</span>
          {/if}
          {#if readContent}
            <button
              type="button"
              class="text-xs text-muted-foreground hover:text-foreground transition-colors"
              onclick={() => handleCopy(readContent)}>{copyFeedback ?? t("common_copy")}</button
            >
          {/if}
        </div>
      </div>
    {/if}
    {#if isImagePath(filePath)}
      {#if imageBlocks.length > 0}
        {#each imageBlocks as img}
          <img
            src="data:{img.source.media_type};base64,{img.source.data}"
            alt={filePath}
            class="max-h-60 rounded border border-border/50"
            loading="lazy"
          />
        {/each}
      {:else if readContent}
        <div
          bind:this={fallbackRef}
          class="rounded bg-muted p-2 relative {outputExpanded ? '' : 'max-h-96 overflow-hidden'}"
        >
          <pre
            class="text-xs font-mono whitespace-pre-wrap break-all text-muted-foreground">{readContent}</pre>
          {@render truncateOverlay(fallbackNeedsExpand)}
        </div>
        {#if fallbackNeedsExpand || outputExpanded}
          <button
            type="button"
            class="w-full text-xs text-muted-foreground/60 hover:text-muted-foreground py-1 transition-colors"
            onclick={toggleOutputExpand}
          >
            {outputExpanded ? t("common_collapse") : t("common_showAll")}
          </button>
        {/if}
      {/if}
    {:else if readContent}
      <div
        class="rounded bg-muted tool-code-block relative {outputExpanded
          ? ''
          : 'max-h-96 overflow-hidden'}"
      >
        <pre
          class="text-xs font-mono whitespace-pre-wrap p-2 leading-relaxed">{@html renderCodeWithLineNumbers(
            readContent,
            lang,
            readStartLine,
          )}</pre>
        {@render truncateOverlay(countLines(readContent) > 20)}
      </div>
      {#if countLines(readContent) > 20}
        <button
          type="button"
          class="w-full text-xs text-muted-foreground/60 hover:text-muted-foreground py-1 transition-colors"
          onclick={toggleOutputExpand}
        >
          {outputExpanded
            ? t("common_collapse")
            : t("common_showAllLines", { count: String(countLines(readContent)) })}
        </button>
      {/if}
    {/if}
  {:else if tool.tool_name === "Task" || tool.tool_name === "Agent"}
    <!-- Task/Agent (subagent): prompt + type + usage stats -->
    <div class="rounded bg-muted p-2 max-h-20 overflow-y-auto">
      <div class="text-xs text-muted-foreground">
        {#if tool.input?.subagent_type}
          <span class="text-miwarp-status-info font-medium">{tool.input.subagent_type}</span>
        {/if}
        {#if tool.tool_name === "Agent" && tool.input?.description}
          <span class="text-miwarp-status-info font-medium">{tool.input.description}</span>
        {/if}
        {#if tool.input?.prompt}
          <span class="ml-1 truncate">{tool.input.prompt}</span>
        {/if}
      </div>
    </div>
    {#if taskResult}
      <div class="flex items-center gap-2 px-2 py-1 text-[10px] text-muted-foreground/60">
        {#if taskResult.status === "async_launched"}
          <span
            class="px-1.5 py-0.5 rounded bg-[hsl(var(--miwarp-status-info)/0.15)] text-miwarp-status-info font-medium"
            >{t("tool_async")}</span
          >
          {#if taskResult.outputFile}
            <span class="font-mono truncate">{taskResult.outputFile}</span>
          {/if}
        {:else}
          {#if taskResult.totalToolUseCount != null}
            <span>{t("tool_toolsCount", { count: String(taskResult.totalToolUseCount) })}</span>
          {/if}
          {#if taskResult.totalDurationMs != null}
            <span>{(taskResult.totalDurationMs / 1000).toFixed(1)}s</span>
          {/if}
          {#if taskResult.totalTokens != null}
            <span
              >{t("tool_tokensCount", {
                count:
                  taskResult.totalTokens >= 1000
                    ? `${(taskResult.totalTokens / 1000).toFixed(1)}k`
                    : String(taskResult.totalTokens),
              })}</span
            >
          {/if}
        {/if}
      </div>
    {/if}
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
  {:else if tool.tool_name === "Workflow"}
    <!-- Workflow: show script name/description + phases if available -->
    <div class="rounded bg-muted p-2 max-h-20 overflow-y-auto">
      <div class="text-xs text-muted-foreground">
        {#if tool.input?.name}
          <span class="text-miwarp-status-info font-medium">{tool.input.name}</span>
        {/if}
        {#if tool.input?.description}
          <span class="ml-1 truncate">{tool.input.description}</span>
        {:else if tool.input?.scriptPath}
          <span class="ml-1 font-mono truncate">{tool.input.scriptPath}</span>
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
  {:else if tool.tool_name === "TodoWrite"}
    <!-- TodoWrite: todo list with status badges -->
    {#if todoResult}
      <div class="rounded bg-muted p-2 relative {outputExpanded ? '' : 'max-h-96 overflow-hidden'}">
        <div class="space-y-1">
          {#each todoResult.newTodos as todo}
            <div class="flex items-center gap-2 text-xs">
              <span
                class="px-1.5 py-0.5 rounded text-[10px] font-medium {todo.status === 'completed'
                  ? 'bg-[hsl(var(--miwarp-status-success)/0.15)] text-miwarp-status-success'
                  : todo.status === 'in_progress'
                    ? 'bg-[hsl(var(--miwarp-status-info)/0.15)] text-miwarp-status-info'
                    : 'bg-muted text-muted-foreground'}"
              >
                {todo.status === "completed"
                  ? t("tool_statusDone")
                  : todo.status === "in_progress"
                    ? t("tool_statusWip")
                    : t("tool_statusTodo")}
              </span>
              <span
                class="text-muted-foreground {todo.status === 'completed'
                  ? 'line-through opacity-60'
                  : ''}">{todo.content}</span
              >
            </div>
          {/each}
        </div>
        {@render truncateOverlay(todoResult.newTodos.length > 20)}
      </div>
      {#if todoResult.newTodos.length > 20}
        <button
          type="button"
          class="w-full text-[10px] text-muted-foreground/60 hover:text-muted-foreground py-1 transition-colors"
          onclick={toggleOutputExpand}
        >
          {outputExpanded
            ? t("common_collapse")
            : t("common_showAllItems", { count: String(todoResult.newTodos.length) })}
        </button>
      {/if}
    {:else if outputText}
      <div
        bind:this={fallbackRef}
        class="rounded bg-muted p-2 relative {outputExpanded ? '' : 'max-h-96 overflow-hidden'}"
      >
        <pre
          class="text-xs font-mono whitespace-pre-wrap break-all text-muted-foreground">{outputText}</pre>
        {@render truncateOverlay(fallbackNeedsExpand)}
      </div>
      {#if fallbackNeedsExpand || outputExpanded}
        <button
          type="button"
          class="w-full text-xs text-muted-foreground/60 hover:text-muted-foreground py-1 transition-colors"
          onclick={toggleOutputExpand}
        >
          {outputExpanded ? t("common_collapse") : t("common_showAll")}
        </button>
      {/if}
    {/if}
  {:else if tool.tool_name === "Skill"}
    <!-- Skill: command name + execution mode badge -->
    <div class="rounded bg-muted p-2 overflow-y-auto max-h-20">
      <div class="text-xs text-muted-foreground flex items-center gap-2">
        <span class="font-medium text-foreground"
          >{skillResult?.commandName ?? tool.input?.skill ?? ""}</span
        >
        {#if skillResult?.status}
          <span
            class="px-1.5 py-0.5 rounded text-[10px] font-medium {skillResult.status === 'forked'
              ? 'bg-[hsl(var(--miwarp-accent-violet)/0.15)] text-miwarp-accent-violet'
              : 'bg-[hsl(var(--miwarp-status-info)/0.15)] text-miwarp-status-info'}"
          >
            {skillResult.status}
          </span>
        {/if}
      </div>
    </div>
    {#if skillResult?.status === "forked" && skillResult.result}
      <div
        class="rounded bg-muted p-2 relative prose-chat {outputExpanded
          ? ''
          : 'max-h-96 overflow-hidden'}"
      >
        <MarkdownContent text={skillResult.result} />
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
  {:else if tool.tool_name === "ExitPlanMode"}
    <!-- ExitPlanMode: plan content as markdown -->
    {#if exitPlanResult?.awaitingLeaderApproval}
      <div class="flex items-center gap-1.5 px-2 py-1">
        <span
          class="px-1.5 py-0.5 rounded text-[10px] font-medium bg-[hsl(var(--miwarp-status-warning)/0.15)] text-miwarp-status-warning"
        >
          {t("tool_awaitingApproval")}
        </span>
      </div>
    {/if}
    {#if exitPlanResult?.plan}
      <div
        class="rounded bg-muted p-2 relative prose-chat {outputExpanded
          ? ''
          : 'max-h-96 overflow-hidden'}"
      >
        <MarkdownContent text={exitPlanResult.plan} />
        {@render truncateOverlay(countLines(exitPlanResult.plan) > 20)}
      </div>
      {#if countLines(exitPlanResult.plan) > 20}
        <button
          type="button"
          class="w-full text-[10px] text-muted-foreground/60 hover:text-muted-foreground py-1 transition-colors"
          onclick={toggleOutputExpand}
        >
          {outputExpanded
            ? t("common_collapse")
            : t("common_showAllLines", { count: String(countLines(exitPlanResult.plan)) })}
        </button>
      {/if}
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
  {:else if tool.tool_name === "NotebookEdit"}
    <!-- NotebookEdit: cell source with syntax highlighting -->
    {@const nbPath = notebookResult?.notebook_path ?? (tool.input?.notebook_path as string) ?? ""}
    {#if nbPath}
      <div class="tool-file-header flex items-center justify-between rounded-t">
        <span class="truncate">{nbPath}</span>
        {#if notebookResult?.edit_mode}
          <span
            class="px-1.5 py-0.5 rounded text-[10px] font-medium bg-[hsl(var(--miwarp-status-info)/0.15)] text-miwarp-status-info shrink-0"
          >
            {notebookResult.edit_mode}
          </span>
        {/if}
      </div>
    {/if}
    {#if notebookResult?.new_source}
      {@const nbLang = notebookResult.language || "python"}
      <div class="rounded bg-muted relative {outputExpanded ? '' : 'max-h-96 overflow-hidden'}">
        <pre
          class="text-xs font-mono whitespace-pre-wrap p-2 leading-relaxed">{@html renderCodeWithLineNumbers(
            notebookResult.new_source,
            nbLang,
          )}</pre>
        {@render truncateOverlay(countLines(notebookResult.new_source) > 20)}
      </div>
      {#if countLines(notebookResult.new_source) > 20}
        <button
          type="button"
          class="w-full text-[10px] text-muted-foreground/60 hover:text-muted-foreground py-1 transition-colors"
          onclick={toggleOutputExpand}
        >
          {outputExpanded
            ? t("common_collapse")
            : t("common_showAllLines", { count: String(countLines(notebookResult.new_source)) })}
        </button>
      {/if}
    {:else if outputText}
      <div
        bind:this={fallbackRef}
        class="rounded bg-muted p-2 relative {outputExpanded ? '' : 'max-h-96 overflow-hidden'}"
      >
        <pre
          class="text-xs font-mono whitespace-pre-wrap break-all text-muted-foreground">{outputText}</pre>
        {@render truncateOverlay(fallbackNeedsExpand)}
      </div>
      {#if fallbackNeedsExpand || outputExpanded}
        <button
          type="button"
          class="w-full text-xs text-muted-foreground/60 hover:text-muted-foreground py-1 transition-colors"
          onclick={toggleOutputExpand}
        >
          {outputExpanded ? t("common_collapse") : t("common_showAll")}
        </button>
      {/if}
    {/if}
  {:else if isTeamTool(tool.tool_name)}
    <TeamToolDetail {tool} />
  {:else}
    <!-- Default: JSON input, plain text output -->
    {#if tool.input && Object.keys(tool.input).length > 0}
      <div class="rounded bg-muted p-2 max-h-40 overflow-y-auto relative group/copy">
        <div class="text-[10px] font-medium text-muted-foreground/60 mb-1 uppercase tracking-wider">
          {t("tool_input")}{#if isInputStreaming}<span
              class="inline-block w-1.5 h-3 ml-1 bg-muted-foreground/40 animate-pulse align-middle"
            ></span>{/if}
        </div>
        <pre
          class="text-xs font-mono whitespace-pre-wrap break-all text-muted-foreground">{@html highlightBlock(
            JSON.stringify(tool.input, null, 2),
            "json",
          )}</pre>
        <button
          type="button"
          class="absolute top-1.5 right-1.5 text-[10px] text-muted-foreground hover:text-foreground opacity-0 group-hover/copy:opacity-100 transition-opacity"
          onclick={() => handleCopy(JSON.stringify(tool.input, null, 2))}
          >{copyFeedback ?? t("common_copy")}</button
        >
      </div>
    {/if}
    {#if outputText}
      <div
        class="rounded bg-muted p-2 relative group/copy {outputExpanded
          ? ''
          : 'max-h-96 overflow-hidden'}"
      >
        <div class="text-[10px] font-medium text-muted-foreground/60 mb-1 uppercase tracking-wider">
          {t("tool_output")}
        </div>
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
  {/if}
  {#if expertPayload && tool.tool_use_result != null && typeof tool.tool_use_result === "object"}
    <div
      class="mt-2 rounded border border-dashed border-border/50 bg-muted/30 p-2 max-h-72 overflow-auto"
    >
      <div class="text-[10px] font-medium text-muted-foreground/70 mb-1">tool_use_result (raw)</div>
      <pre
        class="text-[10px] font-mono whitespace-pre-wrap break-all text-muted-foreground">{JSON.stringify(
          tool.tool_use_result,
          null,
          2,
        )}</pre>
    </div>
  {/if}
</div>
