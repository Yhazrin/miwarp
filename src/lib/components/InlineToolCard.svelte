<script lang="ts">
  import type { BusToolItem, TimelineEntry, PermissionSuggestion } from "$lib/types";
  import type { TaskNotificationItem } from "$lib/stores/session-store.svelte";
  import { getToolColor } from "$lib/utils/tool-colors";
  import { getToolSummary } from "$lib/utils/tool-summaries";
  import {
    fileName as pathFileName,
    isAbsolutePath,
    formatDuration,
    formatTokenCount,
  } from "$lib/utils/format";
  import {
    extractOutputText,
    friendlyToolName,
    planFileName,
    isPlanFilePath,
    extractTaskToolMeta,
    shouldShowSubTimeline as _shouldShow,
    getToolRenderLevel,
    getToolDetail,
    isToolTerminal,
    formatSuggestionLabel as _fmtSuggestion,
  } from "$lib/utils/tool-rendering";
  import MarkdownContent from "$lib/components/MarkdownContent.svelte";
  import ToolDetailView from "$lib/components/ToolDetailView.svelte";
  import StatusIcon from "$lib/components/StatusIcon.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import { dbg } from "$lib/utils/debug";
  import { viewModeStore } from "$lib/stores/view-mode-store.svelte";
  import PhaseIndicator from "$lib/components/PhaseIndicator.svelte";
  import { detectPhase } from "$lib/utils/phase-detection";
  import type { ProcessVisibility } from "$lib/utils/process-visibility";
  import {
    shouldMountFullToolCardInOutputMode,
    shouldHideToolCards,
    shouldUseCompactToolCards,
    shouldShowFullToolPayload,
  } from "$lib/utils/process-visibility";

  let {
    tool,
    subTimeline,
    runId,
    fetchToolResult,
    onAnswer,
    onApprove,
    onPermissionRespond,
    onExitPlanClearContext,
    onExitPlanBypass,
    taskNotifications,
    planContent,
    latestPlanTool,
    showPermissionInPanel,
    onPreviewFile,
    isLastTool,
    processVisibility = "developer" as ProcessVisibility,
    permissionMode = "default",
  }: {
    tool: BusToolItem;
    subTimeline?: TimelineEntry[];
    /** Run ID for lazy-loading truncated tool results. */
    runId?: string;
    /** Callback to fetch full tool result from backend (with caching). */
    fetchToolResult?: (runId: string, toolUseId: string) => Promise<Record<string, unknown> | null>;
    onAnswer?: (answer: string) => void;
    onApprove?: (toolName: string) => void;
    /** Inline permission response (--permission-prompt-tool stdio). */
    onPermissionRespond?: (
      requestId: string,
      behavior: "allow" | "deny",
      updatedPermissions?: PermissionSuggestion[],
      updatedInput?: Record<string, unknown>,
      denyMessage?: string,
      interrupt?: boolean,
    ) => void | Promise<void>;
    /** ExitPlanMode "clear context" handler. */
    onExitPlanClearContext?: () => void | Promise<void>;
    /** ExitPlanMode "bypass" handler — sets bypassPermissions for current run only. */
    onExitPlanBypass?: () => void | Promise<void>;
    /** Background task notifications map (keyed by task_id, matched via tool_use_id). */
    taskNotifications?: Map<string, TaskNotificationItem>;
    /** Plan content to display inline (for ExitPlanMode cards). */
    planContent?: { content: string; fileName: string } | null;
    /** Whether this is the latest plan tool card (for auto-expand). */
    latestPlanTool?: boolean;
    /** Whether generic tool permissions are handled by the floating PermissionPanel. */
    showPermissionInPanel?: boolean;
    /** Click on Edit/Write/Read tool card's file path → open preview in right panel. */
    onPreviewFile?: (path: string) => void;
    /** Whether this is the last tool in the timeline (for reviewing phase detection). */
    isLastTool?: boolean;
    processVisibility?: ProcessVisibility;
    /** Current permission mode to determine skip-permission option in ExitPlanMode. */
    permissionMode?: string;
  } = $props();

  // Look up the task notification for this specific Task tool
  let taskNotification = $derived.by(() => {
    if (tool.tool_name !== "Task" || !taskNotifications) return undefined;
    for (const n of taskNotifications.values()) {
      if (n.tool_use_id === tool.tool_use_id) return n;
    }
    return undefined;
  });

  let userExpanded = $state<boolean | null>(null);
  let submitting = $state(false);

  // ── Lazy loading for truncated tool results ──
  let lazyResult = $state<Record<string, unknown> | null>(null);
  let lazyLoading = $state(false);
  let lazyFailed = $state(false);
  let lazyReqId = 0; // request generation marker

  let isTruncated = $derived(
    (tool.tool_use_result as Record<string, unknown> | undefined)?._truncated === true,
  );

  // Merge lazy-loaded result into tool for rendering
  let enrichedTool = $derived.by(() => {
    if (!lazyResult) return tool;
    return { ...tool, tool_use_result: lazyResult };
  });

  // Auto-fetch full result when expanded + truncated
  // Guard: Level 2 auto-expand does NOT auto-fetch truncated results to avoid
  // a fetch storm on history load. User must click "Load full output" first.
  $effect(() => {
    if (!expanded || !isTruncated || lazyResult || lazyLoading || lazyFailed) return;
    if (!runId || !fetchToolResult) return;
    if (userExpanded === null && isTruncated) return;
    const reqId = ++lazyReqId;
    lazyLoading = true;
    fetchToolResult(runId, tool.tool_use_id)
      .then((r) => {
        if (reqId !== lazyReqId) return; // stale — component switched/collapsed
        lazyResult = r;
        if (!r) lazyFailed = true; // not found → terminal state
      })
      .catch(() => {
        if (reqId !== lazyReqId) return;
        lazyFailed = true;
      })
      .finally(() => {
        if (reqId === lazyReqId) lazyLoading = false;
      });
  });

  function retryLazyLoad() {
    lazyFailed = false; // reset — effect will re-trigger
  }
  let multiChecked: Record<string, boolean> = $state({});
  // Per-question answers for multi-question AskUserQuestion
  let questionAnswers: Record<string, string> = $state({});
  // Per-question "Other" mode state
  let otherActive: Record<string, boolean> = $state({});
  let otherText: Record<string, string> = $state({});
  // ExitPlanMode "keep planning" feedback text
  let planFeedback = $state("");

  // Reset submitting when tool status changes (e.g. permission_prompt → error/permission_denied)
  $effect(() => {
    void tool.status;
    submitting = false;
  });

  let isAgentLike = $derived(tool.tool_name === "Agent" || tool.tool_name === "Task");
  let isAsk = $derived(tool.tool_name === "AskUserQuestion");

  // ── View mode: determine if this tool card should be visible ──
  let shouldShowInMode = $derived.by(() => {
    if (shouldHideToolCards(processVisibility) && !shouldMountFullToolCardInOutputMode(tool)) {
      return false;
    }
    if (viewModeStore.isVerbose) return true;
    if (viewModeStore.isSummary) {
      // Only show significant tools in summary mode
      const significantTools = [
        "Bash",
        "Edit",
        "Write",
        "MultiEdit",
        "AskUserQuestion",
        "ExitPlanMode",
        "Task",
        "Agent",
      ];
      return (
        significantTools.includes(tool.tool_name) ||
        tool.status === "running" ||
        tool.status === "ask_pending" ||
        tool.status === "permission_prompt"
      );
    }
    return true; // normal mode shows everything
  });

  // Auto-expand when input is streaming in (running + has input data)
  // Skip Agent/Task — their input (full prompt) is too large to auto-expand.
  let isInputStreaming = $derived(
    tool.status === "running" &&
      !isAsk &&
      !isAgentLike &&
      tool.input &&
      Object.keys(tool.input).length > 0 &&
      (tool as Record<string, unknown>)._inputJsonAccum != null,
  );
  let renderLevel = $derived(getToolRenderLevel(tool.tool_name, tool.status));
  let isPlan = $derived(isPlanFilePath(String(tool.input?.file_path ?? tool.input?.path ?? "")));
  let expanded = $derived(
    userExpanded ??
      (viewModeStore.isVerbose
        ? true
        : shouldUseCompactToolCards(processVisibility)
          ? false
          : renderLevel === 2 || (isPlan && latestPlanTool) || isInputStreaming),
  );

  let hasSubTimeline = $derived((subTimeline?.length ?? 0) > 0);

  // SubTimeline visibility: all tools auto-collapse on terminal state, userExpanded overrides
  let showSubTimeline = $derived.by(() => {
    if (userExpanded !== null && hasSubTimeline) return userExpanded;
    return _shouldShow(tool.status, hasSubTimeline);
  });

  function handleToggle() {
    const willExpand = hasSubTimeline ? !showSubTimeline : !expanded;
    userExpanded = willExpand;
    dbg("InlineToolCard", "toggle", {
      willExpand,
      hasSubTimeline,
      toolName: tool.tool_name,
      renderLevel,
    });
  }

  let subToolCount = $derived.by(() => {
    if (!subTimeline) return 0;
    let count = 0;
    for (const e of subTimeline) if (e.kind === "tool") count++;
    return count;
  });

  let subToolCompleted = $derived.by(() => {
    if (!subTimeline) return 0;
    let count = 0;
    for (const e of subTimeline) {
      if (e.kind === "tool" && isToolTerminal(e.tool.status)) count++;
    }
    return count;
  });

  let style = $derived(getToolColor(tool.tool_name));

  // Phase detection for PhaseIndicator display
  let currentPhase = $derived(detectPhase(tool.tool_name, tool.status, isLastTool ?? false));

  // Extract a human-readable detail from tool input (file path, command, pattern, etc.)
  let detail = $derived(getToolDetail(tool.input));

  let planLabel = $derived(planFileName(detail));
  let displayDetail = $derived(planLabel ? t("inline_planLabel", { name: planLabel }) : detail);

  // One-line summary for collapsed/normal view
  let toolSummary = $derived(
    getToolSummary(
      tool.tool_name,
      tool.input || {},
      enrichedTool.tool_use_result as Record<string, unknown> | undefined,
    ),
  );

  // Detect if detail looks like an absolute file path (truncate from the front)
  // Plan labels are not paths — skip RTL and path truncation for them.
  let isPathLikeDetail = $derived(!planLabel && isAbsolutePath(detail));

  // For Bash commands, show description (preferred) or truncated command (fallback)
  let bashDescription = $derived.by(() => {
    if (tool.tool_name !== "Bash" && tool.tool_name !== "bash") return "";
    return (tool.input?.description as string) ?? "";
  });
  let bashPreview = $derived.by(() => {
    if (tool.tool_name !== "Bash" && tool.tool_name !== "bash") return "";
    const cmd = (tool.input?.command as string) ?? "";
    return cmd.length > 80 ? cmd.slice(0, 80) + "..." : cmd;
  });

  // Task (subagent) meta: extract agent type + model for enhanced header
  let taskMeta = $derived(tool.tool_name === "Task" ? extractTaskToolMeta(tool.input) : null);

  // Whether current permission mode already skips permission prompts
  let skipPermissionMode = $derived(
    permissionMode === "acceptEdits" || permissionMode === "bypassPermissions",
  );

  // Status display
  let statusKind = $derived(
    tool.status === "success"
      ? "done"
      : tool.status === "error" || tool.status === "denied" || tool.status === "permission_denied"
        ? "error"
        : tool.status === "permission_prompt"
          ? "permission_prompt"
          : "running",
  );

  // AskUserQuestion detection
  // Denied detection: explicit permission_denied status, OR error with no selected option
  // (handles old snapshots where finalizer overwrote permission_denied → error)
  let isAskDenied = $derived.by(() => {
    if (!isAsk) return false;
    if (tool.status === "permission_denied") return true;
    // Fallback: error status + no option selected = denied/interrupted
    if (tool.status === "error") {
      const opts = parsedQuestions[0]?.options.map((o) => o.label) ?? [];
      const ansText = extractOutputText(tool.output);
      const ansSet = new Set(
        ansText
          .split(", ")
          .map((s) => s.trim())
          .filter(Boolean),
      );
      return !opts.some((o) => ansSet.has(o));
    }
    return false;
  });

  // Parse ALL questions from the input (supports multi-question)
  interface ParsedOption {
    label: string;
    description: string;
  }
  interface ParsedQuestion {
    question: string;
    header: string;
    options: ParsedOption[];
    multiSelect: boolean;
  }
  function extractOptions(raw: unknown): ParsedOption[] {
    if (!Array.isArray(raw)) return [];
    return raw.map((o: unknown) => {
      if (typeof o === "string") return { label: o, description: "" };
      if (o && typeof o === "object" && "label" in o) {
        const obj = o as Record<string, unknown>;
        return {
          label: String(obj.label),
          description: typeof obj.description === "string" ? obj.description : "",
        };
      }
      return { label: String(o), description: "" };
    });
  }
  let parsedQuestions = $derived.by((): ParsedQuestion[] => {
    if (!isAsk || !tool.input) return [];
    const questions = tool.input.questions as unknown;
    if (Array.isArray(questions) && questions.length > 0) {
      return questions.map((q: unknown) => {
        const qr = q as Record<string, unknown>;
        return {
          question: typeof qr?.question === "string" ? qr.question : "",
          header: typeof qr?.header === "string" ? qr.header : "",
          options: extractOptions(qr?.options),
          multiSelect: qr?.multiSelect === true,
        };
      });
    }
    // Legacy single-question format
    if (typeof tool.input.question === "string") {
      return [
        {
          question: tool.input.question,
          header: "",
          options: extractOptions(tool.input.options as unknown),
          multiSelect: tool.input.multiSelect === true,
        },
      ];
    }
    return [];
  });

  // Backward-compat: first question's text, options, multiSelect (used by existing templates)
  let askQuestion = $derived(parsedQuestions[0]?.question ?? "");
  // askOptions: string[] for backward-compat (non-permission mode, multiSelect tracking, done state)
  let askOptions = $derived(parsedQuestions[0]?.options.map((o) => o.label) ?? ([] as string[]));
  let isMultiSelect = $derived(parsedQuestions[0]?.multiSelect ?? false);
  let hasMultipleQuestions = $derived(parsedQuestions.length > 1);

  // Track how many questions are answered (for multi-question submit)
  let allQuestionsAnswered = $derived(
    parsedQuestions.length > 0 && parsedQuestions.every((q) => !!questionAnswers[q.question]),
  );

  // Output text (used by AskUserQuestion answer display)
  let outputText = $derived(extractOutputText(tool.output));

  // All answers for AskUserQuestion (supports multi-question via tool_use_result.answers)
  let askAnswersMap = $derived.by((): Record<string, string> => {
    if (!isAsk) return {};
    // Primary: structured answers from tool_use_result (stream-json mode with updatedInput)
    const tur = tool.tool_use_result as Record<string, unknown> | undefined;
    if (tur?.answers && typeof tur.answers === "object") {
      return tur.answers as Record<string, string>;
    }
    // Fallback: single answer from output
    if (tool.output) {
      const a = (tool.output as Record<string, unknown>).answer;
      if (typeof a === "string" && askQuestion) return { [askQuestion]: a };
    }
    // Fallback: parse from output text
    if (outputText && askQuestion) return { [askQuestion]: outputText };
    return {};
  });

  // Annotations map for "Other" free text (from tool_use_result.annotations)
  let askAnnotationsMap = $derived.by((): Record<string, string> => {
    if (!isAsk) return {};
    const tur = tool.tool_use_result as Record<string, unknown> | undefined;
    if (tur?.annotations && typeof tur.annotations === "object") {
      const ann = tur.annotations as Record<string, unknown>;
      const result: Record<string, string> = {};
      for (const [q, v] of Object.entries(ann)) {
        if (v && typeof v === "object" && "notes" in (v as Record<string, unknown>)) {
          const notes = (v as Record<string, unknown>).notes;
          if (typeof notes === "string") result[q] = notes;
        }
      }
      return result;
    }
    return {};
  });

  // Backward-compat: first question's answer (for single-question display)
  let askAnswer = $derived(askQuestion ? (askAnswersMap[askQuestion] ?? "") : "");
  // Set of selected answers for matching (handles "A, B, C" multi-select format)
  let askAnswerSet = $derived.by(() => {
    if (!askAnswer) return new Set<string>();
    return new Set(
      askAnswer
        .split(", ")
        .map((s) => s.trim())
        .filter(Boolean),
    );
  });

  // Duration display
  let durationLabel = $derived(tool.duration_ms != null ? formatDuration(tool.duration_ms) : "");

  // Elapsed time from tool_progress (shown while running)
  let elapsedLabel = $derived(
    tool.status === "running" && tool.elapsed_time_seconds != null
      ? `${tool.elapsed_time_seconds.toFixed(1)}s`
      : "",
  );

  // Output size label (shown when tool is complete)
  let outputSizeLabel = $derived.by(() => {
    if (tool.status !== "success" && tool.status !== "error") return "";
    const tur = tool.tool_use_result;
    if (tur && typeof tur === "object") {
      // Read: line info from file metadata
      const fileResult = tur.file as { numLines?: number; totalLines?: number } | undefined;
      if (fileResult?.totalLines != null) {
        if (fileResult.numLines != null && fileResult.numLines < fileResult.totalLines) {
          return `${fileResult.numLines}/${fileResult.totalLines} lines`;
        }
        return `${fileResult.totalLines} lines`;
      }
      // Glob: file count
      if ("filenames" in tur && "numFiles" in tur && !("mode" in tur)) {
        const n = tur.numFiles as number;
        return `${n} file${n !== 1 ? "s" : ""}`;
      }
      // Grep: file + match counts
      if ("numFiles" in tur && "mode" in tur) {
        const nf = tur.numFiles as number;
        const nl = tur.numLines as number | undefined;
        if (nl != null)
          return `${nf} file${nf !== 1 ? "s" : ""}, ${nl} match${nl !== 1 ? "es" : ""}`;
        return `${nf} file${nf !== 1 ? "s" : ""}`;
      }
      // Edit: patch line count — skip expensive lines traversal when collapsed
      if ("structuredPatch" in tur) {
        // Backend pre-computed counts (summary mode — lines array stripped)
        if ("_patchAdded" in tur || "_patchRemoved" in tur) {
          return `+${(tur._patchAdded as number) ?? 0} -${(tur._patchRemoved as number) ?? 0}`;
        }
        // Only traverse patches when expanded (expensive operation)
        if (!expanded) return "edited";
        // Fallback: original lines traversal (live mode / small payload not truncated)
        const patches = tur.structuredPatch as Array<{ lines: string[] }> | undefined;
        if (patches?.length) {
          const added = patches.reduce(
            (n, h) => n + (h.lines?.filter((l: string) => l.startsWith("+")).length ?? 0),
            0,
          );
          const removed = patches.reduce(
            (n, h) => n + (h.lines?.filter((l: string) => l.startsWith("-")).length ?? 0),
            0,
          );
          return `+${added} -${removed}`;
        }
      }
      // Bash: interrupted indicator
      if ("interrupted" in tur && (tur.interrupted as boolean)) {
        return "interrupted";
      }
      // WebFetch: HTTP status + response size
      if ("code" in tur && "bytes" in tur && "codeText" in tur) {
        const code = tur.code as number;
        const bytes = tur.bytes as number;
        const size = bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
        return `${code} ${tur.codeText} \u00b7 ${size}`;
      }
      // WebSearch: result count
      if ("results" in tur && Array.isArray(tur.results)) {
        const count = (tur.results as unknown[]).filter((r) => typeof r !== "string").length;
        return `${count} result${count !== 1 ? "s" : ""}`;
      }
      // Task (subagent): usage stats or async
      if ("totalToolUseCount" in tur) {
        const tools = tur.totalToolUseCount as number;
        const ms = tur.totalDurationMs as number | undefined;
        const tokens = tur.totalTokens as number | undefined;
        const parts: string[] = [`${tools} tools`];
        if (ms != null) parts.push(formatDuration(ms));
        if (tokens != null) parts.push(`${formatTokenCount(tokens)} tok`);
        return parts.join(" \u00b7 ");
      }
      if ((tur as Record<string, unknown>).status === "async_launched") {
        return "async";
      }
      // TodoWrite: item count
      if ("newTodos" in tur) {
        const n = (tur.newTodos as unknown[]).length;
        return `${n} item${n !== 1 ? "s" : ""}`;
      }
    }
    // Fallback: count output lines — only when expanded (expensive split)
    if (expanded) {
      const output = extractOutputText(tool.output);
      if (!output) return "";
      const lines = output.split("\n").length;
      if (lines <= 1) return "";
      return `${lines} lines`;
    }
    return "";
  });

  function multiCount(): number {
    return Object.values(multiChecked).filter(Boolean).length;
  }

  function toggleMulti(option: string) {
    multiChecked = { ...multiChecked, [option]: !multiChecked[option] };
  }

  async function handleAnswer(answer: string) {
    if (submitting) return;
    submitting = true;
    try {
      onAnswer?.(answer);
    } catch {
      submitting = false;
    }
  }

  function handleAskPermissionAllow(answer: string) {
    if (submitting || !onPermissionRespond || !tool.permission_request_id) return;
    if (hasMultipleQuestions) {
      // Multi-question: store answer and wait for all questions
      questionAnswers[askQuestion] = answer;
      return;
    }
    submitting = true;
    const answers: Record<string, string> = { [askQuestion]: answer };
    const updatedInput = { ...tool.input, answers };
    safePermissionRespond(tool.permission_request_id, "allow", undefined, updatedInput);
  }

  function submitMultiSelectPermission() {
    if (submitting || !onPermissionRespond || !tool.permission_request_id) return;
    let selected = Object.keys(multiChecked).filter((k) => multiChecked[k]);
    const otherVal = otherActive[askQuestion] && otherText[askQuestion]?.trim();
    if (otherVal) selected = [...selected, otherVal];
    if (selected.length === 0) return;
    submitting = true;
    const answers: Record<string, string> = { [askQuestion]: selected.join(", ") };
    const updatedInput = { ...tool.input, answers };
    safePermissionRespond(tool.permission_request_id, "allow", undefined, updatedInput);
  }

  // Multi-question: select answer for a specific question
  function selectQuestionAnswer(questionText: string, answer: string) {
    questionAnswers[questionText] = answer;
  }

  // Multi-question: submit all answers at once
  function submitAllQuestionAnswers() {
    if (submitting || !onPermissionRespond || !tool.permission_request_id) return;
    if (!allQuestionsAnswered) return;
    submitting = true;
    const annotations: Record<string, { notes: string }> = {};
    for (const [q, ans] of Object.entries(questionAnswers)) {
      if (ans === "Other" && otherText[q]?.trim()) {
        annotations[q] = { notes: otherText[q].trim() };
      }
    }
    const updatedInput = {
      ...tool.input,
      answers: { ...questionAnswers },
      ...(Object.keys(annotations).length > 0 ? { annotations } : {}),
    };
    safePermissionRespond(tool.permission_request_id, "allow", undefined, updatedInput);
  }

  // Single-select "Other" submit (permission mode)
  function handleAskPermissionOther(questionText: string) {
    if (submitting || !onPermissionRespond || !tool.permission_request_id) return;
    const text = (otherText[questionText] ?? "").trim();
    if (!text) return;
    submitting = true;
    const answers: Record<string, string> = { [questionText]: "Other" };
    const annotations: Record<string, { notes: string }> = {
      [questionText]: { notes: text },
    };
    const updatedInput = { ...tool.input, answers, annotations };
    safePermissionRespond(tool.permission_request_id, "allow", undefined, updatedInput);
  }

  // Wrapper: IPC success → submitting reset by $effect(tool.status);
  // IPC failure → parent re-throws → catch unlocks immediately.
  async function safePermissionRespond(
    ...args: Parameters<NonNullable<typeof onPermissionRespond>>
  ) {
    try {
      await onPermissionRespond?.(...args);
    } catch {
      submitting = false;
    }
  }

  async function _safeClearContext() {
    try {
      await onExitPlanClearContext?.();
    } catch {
      submitting = false;
    }
  }

  async function safeExitPlanBypass() {
    try {
      await onExitPlanBypass?.();
    } catch {
      submitting = false;
    }
  }

  function formatSuggestionLabel(s: PermissionSuggestion): string {
    return _fmtSuggestion(s, t as (key: string, params?: Record<string, string>) => string);
  }
