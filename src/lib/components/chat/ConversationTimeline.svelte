<script lang="ts">
  import type { TimelineEntry, PermissionSuggestion } from "$lib/types";
  import type { TaskNotificationItem } from "$lib/stores/session-store.svelte";
  import type { ProcessVisibility } from "$lib/utils/process-visibility";
  import type { PermissionCoordinator } from "$lib/chat/permission-coordinator";
  import ChatMessage from "$lib/components/ChatMessage.svelte";
  import InlineToolCard from "$lib/components/InlineToolCard.svelte";
  import ContextUsageGrid from "$lib/components/ContextUsageGrid.svelte";
  import CostSummaryView from "$lib/components/CostSummaryView.svelte";
  import ReleaseNotesCard from "$lib/components/ReleaseNotesCard.svelte";
  import MarkdownContent from "$lib/components/MarkdownContent.svelte";
  import { ansiToHtml, hasAnsiCodes } from "$lib/utils/ansi";
  import {
    isTimelineSeparatorContent,
    shouldShowTimelineCommandOutput,
  } from "$lib/utils/process-visibility";
  import { t as tFn } from "$lib/i18n/index.svelte";

  type PermissionMode = string;

  let {
    timeline,
    entry,
    agent,
    model,
    platformId,
    animated,
    debugRunId,
    debugSessionId,
    lastToolId,
    processVisibility,
    permissionCoordinator,
    permissionMode,
    toolResultCache,
    onApprove,
    onPermissionRespond,
    onExitPlanClearContext,
    onExitPlanBypass,
    onToolAnswer,
    getPlanContentForExitPlan,
    taskNotifications,
    showPermissionInPanel = false,
    onPreviewFile,
    /** When set on a `user` entry, the chat page wires its rewind CTA. */
    onRewind,
    /** Forwarded to ChatMessage so historical rows defer expensive work. */
    frozen = false,
    /**
     * Custom renderer for the `command_output` markdown fallback. The
     * chat page wraps the markdown in `ChatRenderBoundary` and passes
     * `lazy={isFrozenEntry(index)}` to defer expensive parsing on
     * historical rows; the workbench surface uses the default
     * eager-render `<MarkdownContent>` directly.
     */
    commandOutputMarkdown,
  }: {
    /** Timeline entries to render in order. Used by the workbench surface
     *  which owns the outer scroll container. Ignored when `entry` is set. */
    timeline?: TimelineEntry[];
    /** Single-entry mode. The chat page wraps each row in ChatRenderBoundary
     *  and toggles `frozen` / rewind per entry, so it iterates the timeline
     *  itself and hands each row to this component one at a time. */
    entry?: TimelineEntry;
    /** Current agent identifier (e.g. "claude", "codex"). */
    agent: string;
    /** Model label forwarded to assistant ChatMessage. */
    model: string | undefined;
    /** Platform id forwarded to assistant ChatMessage. */
    platformId: string | undefined;
    /** Whether the assistant message should animate streaming output. */
    animated: boolean;
    /** Optional debug run id for assistant ChatMessage. */
    debugRunId: string | undefined;
    /** Optional debug session id for assistant ChatMessage. */
    debugSessionId: string | undefined;
    /** Most-recent tool use id; used to flag `isLastTool` and `latestPlanTool`. */
    lastToolId: string;
    /** Active process visibility level (output / guided / developer / expert). */
    processVisibility: ProcessVisibility;
    /** Permission coordinator passed through to InlineToolCard. */
    permissionCoordinator: PermissionCoordinator | undefined;
    /** Permission mode forwarded to InlineToolCard. */
    permissionMode: PermissionMode;
    /**
     * Tool result cache handle. Only the `fetchToolResult` half is needed
     * for rendering; the chat page already owns the cache lifecycle via
     * its existing `createToolResultCache` instance.
     */
    toolResultCache: {
      fetchToolResult: (
        runId: string,
        toolUseId: string,
      ) => Promise<Record<string, unknown> | null>;
    };
    /** Tool approve callback forwarded to InlineToolCard. */
    onApprove: (toolName: string) => void | Promise<void>;
    /** Permission respond callback forwarded to InlineToolCard. */
    onPermissionRespond: (
      requestId: string,
      behavior: "allow" | "deny",
      updatedPermissions?: PermissionSuggestion[],
      updatedInput?: Record<string, unknown>,
      denyMessage?: string,
      interrupt?: boolean,
    ) => void | Promise<void>;
    /** ExitPlanMode "clear context" handler forwarded to InlineToolCard. */
    onExitPlanClearContext: () => void | Promise<void>;
    /** ExitPlanMode "bypass" handler forwarded to InlineToolCard. */
    onExitPlanBypass: () => void | Promise<void>;
    /** AskUserQuestion answer callback (only fired for AskUserQuestion tools). */
    onToolAnswer: (toolUseId: string, answer: string) => void | Promise<void>;
    /**
     * Resolves plan content for an ExitPlanMode entry. Accepts either a
     * raw string (workbench surface) or the `{ content, fileName }`
     * shape that `InlineToolCard.planContent` ultimately consumes (chat
     * surface). Returns `undefined` / `null` when the entry isn't an
     * ExitPlanMode card or no plan content is available.
     */
    getPlanContentForExitPlan: (
      entryId: string,
    ) => string | { content: string; fileName: string } | null | undefined;
    /** Map of background task notifications forwarded to InlineToolCard. */
    taskNotifications: Map<string, TaskNotificationItem>;
    /** Whether generic tool permissions are handled by a floating panel. */
    showPermissionInPanel?: boolean;
    /** Optional file preview callback forwarded to InlineToolCard. */
    onPreviewFile?: (path: string) => void;
    /** Optional rewind callback for `user` entries (chat-only). */
    onRewind?: () => void;
    /** Forwarded to ChatMessage to defer expensive markdown on cold rows. */
    frozen?: boolean;
    /** Custom renderer for the command_output markdown fallback (chat-only). */
    commandOutputMarkdown?: import("svelte").Snippet<[string]>;
  } = $props();

  const t = tFn;

  /**
   * Normalizes the various plan-content shapes callers can hand us into
   * the `{ content, fileName }` object that `InlineToolCard.planContent`
   * expects. Returns `undefined` when the caller has no content so the
   * card falls back to the empty placeholder copy.
   */
  function toPlanContent(
    raw: string | { content: string; fileName: string } | null | undefined,
  ): { content: string; fileName: string } | undefined {
    if (raw == null) return undefined;
    if (typeof raw === "string") {
      if (raw === "") return undefined;
      return { content: raw, fileName: "plan" };
    }
    if (raw.content === "") return undefined;
    return raw;
  }