</script>

<!-- Inline tool card: three-level rendering -->
{#if shouldShowInMode}
  {#if shouldShowFullToolPayload(processVisibility)}
    <div class="mb-0.5 px-1 font-mono text-[10px] text-muted-foreground/55">
      tool_use_id {tool.tool_use_id}
    </div>
  {/if}
  <div
    class="motion-slide-up {renderLevel === 1 ? 'mb-0.5' : 'mb-2'} {tool.status === 'running'
      ? 'motion-sweep'
      : ''} {tool.status === 'error' ||
    tool.status === 'denied' ||
    tool.status === 'permission_denied'
      ? 'motion-status-error'
      : ''} {tool.status === 'success' ? 'motion-status-success' : ''}"
  >
    {#if renderLevel === 3}
      <!-- Level 3: interactive card -->
      <div>
        {#if isAsk && (tool.status === "running" || tool.status === "ask_pending") && askQuestion}
          <!-- AskUserQuestion: show question + option buttons -->
          <div
            class="glass-card rounded-lg border border-[hsl(var(--miwarp-status-warning)/0.3)] bg-[hsl(var(--miwarp-status-warning)/0.05)] px-4 py-3"
            style="border-left: 3px solid; border-image: linear-gradient(180deg, hsl(var(--miwarp-accent-primary)), hsl(var(--miwarp-accent-violet))) 1;"
          >
            <div class="flex items-center gap-2 mb-2">
              <div class="flex h-5 w-5 shrink-0 items-center justify-center rounded {style.bg}">
                <svg
                  class="h-3 w-3 {style.text}"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d={style.icon} />
                </svg>
              </div>
              <span class="text-xs font-medium text-foreground">{t("inline_question")}</span>
              <PhaseIndicator phase={currentPhase} elapsed={tool.elapsed_time_seconds} />
              <div class="h-3 w-3 shrink-0 ml-auto">
                <div
                  class="h-2.5 w-2.5 rounded-full border-2 border-border border-t-[hsl(var(--miwarp-status-warning))] animate-spin"
                ></div>
              </div>
            </div>
            <MarkdownContent
              text={askQuestion}
              class="text-sm text-foreground mb-3 [&>*:last-child]:mb-0"
            />
            {#if askOptions.length > 0 && onAnswer}
              {#if isMultiSelect}
                <div class="flex flex-wrap items-center gap-2">
                  {#each askOptions as option}
                    <button
                      class="rounded-md border px-3 py-1.5 text-xs font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed {multiChecked[
                        option
                      ]
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border bg-background text-foreground hover:bg-accent hover:border-ring/30'}"
                      disabled={submitting}
                      onclick={() => toggleMulti(option)}
                    >
                      {#if multiChecked[option]}
                        <svg
                          class="inline h-3 w-3 mr-1 -mt-0.5"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2.5"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        >
                          <path d="M20 6 9 17l-5-5" />
                        </svg>
                      {/if}
                      {option}
                    </button>
                  {/each}
                  <button
                    class="rounded-md border border-dashed px-3 py-1.5 text-xs font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed {otherActive[
                      askQuestion
                    ]
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-background text-muted-foreground hover:bg-accent hover:border-ring/30'}"
                    disabled={submitting}
                    onclick={() => {
                      otherActive = { ...otherActive, [askQuestion]: !otherActive[askQuestion] };
                    }}
                  >
                    {t("inline_other")}
                  </button>
                  {#if otherActive[askQuestion]}
                    <input
                      type="text"
                      bind:value={otherText[askQuestion]}
                      placeholder={t("inline_otherPlaceholder")}
                      class="w-full rounded-md border border-border bg-transparent px-2 py-1 text-xs placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  {/if}
                  <button
                    class="rounded-md bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={submitting ||
                      (multiCount() === 0 &&
                        !(otherActive[askQuestion] && otherText[askQuestion]?.trim()))}
                    onclick={() => {
                      const selected = Object.keys(multiChecked).filter((k) => multiChecked[k]);
                      const otherVal = otherActive[askQuestion] && otherText[askQuestion]?.trim();
                      if (otherVal) selected.push(otherVal);
                      if (selected.length > 0) handleAnswer(selected.join(", "));
                    }}
                  >
                    {multiCount() > 0
                      ? t("inline_submitCount", { count: String(multiCount()) })
                      : t("inline_submit")}
                  </button>
                </div>
              {:else}
                <div class="flex flex-wrap gap-2">
                  {#each askOptions as option}
                    <button
                      class="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent hover:border-ring/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      disabled={submitting}
                      onclick={() => handleAnswer(option)}
                    >
                      {option}
                    </button>
                  {/each}
                  <button
                    class="rounded-md border border-dashed border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:border-ring/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={submitting}
                    onclick={() => {
                      otherActive = { ...otherActive, [askQuestion]: true };
                    }}
                  >
                    {t("inline_other")}
                  </button>
                  {#if otherActive[askQuestion]}
                    <div class="flex gap-1.5 w-full mt-0.5">
                      <input
                        type="text"
                        bind:value={otherText[askQuestion]}
                        placeholder={t("inline_otherPlaceholder")}
                        class="flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-xs placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                      <button
                        class="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={submitting || !otherText[askQuestion]?.trim()}
                        onclick={() => {
                          const text = otherText[askQuestion]?.trim();
                          if (text) handleAnswer(text);
                        }}
                      >
                        {t("inline_submitOther")}
                      </button>
                    </div>
                  {/if}
                </div>
              {/if}
            {/if}
          </div>
        {:else if isAsk && tool.status !== "running" && tool.status !== "ask_pending" && tool.status !== "permission_prompt"}
          <!-- AskUserQuestion done: show question(s) + options with selected highlighted -->
          <div class="glass-card rounded-lg px-4 py-3">
            <div class="flex items-center gap-2 mb-2">
              <div class="flex h-5 w-5 shrink-0 items-center justify-center rounded {style.bg}">
                <svg
                  class="h-3 w-3 {style.text}"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d={style.icon} />
                </svg>
              </div>
              <span class="text-xs font-medium text-muted-foreground">{t("inline_question")}</span>
              {#if isAskDenied}
                <span
                  class="ml-auto rounded-full border border-[hsl(var(--miwarp-status-error)/0.3)] bg-[hsl(var(--miwarp-status-error)/0.1)] px-2 py-0.5 text-[10px] font-medium text-[hsl(var(--miwarp-status-error))]"
                  >{t("common_denied")}</span
                >
              {:else}
                <svg
                  class="h-3.5 w-3.5 text-[hsl(var(--miwarp-status-success))] shrink-0 ml-auto"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              {/if}
            </div>
            {#if hasMultipleQuestions}
              <!-- Multi-question done: show all questions with answers -->
              <div class="space-y-2.5">
                {#each parsedQuestions as pq}
                  <div>
                    {#if pq.header}
                      <span
                        class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                        >{pq.header}</span
                      >
                    {/if}
                    <MarkdownContent
                      text={pq.question}
                      class="text-sm text-foreground mb-1 [&>*:last-child]:mb-0"
                    />
                    {#if pq.options.length > 0}
                      <div class="flex flex-wrap gap-1.5">
                        {#each pq.options as option}
                          {@const isSelected =
                            askAnswersMap[pq.question] === option.label ||
                            askAnswersMap[pq.question]?.split(", ").includes(option.label)}
                          <span
                            class="rounded-md border px-3 py-1 text-xs font-medium {isSelected
                              ? 'border-[hsl(var(--miwarp-status-success)/0.5)] bg-[hsl(var(--miwarp-status-success)/0.1)] text-[hsl(var(--miwarp-status-success))]'
                              : 'border-border/50 bg-transparent text-muted-foreground/50'}"
                          >
                            {#if isSelected}
                              <svg
                                class="inline h-3 w-3 mr-0.5 -mt-0.5"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2.5"
                                stroke-linecap="round"
                                stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg
                              >
                            {/if}
                            {option.label}
                          </span>
                        {/each}
                        {#if askAnnotationsMap[pq.question]}
                          <span
                            class="rounded-md border border-[hsl(var(--miwarp-status-success)/0.5)] bg-[hsl(var(--miwarp-status-success)/0.1)] px-3 py-1 text-xs font-medium text-[hsl(var(--miwarp-status-success))]"
                          >
                            <svg
                              class="inline h-3 w-3 mr-0.5 -mt-0.5"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="2.5"
                              stroke-linecap="round"
                              stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg
                            >
                            {askAnnotationsMap[pq.question]}
                          </span>
                        {/if}
                      </div>
                    {:else if askAnnotationsMap[pq.question]}
                      <span
                        class="rounded-md border border-[hsl(var(--miwarp-status-success)/0.5)] bg-[hsl(var(--miwarp-status-success)/0.1)] px-3 py-1 text-xs font-medium text-[hsl(var(--miwarp-status-success))]"
                      >
                        <svg
                          class="inline h-3 w-3 mr-0.5 -mt-0.5"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2.5"
                          stroke-linecap="round"
                          stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg
                        >
                        {askAnnotationsMap[pq.question]}
                      </span>
                    {:else if askAnswersMap[pq.question]}
                      <span
                        class="rounded-md border border-[hsl(var(--miwarp-status-success)/0.5)] bg-[hsl(var(--miwarp-status-success)/0.1)] px-3 py-1 text-xs font-medium text-[hsl(var(--miwarp-status-success))]"
                      >
                        <svg
                          class="inline h-3 w-3 mr-0.5 -mt-0.5"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2.5"
                          stroke-linecap="round"
                          stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg
                        >
                        {askAnswersMap[pq.question]}
                      </span>
                    {/if}
                  </div>
                {/each}
              </div>
            {:else}
              <!-- Single question done -->
              <MarkdownContent
                text={askQuestion}
                class="text-sm text-foreground mb-3 [&>*:last-child]:mb-0"
              />
              {#if askOptions.length > 0}
                <div class="flex flex-wrap gap-2">
                  {#each askOptions as option}
                    <span
                      class="rounded-md border px-3 py-1.5 text-xs font-medium transition-all {askAnswerSet.has(
                        option,
                      )
                        ? 'border-[hsl(var(--miwarp-status-success)/0.5)] bg-[hsl(var(--miwarp-status-success)/0.1)] text-[hsl(var(--miwarp-status-success))]'
                        : 'border-border/50 bg-transparent text-muted-foreground/50'}"
                    >
                      {#if askAnswerSet.has(option)}
                        <svg
                          class="inline h-3 w-3 mr-1 -mt-0.5"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2.5"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        >
                          <path d="M20 6 9 17l-5-5" />
                        </svg>
                      {/if}
                      {option}
                    </span>
                  {/each}
                  {#if askAnnotationsMap[askQuestion]}
                    <span
                      class="rounded-md border border-[hsl(var(--miwarp-status-success)/0.5)] bg-[hsl(var(--miwarp-status-success)/0.1)] px-3 py-1.5 text-xs font-medium text-[hsl(var(--miwarp-status-success))]"
                    >
                      <svg
                        class="inline h-3 w-3 mr-1 -mt-0.5"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2.5"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                      {askAnnotationsMap[askQuestion]}
                    </span>
                  {/if}
                </div>
              {:else if askAnnotationsMap[askQuestion]}
                <span
                  class="rounded-md border border-[hsl(var(--miwarp-status-success)/0.5)] bg-[hsl(var(--miwarp-status-success)/0.1)] px-3 py-1.5 text-xs font-medium text-[hsl(var(--miwarp-status-success))]"
                >
                  <svg
                    class="inline h-3 w-3 mr-1 -mt-0.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                  {askAnnotationsMap[askQuestion]}
                </span>
              {:else if askAnswer}
                <span
                  class="rounded-md border border-[hsl(var(--miwarp-status-success)/0.5)] bg-[hsl(var(--miwarp-status-success)/0.1)] px-3 py-1.5 text-xs font-medium text-[hsl(var(--miwarp-status-success))]"
                >
                  <svg
                    class="inline h-3 w-3 mr-1 -mt-0.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                  {askAnswer}
                </span>
              {/if}
            {/if}
          </div>
        {:else if isAsk && tool.status === "permission_prompt" && askQuestion && tool.permission_request_id}
          <!-- AskUserQuestion permission prompt: show question(s) + options with Allow/Deny semantics -->
          <div
            class="glass-card rounded-lg border border-[hsl(var(--miwarp-status-warning)/0.3)] bg-[hsl(var(--miwarp-status-warning)/0.05)] px-4 py-3"
          >
            <div class="flex items-center gap-2 mb-2">
              <div class="flex h-5 w-5 shrink-0 items-center justify-center rounded {style.bg}">
                <svg
                  class="h-3 w-3 {style.text}"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d={style.icon} />
                </svg>
              </div>
              <span class="text-xs font-medium text-foreground">
                {parsedQuestions.length > 1
                  ? t("inline_questionsCount", {
                      answered: String(Object.keys(questionAnswers).length),
                      total: String(parsedQuestions.length),
                    })
                  : t("inline_question")}
              </span>
              {#if !submitting}
                <div class="h-3 w-3 shrink-0">
                  <div
                    class="h-2.5 w-2.5 rounded-full border-2 border-border border-t-[hsl(var(--miwarp-status-warning))] animate-spin"
                  ></div>
                </div>
              {/if}
            </div>
            {#if onPermissionRespond}
              {#if hasMultipleQuestions}
                <!-- Multi-question layout -->
                <div class="space-y-3">
                  {#each parsedQuestions as pq}
                    <div>
                      {#if pq.header}
                        <span
                          class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                          >{pq.header}</span
                        >
                      {/if}
                      <MarkdownContent
                        text={pq.question}
                        class="text-sm text-foreground mb-1.5 [&>*:last-child]:mb-0"
                      />
                      <div class="flex flex-wrap gap-1.5">
                        {#each pq.options as option}
                          <button
                            class="rounded-md border px-3 py-1 text-xs font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed text-left {questionAnswers[
                              pq.question
                            ] === option.label
                              ? 'border-primary bg-primary/10 text-primary'
                              : 'border-border bg-background text-foreground hover:bg-accent hover:border-ring/30'}"
                            disabled={submitting}
                            onclick={() => {
                              otherActive = { ...otherActive, [pq.question]: false };
                              selectQuestionAnswer(pq.question, option.label);
                            }}
                          >
                            {#if questionAnswers[pq.question] === option.label}
                              <svg
                                class="inline h-3 w-3 mr-0.5 -mt-0.5"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2.5"
                                stroke-linecap="round"
                                stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg
                              >
                            {/if}
                            <span>{option.label}</span>
                            {#if option.description}
                              <span
                                class="block text-[10px] text-muted-foreground/70 font-normal mt-0.5"
                              >
                                <MarkdownContent
                                  text={option.description}
                                  class="[&>*:last-child]:mb-0 [&_p]:text-[10px] [&_p]:leading-snug"
                                />
                              </span>
                            {/if}
                          </button>
                        {/each}
                        <!-- Other option -->
                        <button
                          class="rounded-md border border-dashed px-3 py-1 text-xs font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed {otherActive[
                            pq.question
                          ] && questionAnswers[pq.question] === 'Other'
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border bg-background text-muted-foreground hover:bg-accent hover:border-ring/30'}"
                          disabled={submitting}
                          onclick={() => {
                            const wasActive = otherActive[pq.question];
                            otherActive = { ...otherActive, [pq.question]: !wasActive };
                            if (!wasActive) {
                              selectQuestionAnswer(pq.question, "Other");
                            } else if (questionAnswers[pq.question] === "Other") {
                              const { [pq.question]: _, ...rest } = questionAnswers;
                              questionAnswers = rest;
                            }
                          }}
                        >
                          {t("inline_other")}
                        </button>
                        {#if otherActive[pq.question]}
                          <input
                            type="text"
                            bind:value={otherText[pq.question]}
                            placeholder={t("inline_otherPlaceholder")}
                            class="w-full mt-0.5 rounded-md border border-border bg-transparent px-2 py-1 text-xs placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
                          />
                        {/if}
                      </div>
                    </div>
                  {/each}
                  <div class="flex gap-2 pt-1">
                    <button
                      class="rounded-md bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      disabled={submitting || !allQuestionsAnswered}
                      onclick={submitAllQuestionAnswers}
                    >
                      {t("inline_submitCount", {
                        count: `${Object.keys(questionAnswers).length}/${parsedQuestions.length}`,
                      })}
                    </button>
                    <button
                      class="rounded-md border border-border px-4 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent transition-all disabled:opacity-50"
                      disabled={submitting}
                      onclick={() => {
                        submitting = true;
                        safePermissionRespond(tool.permission_request_id!, "deny");
                      }}>{t("common_deny")}</button
                    >
                  </div>
                </div>
              {:else if isMultiSelect}
                <!-- Single multi-select question -->
                <MarkdownContent
                  text={askQuestion}
                  class="text-sm text-foreground mb-3 [&>*:last-child]:mb-0"
                />
                <div class="flex flex-wrap items-center gap-2">
                  {#each askOptions as option}
                    <button
                      class="rounded-md border px-3 py-1.5 text-xs font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed {multiChecked[
                        option
                      ]
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border bg-background text-foreground hover:bg-accent hover:border-ring/30'}"
                      disabled={submitting}
                      onclick={() => toggleMulti(option)}
                    >
                      {#if multiChecked[option]}
                        <svg
                          class="inline h-3 w-3 mr-1 -mt-0.5"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2.5"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        >
                          <path d="M20 6 9 17l-5-5" />
                        </svg>
                      {/if}
                      {option}
                    </button>
                  {/each}
                  <button
                    class="rounded-md border border-dashed px-3 py-1.5 text-xs font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed {otherActive[
                      askQuestion
                    ]
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-background text-muted-foreground hover:bg-accent hover:border-ring/30'}"
                    disabled={submitting}
                    onclick={() => {
                      otherActive = { ...otherActive, [askQuestion]: !otherActive[askQuestion] };
                    }}
                  >
                    {t("inline_other")}
                  </button>
                  {#if otherActive[askQuestion]}
                    <input
                      type="text"
                      bind:value={otherText[askQuestion]}
                      placeholder={t("inline_otherPlaceholder")}
                      class="w-full rounded-md border border-border bg-transparent px-2 py-1 text-xs placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  {/if}
                  <button
                    class="rounded-md bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={submitting ||
                      (multiCount() === 0 &&
                        !(otherActive[askQuestion] && otherText[askQuestion]?.trim()))}
                    onclick={submitMultiSelectPermission}
                  >
                    {multiCount() > 0
                      ? t("inline_submitCount", { count: String(multiCount()) })
                      : t("inline_submit")}
                  </button>
                  <button
                    class="rounded-md border border-border px-4 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-all disabled:opacity-50"
                    disabled={submitting}
                    onclick={() => {
                      submitting = true;
                      safePermissionRespond(tool.permission_request_id!, "deny");
                    }}>{t("common_deny")}</button
                  >
                </div>
              {:else}
                <!-- Single question, single select -->
                <MarkdownContent
                  text={askQuestion}
                  class="text-sm text-foreground mb-3 [&>*:last-child]:mb-0"
                />
                <div class="flex flex-wrap gap-2">
                  {#each askOptions as option}
                    <button
                      class="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent hover:border-ring/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      disabled={submitting}
                      onclick={() => handleAskPermissionAllow(option)}
                    >
                      {option}
                    </button>
                  {/each}
                  <button
                    class="rounded-md border border-dashed border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:border-ring/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={submitting}
                    onclick={() => {
                      otherActive = { ...otherActive, [askQuestion]: true };
                    }}
                  >
                    {t("inline_other")}
                  </button>
                  {#if otherActive[askQuestion]}
                    <div class="flex gap-1.5 w-full mt-0.5">
                      <input
                        type="text"
                        bind:value={otherText[askQuestion]}
                        placeholder={t("inline_otherPlaceholder")}
                        class="flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-xs placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                      <button
                        class="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={submitting || !otherText[askQuestion]?.trim()}
                        onclick={() => handleAskPermissionOther(askQuestion)}
                      >
                        {t("inline_submitOther")}
                      </button>
                    </div>
                  {/if}
                  <button
                    class="rounded-md border border-border px-4 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent transition-all disabled:opacity-50"
                    disabled={submitting}
                    onclick={() => {
                      submitting = true;
                      safePermissionRespond(tool.permission_request_id!, "deny");
                    }}>{t("common_deny")}</button
                  >
                </div>
              {/if}
            {/if}
          </div>
        {:else if tool.status === "permission_prompt" && tool.permission_request_id && tool.tool_name === "ExitPlanMode"}
          <!-- ExitPlanMode: 3-option execution card + continue planning -->
          <div
            class="glass-card rounded-xl border border-[hsl(var(--miwarp-accent-primary)/0.3)] bg-[hsl(var(--miwarp-accent-primary)/0.04)] px-4 py-3"
            style="border-left: 3px solid; border-image: linear-gradient(180deg, hsl(var(--miwarp-accent-primary)), hsl(var(--miwarp-accent-violet))) 1;"
          >
            <!-- Header -->
            <div class="flex items-center gap-2 mb-1.5">
              <div
                class="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-[hsl(var(--miwarp-accent-primary)/0.1)]"
              >
                <svg
                  class="h-3 w-3 text-[hsl(var(--miwarp-accent-primary))]"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path
                    d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"
                  />
                </svg>
              </div>
              <span class="text-xs font-semibold text-foreground">{t("planConfirm_title")}</span>
              <PhaseIndicator phase={currentPhase} elapsed={tool.elapsed_time_seconds} />
              <div class="h-3 w-3 shrink-0 ml-auto">
                <div
                  class="h-2.5 w-2.5 rounded-full border-2 border-border border-t-[hsl(var(--miwarp-accent-primary))] animate-spin"
                ></div>
              </div>
            </div>

            <!-- Subtitle -->
            <p class="text-xs text-muted-foreground mb-3">
              {planContent ? t("planConfirm_subtitle") : t("planConfirm_missingPlan")}
            </p>

            <!-- Plan content block -->
            {#if planContent}
              <div
                class="mb-3 rounded-lg border border-[hsl(var(--miwarp-accent-primary)/0.15)] bg-background/50 overflow-hidden"
              >
                <div
                  class="flex items-center gap-1.5 px-3 py-1.5 border-b border-[hsl(var(--miwarp-accent-primary)/0.1)] bg-[hsl(var(--miwarp-accent-primary)/0.05)]"
                >
                  <svg
                    class="h-3 w-3 text-[hsl(var(--miwarp-accent-primary))]"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                  <span class="text-[11px] font-medium text-[hsl(var(--miwarp-accent-primary))]"
                    >{planContent.fileName}</span
                  >
                </div>
                <div class="px-4 py-3 max-h-72 overflow-y-auto prose-chat">
                  <MarkdownContent text={planContent.content} />
                </div>
              </div>
            {/if}

            <!-- allowedPrompts -->
            {#if tool.input?.allowedPrompts && Array.isArray(tool.input.allowedPrompts) && tool.input.allowedPrompts.length > 0}
              <div
                class="mb-3 rounded border border-[hsl(var(--miwarp-accent-primary)/0.1)] bg-[hsl(var(--miwarp-accent-primary)/0.05)] px-2.5 py-2"
              >
                <p class="text-[10px] font-medium text-[hsl(var(--miwarp-accent-primary))] mb-1.5">
                  {t("plan_requestedPermissions")}
                </p>
                <ul class="space-y-0.5">
                  {#each tool.input.allowedPrompts as ap}
                    {@const toolName = String((ap as Record<string, unknown>).tool ?? "")}
                    {@const prompt = String((ap as Record<string, unknown>).prompt ?? "")}
                    <li class="flex items-start gap-1.5 text-[10px] text-muted-foreground/80">
                      <span class="shrink-0 mt-0.5 text-[hsl(var(--miwarp-accent-primary)/0.6)]"
                        >&bull;</span
                      >
                      <span
                        ><span class="font-medium text-[hsl(var(--miwarp-accent-primary))]"
                          >{friendlyToolName(toolName)}</span
                        >{#if prompt}: {prompt}{/if}</span
                      >
                    </li>
                  {/each}
                </ul>
              </div>
            {/if}

            <!-- pushToRemote link -->
            {#if tool.input?.pushToRemote && tool.input?.remoteSessionUrl}
              <a
                href={String(tool.input.remoteSessionUrl)}
                target="_blank"
                rel="noopener noreferrer"
                class="mb-3 flex items-center gap-1.5 rounded border border-[hsl(var(--miwarp-status-info)/0.2)] bg-[hsl(var(--miwarp-status-info)/0.05)] px-2.5 py-1.5 text-xs font-medium text-[hsl(var(--miwarp-status-info))] hover:bg-[hsl(var(--miwarp-status-info)/0.1)] transition-colors w-fit"
              >
                <svg
                  class="h-3 w-3 shrink-0"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline
                    points="15 3 21 3 21 9"
                  /><line x1="10" y1="14" x2="21" y2="3" />
                </svg>
                {t("plan_openRemote")}
              </a>
            {/if}

            {#if onPermissionRespond}
              {#if skipPermissionMode}
                <!-- Session already in skip-permission mode -->
                <button
                  class="w-full rounded-lg border border-[hsl(var(--miwarp-status-success)/0.4)] bg-[hsl(var(--miwarp-status-success)/0.12)] px-3 py-2 text-xs font-medium text-[hsl(var(--miwarp-status-success))] hover:bg-[hsl(var(--miwarp-status-success)/0.22)] transition-all disabled:opacity-50"
                  disabled={submitting}
                  onclick={() => {
                    submitting = true;
                    safePermissionRespond(
                      tool.permission_request_id!,
                      "deny",
                      undefined,
                      undefined,
                      undefined,
                      false,
                    );
                  }}
                >
                  {t("plan_skipPermission")}
                </button>
              {:else}
                <!-- 3 execution option cards -->
                <div class="grid grid-cols-3 gap-2 mb-3">
                  <!-- Card 1: Auto-accept edits (recommended) -->
                  <button
                    class="flex flex-col items-start rounded-xl border-2 border-[hsl(var(--miwarp-status-success)/0.5)] bg-[hsl(var(--miwarp-status-success)/0.08)] hover:bg-[hsl(var(--miwarp-status-success)/0.16)] hover:border-[hsl(var(--miwarp-status-success)/0.7)] transition-all disabled:opacity-50 p-2.5 text-left"
                    disabled={submitting}
                    onclick={() => {
                      submitting = true;
                      safePermissionRespond(
                        tool.permission_request_id!,
                        "allow",
                        [{ type: "setMode", mode: "acceptEdits", destination: "session" }],
                        tool.input,
                      );
                    }}
                  >
                    <span
                      class="inline-flex items-center gap-1 rounded-full bg-[hsl(var(--miwarp-status-success)/0.2)] px-1.5 py-0.5 mb-1.5"
                    >
                      <span
                        class="text-[9px] font-semibold uppercase tracking-wider text-[hsl(var(--miwarp-status-success))]"
                        >{t("planConfirm_autoBadge")}</span
                      >
                    </span>
                    <span
                      class="text-xs font-semibold text-[hsl(var(--miwarp-status-success))] leading-tight mb-1"
                      >{t("planConfirm_autoTitle")}</span
                    >
                    <span class="text-[10px] text-muted-foreground leading-snug"
                      >{t("planConfirm_autoDesc")}</span
                    >
                  </button>

                  <!-- Card 2: Bypass (fast) -->
                  <button
                    class="flex flex-col items-start rounded-xl border-2 border-[hsl(var(--miwarp-status-warning)/0.45)] bg-[hsl(var(--miwarp-status-warning)/0.07)] hover:bg-[hsl(var(--miwarp-status-warning)/0.15)] hover:border-[hsl(var(--miwarp-status-warning)/0.65)] transition-all disabled:opacity-50 p-2.5 text-left"
                    disabled={submitting}
                    onclick={() => {
                      submitting = true;
                      safeExitPlanBypass();
                    }}
                  >
                    <span
                      class="inline-flex items-center gap-1 rounded-full bg-[hsl(var(--miwarp-status-warning)/0.2)] px-1.5 py-0.5 mb-1.5"
                    >
                      <span
                        class="text-[9px] font-semibold uppercase tracking-wider text-[hsl(var(--miwarp-status-warning))]"
                        >{t("planConfirm_bypassBadge")}</span
                      >
                    </span>
                    <span
                      class="text-xs font-semibold text-[hsl(var(--miwarp-status-warning))] leading-tight mb-1"
                      >{t("planConfirm_bypassTitle")}</span
                    >
                    <span class="text-[10px] text-muted-foreground leading-snug"
                      >{t("planConfirm_bypassDesc")}</span
                    >
                  </button>

                  <!-- Card 3: Manual approve (safe) -->
                  <button
                    class="flex flex-col items-start rounded-xl border-2 border-border bg-muted/20 hover:bg-muted/40 hover:border-foreground/30 transition-all disabled:opacity-50 p-2.5 text-left"
                    disabled={submitting}
                    onclick={() => {
                      submitting = true;
                      safePermissionRespond(
                        tool.permission_request_id!,
                        "allow",
                        undefined,
                        tool.input,
                      );
                    }}
                  >
                    <span
                      class="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 mb-1.5"
                    >
                      <span
                        class="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground"
                        >{t("planConfirm_manualBadge")}</span
                      >
                    </span>
                    <span class="text-xs font-semibold text-foreground leading-tight mb-1"
                      >{t("planConfirm_manualTitle")}</span
                    >
                    <span class="text-[10px] text-muted-foreground leading-snug"
                      >{t("planConfirm_manualDesc")}</span
                    >
                  </button>
                </div>

                <!-- Continue planning input -->
                <div class="flex gap-2 items-end">
                  <textarea
                    bind:value={planFeedback}
                    placeholder={t("planConfirm_continuePlaceholder")}
                    rows="1"
                    class="flex-1 rounded-lg border border-border bg-transparent px-3 py-2 text-xs placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring resize-none overflow-hidden"
                    oninput={(e) => {
                      const el = e.currentTarget;
                      el.style.height = "auto";
                      el.style.height = Math.min(el.scrollHeight, 120) + "px";
                    }}
                    onkeydown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey && !submitting) {
                        e.preventDefault();
                        submitting = true;
                        const msg = planFeedback.trim() || undefined;
                        safePermissionRespond(
                          tool.permission_request_id!,
                          "deny",
                          undefined,
                          undefined,
                          msg,
                        );
                      }
                    }}
                  ></textarea>
                  <button
                    class="shrink-0 rounded-lg border border-[hsl(var(--miwarp-accent-primary)/0.3)] bg-[hsl(var(--miwarp-accent-primary)/0.08)] hover:bg-[hsl(var(--miwarp-accent-primary)/0.16)] px-3 py-2 text-xs font-medium text-[hsl(var(--miwarp-accent-primary))] transition-all disabled:opacity-50"
                    disabled={submitting}
                    onclick={() => {
                      submitting = true;
                      const msg = planFeedback.trim() || undefined;
                      safePermissionRespond(
                        tool.permission_request_id!,
                        "deny",
                        undefined,
                        undefined,
                        msg,
                      );
                    }}
                  >
                    {t("planConfirm_continueButton")}
                  </button>
                </div>
              {/if}
            {/if}
          </div>
        {:else if showPermissionInPanel && tool.status === "permission_prompt" && tool.permission_request_id && tool.tool_name !== "AskUserQuestion" && tool.tool_name !== "ExitPlanMode"}
          <!-- Permission handled by floating panel — show lightweight placeholder -->
          <div class="flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground/60">
            <div
              class="h-2 w-2 rounded-full border border-[hsl(var(--miwarp-status-warning)/0.4)] border-t-[hsl(var(--miwarp-status-warning))] animate-spin"
            ></div>
            <span>{t("inline_permissionPending")}</span>
          </div>
        {:else if tool.status === "permission_prompt" && tool.permission_request_id}
          <!-- Inline permission prompt (--permission-prompt-tool stdio): amber card with Allow/Deny -->
          <div
            class="glass-card rounded-lg border border-[hsl(var(--miwarp-status-warning)/0.3)] bg-[hsl(var(--miwarp-status-warning)/0.05)] px-4 py-3"
          >
            <div class="flex items-center gap-2 mb-2">
              <div class="flex h-5 w-5 shrink-0 items-center justify-center rounded {style.bg}">
                <svg
                  class="h-3 w-3 {style.text}"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"><path d={style.icon} /></svg
                >
              </div>
              <span class="text-xs font-medium text-foreground"
                >{t("inline_permissionRequired")}</span
              >
              <PhaseIndicator phase={currentPhase} elapsed={tool.elapsed_time_seconds} />
              <div class="h-3 w-3 shrink-0 ml-auto">
                <div
                  class="h-2.5 w-2.5 rounded-full border-2 border-border border-t-[hsl(var(--miwarp-status-warning))] animate-spin"
                ></div>
              </div>
            </div>
            <p class="text-sm text-foreground mb-1">
              {t("inline_claudeWantsToUse")} <strong>{tool.tool_name}</strong>
            </p>
            {#if detail}
              <p
                class="text-xs text-muted-foreground mb-2 truncate"
                style:direction={isPathLikeDetail ? "rtl" : undefined}
                style:text-align={isPathLikeDetail ? "left" : undefined}
              >
                {#if isPathLikeDetail}<bdi>{detail}</bdi>{:else}{detail}{/if}
              </p>
            {/if}
            {#if onPermissionRespond}
              <div class="flex gap-2">
                <button
                  class="rounded-md bg-[hsl(var(--miwarp-status-success))] px-4 py-1.5 text-xs font-medium text-white hover:bg-[hsl(var(--miwarp-status-success)/0.85)] transition-all disabled:opacity-50"
                  disabled={submitting}
                  onclick={() => {
                    submitting = true;
                    safePermissionRespond(
                      tool.permission_request_id!,
                      "allow",
                      undefined,
                      tool.input,
                    );
                  }}>{t("common_allow")}</button
                >
                <button
                  class="rounded-md border border-border px-4 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-all disabled:opacity-50"
                  disabled={submitting}
                  onclick={() => {
                    submitting = true;
                    safePermissionRespond(tool.permission_request_id!, "deny");
                  }}>{t("common_deny")}</button
                >
                <button
                  class="rounded-md border border-[hsl(var(--miwarp-status-error)/0.3)] bg-[hsl(var(--miwarp-status-error)/0.1)] px-3 py-1.5 text-xs font-medium text-[hsl(var(--miwarp-status-error))] hover:bg-[hsl(var(--miwarp-status-error)/0.2)] transition-all disabled:opacity-50"
                  disabled={submitting}
                  onclick={() => {
                    submitting = true;
                    safePermissionRespond(
                      tool.permission_request_id!,
                      "deny",
                      undefined,
                      undefined,
                      undefined,
                      true,
                    );
                  }}>{t("common_denyAndStop")}</button
                >
              </div>
              {#if tool.suggestions && tool.suggestions.length > 0}
                <div
                  class="flex flex-wrap gap-2 mt-2 pt-2 border-t border-[hsl(var(--miwarp-status-warning)/0.2)]"
                >
                  {#each tool.suggestions as suggestion}
                    {@const label = formatSuggestionLabel(suggestion)}
                    <button
                      class="rounded-md border border-[hsl(var(--miwarp-status-info)/0.3)] bg-[hsl(var(--miwarp-status-info)/0.05)] px-3 py-1.5 text-xs font-medium text-[hsl(var(--miwarp-status-info))] hover:bg-[hsl(var(--miwarp-status-info)/0.1)] transition-all disabled:opacity-50"
                      disabled={submitting}
                      onclick={() => {
                        submitting = true;
                        safePermissionRespond(
                          tool.permission_request_id!,
                          "allow",
                          [suggestion],
                          tool.input,
                        );
                      }}>{label}</button
                    >
                  {/each}
                </div>
              {/if}
            {/if}
          </div>
        {/if}
      </div>
    {:else}
      <!-- Level 1 & 2: full-width, no card border -->
      <!-- Clickable header row -->
      <div
        role="button"
        tabindex="0"
        class="relative flex items-center gap-2 py-1 cursor-pointer rounded
        hover:bg-muted/30 transition-colors group
        {statusKind === 'done' && renderLevel === 1 ? 'opacity-60 hover:opacity-100' : ''}
        {expanded ? 'sticky top-0 z-10 bg-background/95 backdrop-blur-sm' : ''}"
        onclick={handleToggle}
        onkeydown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleToggle();
          }
        }}
      >
        <!-- Tool icon -->
        <div class="flex h-5 w-5 shrink-0 items-center justify-center rounded {style.bg}">
          <svg
            class="h-3 w-3 {style.text}"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d={style.icon} />
          </svg>
        </div>

        <!-- Tool name + detail + summary -->
        <div class="flex-1 min-w-0 flex flex-col justify-center gap-0.5">
          {#if taskMeta}
            <!-- Task tool: show agent type + model badge -->
            <div class="flex items-center gap-1.5">
              <span class="text-xs font-medium text-foreground">{taskMeta.subagentType}</span>
              {#if taskMeta.model}
                <span
                  class="text-[10px] px-1 py-0.5 rounded bg-[hsl(var(--miwarp-status-info)/0.15)] text-[hsl(var(--miwarp-status-info))] font-medium"
                  >{taskMeta.model}</span
                >
              {/if}
              {#if taskMeta.description}
                <span class="text-xs text-muted-foreground truncate">{taskMeta.description}</span>
              {/if}
              {#if subToolCount > 0}
                <span class="text-[10px] px-1 py-0.5 rounded bg-muted text-muted-foreground">
                  {#if tool.status === "running"}
                    {subToolCompleted}/{subToolCount} tools
                  {:else}
                    {t("inline_toolCount", { count: String(subToolCount) })}
                  {/if}
                </span>
              {/if}
            </div>
          {:else}
            <!-- Level 1 (minimal): show summary as primary text -->
            {#if renderLevel === 1}
              <span class="text-xs text-muted-foreground truncate">{toolSummary}</span>
            {:else}
              <!-- Level 2 (normal): tool name + summary subtitle -->
              <div class="flex items-center gap-1.5">
                <span class="text-xs font-medium text-foreground">{tool.tool_name}</span>
                {#if displayDetail && !bashPreview}
                  <span
                    class="text-xs text-muted-foreground truncate"
                    style:direction={isPathLikeDetail ? "rtl" : undefined}
                    style:text-align={isPathLikeDetail ? "left" : undefined}
                    >{#if isPathLikeDetail}<bdi>{displayDetail}</bdi
                      >{:else}{displayDetail}{/if}</span
                  >
                {:else if bashDescription}
                  <span class="text-xs text-muted-foreground truncate">{bashDescription}</span>
                {:else if bashPreview}
                  <span class="text-xs text-muted-foreground font-mono truncate"
                    >$ {bashPreview}</span
                  >
                {:else if tool.status === "running" && !isAgentLike}
                  <span class="text-xs text-muted-foreground italic">{t("inline_starting")}</span>
                {/if}
                {#if subToolCount > 0}
                  <span class="text-[10px] px-1 py-0.5 rounded bg-muted text-muted-foreground">
                    {#if tool.status === "running"}
                      {subToolCompleted}/{subToolCount} tools
                    {:else}
                      {t("inline_toolCount", { count: String(subToolCount) })}
                    {/if}
                  </span>
                {/if}
              </div>
              <span class="text-xs text-muted-foreground truncate">{toolSummary}</span>
            {/if}
          {/if}
        </div>

        <!-- Phase indicator: compact dot for Level 2 only -->
        {#if renderLevel === 2}
          <PhaseIndicator phase={currentPhase} compact elapsed={tool.elapsed_time_seconds} />
        {/if}

        <!-- Duration + output size -->
        <div class="flex items-center gap-1.5 shrink-0">
          {#if outputSizeLabel}
            <span class="text-[10px] text-muted-foreground">{outputSizeLabel}</span>
          {/if}
          {#if durationLabel}
            <span class="text-[10px] text-muted-foreground/60">{durationLabel}</span>
          {:else if elapsedLabel}
            <span class="text-[10px] text-muted-foreground/60">{elapsedLabel}</span>
          {/if}
        </div>

        <!-- Status icon -->
        <StatusIcon
          status={statusKind === "done" ? "done" : statusKind === "error" ? "error" : "running"}
          size="md"
        />

        <!-- Expand chevron: absolute to not affect right-edge alignment of status icon -->
        <svg
          class="absolute -right-5 top-1/2 -translate-y-1/2 h-3 w-3 transition-all
          {renderLevel === 1 ? 'opacity-0 group-hover:opacity-40' : 'text-muted-foreground/40'}
          {(hasSubTimeline ? showSubTimeline : expanded) ? 'rotate-180' : ''}"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </div>

      <!-- Tool summary (from tool_use_summary) -->
      {#if tool.summary}
        <div class="ml-7 text-xs text-muted-foreground italic truncate">{tool.summary}</div>
      {/if}

      <!-- Task notification status (background task) -->
      {#if taskNotification}
        <div class="ml-7 mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
          {#if taskNotification.status === "running" || taskNotification.status === "pending"}
            <div
              class="h-2 w-2 rounded-full border border-border border-t-muted-foreground animate-spin shrink-0"
            ></div>
            <span>{taskNotification.summary || taskNotification.message}</span>
          {:else if taskNotification.status === "completed" || taskNotification.status === "done"}
            <svg
              class="h-2.5 w-2.5 text-[hsl(var(--miwarp-status-success))] shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg
            >
            <span>{taskNotification.summary || taskNotification.message}</span>
          {:else if taskNotification.status === "error" || taskNotification.status === "failed"}
            <svg
              class="h-2.5 w-2.5 text-destructive shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              ><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg
            >
            <span>{taskNotification.summary || taskNotification.message}</span>
          {:else}
            <span
              >{taskNotification.status}: {taskNotification.summary ||
                taskNotification.message}</span
            >
          {/if}
          {#if taskNotification.output_file}
            <button
              class="font-mono text-muted-foreground/60 truncate max-w-[150px] hover:text-foreground transition-colors underline decoration-dotted"
              title={t("inlineTool_copyPath", { path: taskNotification.output_file })}
              onclick={(e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(taskNotification!.output_file!);
              }}
            >
              {pathFileName(taskNotification.output_file)}
            </button>
          {/if}
        </div>
      {/if}

      <!-- Expanded content area with accent left border -->
      {#if expanded}
        <div class="ml-2.5 pl-2 border-l-2 {renderLevel === 2 ? style.border : 'border-border/20'}">
          {#if isTruncated && !lazyResult}
            {#if lazyLoading}
              <div class="px-4 py-3 text-center text-xs text-muted-foreground animate-pulse">
                Loading tool details...
              </div>
            {:else if lazyFailed}
              <div class="px-4 py-3 text-center text-xs text-muted-foreground">
                Failed to load details
                <button class="ml-2 underline hover:text-foreground" onclick={retryLazyLoad}
                  >{t("inlineTool_retry")}</button
                >
              </div>
            {:else}
              <!-- Auto-expanded but not yet fetched (truncated) -->
              <button
                class="w-full text-xs text-muted-foreground/60 hover:text-muted-foreground py-2 transition-colors"
                onclick={() => {
                  userExpanded = true;
                }}
              >
                {t("inline_loadDetails")}
              </button>
            {/if}
          {:else}
            <ToolDetailView
              tool={enrichedTool}
              {isInputStreaming}
              {onPreviewFile}
              expertPayload={shouldShowFullToolPayload(processVisibility)}
            />
          {/if}
        </div>
      {/if}
    {/if}
    <!-- ExitPlanMode success: inline plan content below compact card -->
    {#if planContent && tool.tool_name === "ExitPlanMode" && tool.status === "success"}
      <div
        class="mt-2 rounded-lg border border-[hsl(var(--miwarp-accent-primary)/0.15)] bg-background/50 overflow-hidden"
      >
        <div
          class="flex items-center gap-1.5 px-3 py-1.5 border-b border-[hsl(var(--miwarp-accent-primary)/0.1)] bg-[hsl(var(--miwarp-accent-primary)/0.05)]"
        >
          <svg
            class="h-3 w-3 text-[hsl(var(--miwarp-accent-primary))]"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          <span class="text-[11px] font-medium text-[hsl(var(--miwarp-accent-primary))]"
            >{planContent.fileName}</span
          >
        </div>
        <div class="px-4 py-3 max-h-96 overflow-y-auto prose-chat">
          <MarkdownContent text={planContent.content} />
        </div>
      </div>
    {/if}
    <!-- Subagent subTimeline: nested entries from child agents -->
    {#if showSubTimeline}
      <div class="mt-2 ml-4 pl-3 border-l-2 border-[hsl(var(--miwarp-status-info)/0.3)] space-y-1">
        {#each subTimeline as subEntry (subEntry.id)}
          {#if subEntry.kind === "assistant"}
            <div class="text-sm text-muted-foreground py-1">
              {#if subEntry.thinkingText && processVisibility !== "output"}
                <details
                  class="mb-1 rounded-md border border-[hsl(var(--miwarp-status-info)/0.12)] bg-[hsl(var(--miwarp-status-info)/0.04)] overflow-hidden"
                >
                  <summary
                    class="flex cursor-pointer list-none items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-[hsl(var(--miwarp-status-info)/0.9)] hover:bg-[hsl(var(--miwarp-status-info)/0.08)] [&::-webkit-details-marker]:hidden"
                  >
                    <svg
                      class="h-3 w-3 shrink-0 opacity-60"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <path d="M12 2a8 8 0 0 1 8 8c0 5-8 13-8 13S4 15 4 10a8 8 0 0 1 8-8z" />
                      <circle cx="12" cy="10" r="3" />
                    </svg>
                    {t("chat_thoughtProcess")}
                  </summary>
                  <div
                    class="max-h-[min(40vh,18rem)] min-h-0 overflow-y-auto overscroll-y-contain border-t border-[hsl(var(--miwarp-text-secondary)/0.15)] px-2 py-1.5"
                  >
                    <pre
                      class="text-xs font-mono whitespace-pre-wrap break-words text-[hsl(var(--miwarp-text-secondary))] italic leading-relaxed">{subEntry.thinkingText.trimEnd()}</pre>
                  </div>
                </details>
              {/if}
              <MarkdownContent
                text={subEntry.content}
                streaming={subEntry.id?.startsWith("__sub_stream_") ?? false}
              />
            </div>
          {:else if subEntry.kind === "tool"}
            <svelte:self
              tool={subEntry.tool}
              subTimeline={subEntry.subTimeline}
              {runId}
              {fetchToolResult}
              {onAnswer}
              {onApprove}
              {onPermissionRespond}
              {taskNotifications}
              {showPermissionInPanel}
              {onPreviewFile}
              {processVisibility}
            />
          {/if}
        {/each}
      </div>
    {/if}
  </div>
{/if}