</script>

{#snippet renderRow(row: TimelineEntry)}
  {#if row.kind === "user"}
    <ChatMessage
      message={{
        id: row.id,
        role: "user",
        content: row.content,
        timestamp: row.ts,
      }}
      attachments={row.attachments}
      {frozen}
      {onRewind}
    />
  {:else if row.kind === "assistant"}
    <ChatMessage
      message={{
        id: row.id,
        role: "assistant",
        content: row.content,
        timestamp: row.ts,
      }}
      thinkingText={row.thinkingText}
      {agent}
      {platformId}
      {model}
      {animated}
      {processVisibility}
      {frozen}
      debugRunId={debugRunId ?? ""}
      debugSessionId={debugSessionId ?? ""}
    />
  {:else if row.kind === "tool"}
    <div class="w-full py-1">
      <div class="chat-content-width">
        <InlineToolCard
          tool={row.tool}
          subTimeline={row.subTimeline}
          runId={debugRunId ?? ""}
          fetchToolResult={toolResultCache.fetchToolResult}
          {processVisibility}
          onAnswer={row.tool.tool_name === "AskUserQuestion" &&
          (row.tool.status === "running" || row.tool.status === "ask_pending")
            ? (answer) => onToolAnswer(row.tool.tool_use_id, answer)
            : undefined}
          {onApprove}
          {onPermissionRespond}
          {onExitPlanClearContext}
          {onExitPlanBypass}
          {taskNotifications}
          planContent={row.tool.tool_name === "ExitPlanMode" &&
          (row.tool.status === "permission_prompt" || row.tool.status === "success")
            ? toPlanContent(getPlanContentForExitPlan(row.id))
            : undefined}
          latestPlanTool={row.tool.tool_use_id === lastToolId}
          {showPermissionInPanel}
          {permissionCoordinator}
          {permissionMode}
          {onPreviewFile}
          isLastTool={row.tool.tool_use_id === lastToolId}
        />
      </div>
    </div>
  {:else if row.kind === "separator"}
    {#if isTimelineSeparatorContent(row.content)}
      <div class="w-full py-3">
        <div class="chat-content-width">
          <div class="flex items-center gap-3">
            <div class="h-px flex-1 bg-[hsl(var(--miwarp-status-warning)/0.2)]"></div>
            <span
              class="whitespace-nowrap text-xs font-medium text-[hsl(var(--miwarp-status-warning)/0.7)]"
            >
              {t("chat_contextCleared")}
            </span>
            <div class="h-px flex-1 bg-[hsl(var(--miwarp-status-warning)/0.2)]"></div>
          </div>
        </div>
      </div>
    {/if}
  {:else if row.kind === "command_output"}
    {#if shouldShowTimelineCommandOutput(processVisibility, row.content)}
      <div class="w-full py-2">
        <div class="chat-content-width pl-7">
          <div
            class="command-output overflow-x-auto rounded-lg border border-border/40 bg-miwarp-bg-deepest px-4 py-3 text-sm"
          >
            {#if row.content.includes("## Context Usage")}
              <ContextUsageGrid text={row.content} />
            {:else if row.content.includes("Total cost:") && row.content.includes("Total duration")}
              <CostSummaryView text={row.content} />
            {:else if row.content.trimStart().startsWith("Version ") && row.content.includes("•")}
              <ReleaseNotesCard text={row.content} />
            {:else if hasAnsiCodes(row.content)}
              <pre
                class="m-0 whitespace-pre font-mono text-xs leading-relaxed text-miwarp-text-primary">{@html ansiToHtml(
                  row.content,
                )}</pre>
            {:else if commandOutputMarkdown}
              {@render commandOutputMarkdown(row.content)}
            {:else}
              <MarkdownContent text={row.content} />
            {/if}
          </div>
        </div>
      </div>
    {/if}
  {/if}
{/snippet}

{#if entry}
  {@render renderRow(entry)}
{:else if timeline}
  <div class="conversation-timeline flex flex-col gap-1">
    {#each timeline as row (row.id)}
      {@render renderRow(row)}
    {/each}
  </div>
{/if}
