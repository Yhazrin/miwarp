<script lang="ts">
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";
  import { workbenchStore } from "$lib/workbench/workbench-store.svelte";
  import { sessionStore } from "$lib/stores";
  import type { TimelineEntry } from "$lib/types";
  import type { TaskNotificationItem } from "$lib/stores/session-store.svelte";
  import { attentionQueueStore } from "$lib/stores/attention-queue-store.svelte";
  import type { AttentionItem } from "$lib/types/attention-queue";
  import { t } from "$lib/i18n/index.svelte";
  import { EVT_WORKBENCH_STAGE_PROMPT, EVT_FOCUS_PENDING_TOOL } from "$lib/utils/bus-events";
  import { relativeTime, truncate } from "$lib/utils/format";
  import Icon from "$lib/components/Icon.svelte";
  import StatusBadge from "$lib/components/StatusBadge.svelte";
  import type { LucideIconName } from "$lib/lucide-icon";

  type TakeoverStep = {
    icon: LucideIconName;
    label: string;
    description: string;
    prompt: string;
    complete: boolean;
    tone: "default" | "attention" | "complete";
  };

  const store = sessionStore;

  const project = $derived(workbenchStore.selectedProject);
  const activeRunId = $derived(workbenchStore.selectedActiveRunId);
  const activeRun = $derived(
    store.run?.id === activeRunId
      ? store.run
      : (workbenchStore.allRuns.find((run) => run.id === activeRunId) ?? null),
  );
  const hasProjectDeskContext = $derived(activeRun?.run_surface === "project_desk");
  const ownsCurrentRun = $derived(!!activeRunId && store.run?.id === activeRunId);
  /** Single-pass timeline traversal. The previous implementation walked
   *  store.timeline four times (pending tools, failed tools, then later via
   *  `pendingTimelineItems` / `failedTools` selectors). One recursive pass
   *  collects both buckets at the same time, with cheap per-node arithmetic
   *  instead of repeated `subTimeline` descent. */
  const timelineBuckets = $derived.by(() => {
    const empty = {
      pending: [] as Array<Extract<TimelineEntry, { kind: "tool" }>>,
      failed: [] as Array<Extract<TimelineEntry, { kind: "tool" }>>,
    };
    if (!ownsCurrentRun) return empty;
    const pending: Array<Extract<TimelineEntry, { kind: "tool" }>> = [];
    const failed: Array<Extract<TimelineEntry, { kind: "tool" }>> = [];
    const walk = (entries: TimelineEntry[]): void => {
      for (const entry of entries) {
        if (entry.kind === "tool") {
          const status = entry.tool.status;
          const name = entry.tool.tool_name;
          if (
            // P1-7: gate the AskUserQuestion name match on a pending status
            // so a *successfully answered* question no longer surfaces in
            // the pending list. The previous guard matched by name alone,
            // which kept answered questions showing until the next reload.
            status === "permission_prompt" ||
            status === "ask_pending" ||
            status === "running" ||
            (name === "AskUserQuestion" && status !== "success")
          ) {
            pending.push(entry);
          }
          if (status === "error" || status === "denied" || status === "permission_denied") {
            failed.push(entry);
          }
          // subTimeline is only defined on `kind: "tool"` entries — narrowing
          // here is what allows us to walk without an `as` cast.
          if (entry.subTimeline && entry.subTimeline.length > 0) {
            walk(entry.subTimeline);
          }
        }
      }
    };
    walk(store.timeline);
    return {
      pending: pending.slice(0, 4),
      failed: failed.slice(-4).reverse(),
    };
  });
  const pendingTimelineItems = $derived(timelineBuckets.pending);
  const failedTools = $derived(timelineBuckets.failed);

  /**
   * P1-6: attention items for the active project, surfaced in the
   * "Pending work" section alongside timeline-derived pending tools.
   * The attention queue is the canonical source for "agent needs user
   * input" — Rust's RunStatus enum doesn't carry the wait states the
   * UI used to fake via `run.status === "waiting_input"`.
   */
  const attentionItems = $derived(
    activeRunId
      ? (attentionQueueStore.snapshot?.items ?? []).filter(
          (item: AttentionItem) =>
            item.run_id === activeRunId &&
            (item.status === "open" || item.status === "acknowledged"),
        )
      : ([] as AttentionItem[]),
  );
  /**
   * P1-8: project-level attention — covers every run for the selected
   * project, not just the one currently loaded into SessionStore. Used by
   * the takeover "Handoffs" step so a non-active run needing approval still
   * counts as a pending handoff.
   */
  const projectAttentionItems = $derived(
    project ? workbenchStore.attentionItemsForActiveProject() : ([] as AttentionItem[]),
  );
  const projectAttentionCount = $derived(
    projectAttentionItems.filter((item) => item.status === "open" || item.status === "acknowledged")
      .length,
  );
  /**
   * P1-8: live runs in this project (running / pending / spawning). The
   * takeover "Context" step uses this to drive the project-desk surface
   * recommendation.
   */
  const liveProjectRunCount = $derived(
    project
      ? workbenchStore.selectedProjectRuns.filter((run) =>
          ["running", "pending", "spawning", "waiting_input", "waiting_approval"].includes(
            run.status,
          ),
        ).length
      : 0,
  );
  /** Combined: attention items first (canonical), then timeline-derived
   *  permission_prompt / ask_pending entries that haven't been queued yet.
   *  Deduped by tool_use_id / item id. */
  const pendingWork = $derived.by(() => {
    const seen = new Set<string>();
    const out: Array<
      | { kind: "attention"; item: AttentionItem }
      | { kind: "timeline"; entry: Extract<TimelineEntry, { kind: "tool" }> }
    > = [];
    for (const item of attentionItems) {
      const key = item.stable_key || item.id;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ kind: "attention", item });
    }
    for (const entry of pendingTimelineItems) {
      const key = entry.tool.tool_use_id;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ kind: "timeline", entry });
    }
    return out;
  });
  const recentFiles = $derived.by(() => {
    if (!ownsCurrentRun) return [] as Array<{ path: string; name: string }>;
    return store.persistedFiles
      .filter((file): file is string => typeof file === "string" && file.length > 0)
      .slice(-6)
      .reverse()
      .map((path) => ({ path, name: fileName(path) }));
  });
  const taskItems = $derived.by(() => {
    if (!ownsCurrentRun) return [] as TaskNotificationItem[];
    return Array.from(store.taskNotifications.values())
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, 5);
  });
  const recentSessions = $derived(workbenchStore.selectedSessions.slice(0, 6));
  const takeoverSteps: TakeoverStep[] = $derived(
    project
      ? [
          {
            icon: "layout",
            label: t("workbench_takeoverContext"),
            description: t("workbench_takeoverContextDescription"),
            prompt: t("workbench_modeOrientPrompt", { project: project.label }),
            complete: hasProjectDeskContext,
            tone: hasProjectDeskContext ? "complete" : "attention",
          },
          {
            icon: "clock",
            label: t("workbench_takeoverHistory"),
            description: t("workbench_takeoverHistoryDescription"),
            prompt: t("workbench_briefingDeskRunsPrompt", { project: project.label }),
            complete: project.sessionCount > 0,
            tone: project.sessionCount > 0 ? "complete" : "default",
          },
          {
            icon: "triangle-alert",
            label: t("workbench_takeoverHandoffs"),
            description: t("workbench_takeoverHandoffsDescription"),
            prompt: t("workbench_briefingNeedsYouPrompt", { project: project.label }),
            // P1-8: project-level attention count, not just the active run's
            // timeline. A non-active run needing approval still counts as a
            // pending handoff.
            complete: projectAttentionCount === 0,
            tone: projectAttentionCount > 0 ? "attention" : "complete",
          },
          {
            icon: "check-square",
            label: t("workbench_takeoverVerification"),
            description: t("workbench_takeoverVerificationDescription"),
            prompt: t("workbench_modeVerifyPrompt", { project: project.label }),
            complete: failedTools.length === 0,
            tone: failedTools.length > 0 ? "attention" : "complete",
          },
        ]
      : [],
  );

  function openActiveRun(): void {
    if (activeRunId) {
      void goto(`/chat?run=${encodeURIComponent(activeRunId)}`);
    } else if (project?.cwd) {
      void goto(`/chat?new=1&folder=${encodeURIComponent(project.cwd)}`);
    }
  }

  function fileName(path: string): string {
    return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
  }

  function taskTone(status: string): string {
    if (status === "completed") return "text-miwarp-status-success";
    if (status === "failed" || status === "error") return "text-miwarp-status-error";
    return "text-miwarp-status-info";
  }

  // P2-13: real scroll + flash highlight when the workbench's "view
  // pending" button (in WorkbenchProjectChat) dispatches
  // EVT_FOCUS_PENDING_TOOL. We resolve the matching `data-tool-use-id`
  // attribute on the pending-work list and bring it into view, then
  // briefly add a highlight ring so the user can see exactly which
  // entry we focused.
  let highlightedKey = $state<string | null>(null);
  let highlightTimer: ReturnType<typeof setTimeout> | null = null;
  function handleFocusPendingTool(event: Event): void {
    const detail = (event as CustomEvent<{ toolUseId?: string }>).detail;
    const toolUseId = detail?.toolUseId;
    if (!toolUseId) return;
    const root = document.querySelector("[data-workbench-control-panel]");
    if (!root) return;
    const card = root.querySelector(`[data-tool-use-id="${CSS.escape(toolUseId)}"]`);
    if (card instanceof HTMLElement) {
      card.scrollIntoView({ behavior: "smooth", block: "center" });
      highlightedKey = toolUseId;
      if (highlightTimer) clearTimeout(highlightTimer);
      highlightTimer = setTimeout(() => {
        highlightedKey = null;
      }, 1800);
    }
  }
  onMount(() => {
    window.addEventListener(EVT_FOCUS_PENDING_TOOL, handleFocusPendingTool);
    return () => {
      window.removeEventListener(EVT_FOCUS_PENDING_TOOL, handleFocusPendingTool);
      if (highlightTimer) clearTimeout(highlightTimer);
    };
  });

  function stagePrompt(prompt: string): void {
    window.dispatchEvent(
      new CustomEvent(EVT_WORKBENCH_STAGE_PROMPT, {
        detail: { prompt },
      }),
    );
  }

  /**
   * Estimate the size of the injected project-desk system prompt.
   * MiWarp injects ~480 chars of scaffold + the cwd, plus a short descriptor.
   * Without a dedicated API, this deterministic estimate is enough to give
   * users a feel for how much context their session starts with.
   */
  function estimateSystemPromptTokens(cwd: string): number {
    const baseChars = 480 + (cwd?.length ?? 0) + (project?.label?.length ?? 0);
    // Conservative ~3 chars per token for English-leaning system prompts.
    return Math.max(120, Math.round(baseChars / 3));
  }

  /**
   * P2-14 / P2-16: prefer the real `project_desk_context` snapshot stamped
   * on the run meta by `apply_project_desk_context` (Rust). When the
   * stamp is missing (older runs, chat-surface), fall back to the
   * heuristic estimate so the UI still shows a number. Returns
   * `null` when the active run has no project-desk context at all.
   */
  const projectDeskContextTokens = $derived.by(() => {
    if (!hasProjectDeskContext || !project) return 0;
    const stamp = activeRun?.project_desk_context;
    if (stamp?.estimatedTokens != null && stamp.estimatedTokens > 0) {
      return stamp.estimatedTokens;
    }
    if (stamp?.contextCharCount != null && stamp.contextCharCount > 0) {
      return Math.max(120, Math.round(stamp.contextCharCount / 3));
    }
    return estimateSystemPromptTokens(project.cwd);
  });
  const projectDeskContextSnapshotAt = $derived(
    hasProjectDeskContext ? (activeRun?.project_desk_context?.snapshotGeneratedAt ?? null) : null,
  );
</script>

<aside
  class="wb-frame flex min-h-0 w-full flex-col overflow-hidden xl:w-[320px]"
  aria-label={t("workbench_controlPanel")}
  data-workbench-control-panel
>
  <header class="shrink-0 border-b border-border/40 px-4 py-2.5">
    <!--
      v1.0.10 redesign: control panel header now only carries the section
      label and the open-active-run button. Project name + cwd + status dot
      + status badge are already in the hero (the single source of truth);
      repeating them here made the right column feel like a duplicate.
    -->
    <div class="flex items-center justify-between gap-2">
      <p class="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        {t("workbench_controlPanel")}
      </p>
      <div class="flex items-center gap-1.5">
        {#if activeRun}
          <StatusBadge status={activeRun.status} shortLabel={true} />
        {/if}
        <button
          type="button"
          class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border/50 bg-background/50 text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          onclick={openActiveRun}
          aria-label={t("workbench_openActiveRun")}
          title={t("workbench_openActiveRun")}
        >
          <Icon name="external-link" size="xs" />
        </button>
      </div>
    </div>
  </header>

  <div class="min-h-0 flex-1 overflow-y-auto px-4 py-3">
    {#if project}
      <!--
        P1-8: project projection header — quick numeric summary of the
        selected project's runs + attention queue + (when bound) the
        active run's task notifications. The cards are intentionally tiny
        so they don't compete with the takeover checklist below.
      -->
      <section
        class="mb-3 grid grid-cols-3 gap-2 text-[10px]"
        data-testid="workbench-project-projection"
      >
        <div
          class="rounded-xl border border-border/40 bg-muted/30 px-2 py-1.5 transition-colors duration-150 ease-out"
        >
          <p class="text-[9px] uppercase tracking-wider text-muted-foreground">
            {t("workbench_projectionRuns")}
          </p>
          <p class="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
            {project.sessionCount}
          </p>
        </div>
        <div
          class="rounded-xl border border-border/40 bg-muted/30 px-2 py-1.5 transition-colors duration-150 ease-out"
        >
          <p class="text-[9px] uppercase tracking-wider text-muted-foreground">
            {t("workbench_projectionLive")}
          </p>
          <p class="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
            {liveProjectRunCount}
          </p>
        </div>
        <div
          class="rounded-xl border px-2 py-1.5 {projectAttentionCount > 0
            ? 'border-[hsl(var(--miwarp-status-warning)/0.3)] bg-[hsl(var(--miwarp-status-warning)/0.08)]'
            : 'border-border/40 bg-muted/30'}"
        >
          <p class="text-[9px] uppercase tracking-wider text-muted-foreground">
            {t("workbench_projectionAttention")}
          </p>
          <p class="mt-0.5 text-sm font-semibold text-foreground">{projectAttentionCount}</p>
        </div>
      </section>
      <section>
        <div class="mb-2 flex items-center justify-between gap-2">
          <h3 class="text-xs font-semibold text-foreground">{t("workbench_takeoverChecklist")}</h3>
          <span class="text-[10px] text-muted-foreground">{t("workbench_takeoverHint")}</span>
        </div>
        <div class="space-y-1.5">
          {#each takeoverSteps as step (step.label)}
            <button
              type="button"
              class="w-full rounded-2xl border px-3 py-2.5 text-left transition-[background-color,border-color,box-shadow] duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 {step.tone ===
              'attention'
                ? 'border-[hsl(var(--miwarp-status-warning)/0.3)] bg-[hsl(var(--miwarp-status-warning)/0.08)] hover:bg-[hsl(var(--miwarp-status-warning)/0.12)]'
                : step.tone === 'complete'
                  ? 'border-[hsl(var(--miwarp-status-success)/0.22)] bg-[hsl(var(--miwarp-status-success)/0.06)] hover:bg-[hsl(var(--miwarp-status-success)/0.1)]'
                  : 'border-border/35 bg-background/35 hover:border-primary/30 hover:bg-primary/5'}"
              onclick={() => stagePrompt(step.prompt)}
              aria-label={t("workbench_stagePromptAria", {
                label: step.label,
                value: step.description,
              })}
            >
              <div class="flex items-start gap-2.5">
                <span
                  class="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-xl border border-border/40 bg-background/45 text-muted-foreground"
                >
                  <Icon name={step.complete ? "check" : step.icon} size="sm" />
                </span>
                <span class="min-w-0">
                  <span class="block text-xs font-semibold text-foreground">{step.label}</span>
                  <span
                    class="mt-0.5 line-clamp-2 block text-[11px] leading-4 text-muted-foreground"
                  >
                    {step.description}
                  </span>
                </span>
              </div>
            </button>
          {/each}
        </div>
      </section>

      <section class="mt-5">
        <h3 class="mb-2 text-xs font-semibold text-foreground">{t("workbench_outputFiles")}</h3>
        {#if recentFiles.length > 0}
          <div class="space-y-1.5">
            {#each recentFiles as file (file.path)}
              <button
                type="button"
                class="w-full rounded-2xl border border-border/35 bg-background/35 px-3 py-2 text-left transition-[background-color,border-color] duration-150 ease-out hover:border-primary/30 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                onclick={openActiveRun}
                title={file.path}
                aria-label={t("workbench_openSessionAria", { title: file.name })}
              >
                <div class="flex items-center gap-2">
                  <Icon name="file-text" size="sm" class="shrink-0 text-muted-foreground" />
                  <p class="truncate text-xs font-medium text-foreground">{file.name}</p>
                </div>
                <p class="mt-1 truncate font-mono text-[10px] text-muted-foreground">
                  {file.path}
                </p>
              </button>
            {/each}
          </div>
        {:else}
          <div class="wb-empty">
            {t("workbench_noOutputFiles")}
          </div>
        {/if}
      </section>

      <section class="mt-5">
        <h3 class="mb-2 text-xs font-semibold text-foreground">{t("workbench_backgroundTasks")}</h3>
        {#if taskItems.length > 0}
          <div class="space-y-1.5">
            {#each taskItems as task (task.task_id)}
              <div class="rounded-2xl border border-border/35 bg-background/35 px-3 py-2">
                <div class="flex items-center justify-between gap-2">
                  <p class="truncate text-xs font-medium text-foreground">
                    {task.task_type || task.task_id}
                  </p>
                  <span class="shrink-0 text-[10px] font-medium {taskTone(task.status)}">
                    {task.status}
                  </span>
                </div>
                <p class="mt-1 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
                  {task.summary || task.message}
                </p>
              </div>
            {/each}
          </div>
        {:else}
          <div class="wb-empty">
            {t("workbench_noBackgroundTasks")}
          </div>
        {/if}
      </section>

      <section class="mt-5">
        <h3 class="mb-2 text-xs font-semibold text-foreground">{t("workbench_risks")}</h3>
        {#if failedTools.length > 0}
          <div class="space-y-1.5">
            {#each failedTools as item (item.id)}
              <button
                type="button"
                class="w-full rounded-2xl border border-[hsl(var(--miwarp-status-error)/0.28)] bg-[hsl(var(--miwarp-status-error)/0.08)] px-3 py-2 text-left transition-[background-color,border-color,box-shadow] duration-150 ease-out hover:bg-[hsl(var(--miwarp-status-error)/0.12)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--miwarp-status-error)/0.4)]"
                onclick={openActiveRun}
                aria-label={t("workbench_riskItemAria", {
                  tool: item.tool.tool_name,
                  status: item.tool.status,
                })}
              >
                <div class="flex items-center gap-2">
                  <Icon name="triangle-alert" size="sm" class="shrink-0 text-miwarp-status-error" />
                  <p class="truncate text-xs font-medium text-foreground">
                    {item.tool.tool_name}
                  </p>
                </div>
                <p class="mt-1 text-[11px] text-muted-foreground">
                  {item.tool.status}
                </p>
              </button>
            {/each}
          </div>
        {:else}
          <div class="wb-empty">
            {t("workbench_noRisks")}
          </div>
        {/if}
      </section>

      <section class="mt-5">
        <div class="mb-2 flex items-center justify-between gap-2">
          <h3 class="text-xs font-semibold text-foreground">{t("workbench_activeSession")}</h3>
        </div>
        {#if activeRun}
          <button
            type="button"
            class="w-full rounded-2xl border border-border/40 bg-background/45 px-3 py-2.5 text-left transition-[background-color,border-color] duration-150 ease-out hover:border-primary/30 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            onclick={openActiveRun}
            aria-label={t("workbench_openSessionAria", {
              title: activeRun.name || activeRun.prompt || activeRun.id,
            })}
          >
            <p class="truncate text-xs font-medium text-foreground">
              {activeRun.name || activeRun.prompt || activeRun.id}
            </p>
            <p class="mt-1 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
              {activeRun.last_message_preview || activeRun.prompt}
            </p>
            <p class="mt-2 text-[10px] text-muted-foreground">
              {t("workbench_lastActive", {
                time: relativeTime(activeRun.last_activity_at || activeRun.started_at),
              })}
            </p>
            <div
              class="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-medium {hasProjectDeskContext
                ? 'border-primary/25 bg-primary/10 text-primary'
                : 'border-border/40 bg-muted/35 text-muted-foreground'}"
            >
              <Icon
                name={hasProjectDeskContext ? "layout" : "message-square"}
                size="xs"
                class="shrink-0"
              />
              <span class="truncate">
                {hasProjectDeskContext
                  ? t("workbench_projectDeskContextEnabled")
                  : t("workbench_standardChatContext")}
              </span>
              {#if hasProjectDeskContext}
                <span class="ml-0.5 inline-flex items-center gap-1 text-[10px] text-primary/80">
                  <Icon name="sparkles" size="xs" />
                  ~{projectDeskContextTokens}
                </span>
              {/if}
            </div>
            {#if projectDeskContextSnapshotAt}
              <p
                class="mt-1 inline-flex items-center gap-1 text-[10px] text-muted-foreground"
                data-testid="workbench-snapshot-generated-at"
              >
                <Icon name="clock" size="xs" class="shrink-0" />
                {t("workbench_snapshotGeneratedAt", {
                  when: relativeTime(projectDeskContextSnapshotAt),
                })}
              </p>
            {/if}
          </button>
        {:else}
          <div
            class="rounded-2xl border border-dashed border-border/45 px-3 py-4 text-xs text-muted-foreground"
          >
            {t("workbench_noActiveSession")}
          </div>
        {/if}
      </section>

      <section class="mt-5">
        <h3 class="mb-2 text-xs font-semibold text-foreground">{t("workbench_pendingWork")}</h3>
        {#if pendingWork.length > 0}
          <div class="space-y-2">
            {#each pendingWork as entry (entry.kind === "attention" ? entry.item.id : entry.entry.id)}
              {#if entry.kind === "attention"}
                <div
                  class="rounded-2xl border border-[hsl(var(--miwarp-status-warning)/0.28)] bg-[hsl(var(--miwarp-status-warning)/0.08)] px-3 py-2 transition-shadow {highlightedKey ===
                  (entry.item.stable_key ?? entry.item.id)
                    ? 'ring-2 ring-[hsl(var(--miwarp-status-warning)/0.6)] shadow-lg'
                    : ''}"
                  data-testid="workbench-pending-attention"
                  data-tool-use-id={entry.item.stable_key ?? entry.item.id}
                >
                  <div class="flex items-center gap-2">
                    <Icon
                      name="triangle-alert"
                      size="sm"
                      class="shrink-0 text-miwarp-status-warning"
                    />
                    <p class="truncate text-xs font-medium text-foreground">
                      {entry.item.kind === "pending_approval"
                        ? t("workbench_pendingApproval")
                        : t("workbench_pendingQuestion")}
                    </p>
                  </div>
                  <p class="mt-1 text-[11px] text-muted-foreground">
                    {truncate(entry.item.summary ?? "", 120)}
                  </p>
                </div>
              {:else}
                <div
                  class="rounded-2xl border border-[hsl(var(--miwarp-status-warning)/0.28)] bg-[hsl(var(--miwarp-status-warning)/0.08)] px-3 py-2 transition-shadow duration-200 ease-out {highlightedKey ===
                  entry.entry.tool.tool_use_id
                    ? 'ring-2 ring-[hsl(var(--miwarp-status-warning)/0.6)] shadow-lg'
                    : ''}"
                  data-testid="workbench-pending-tool"
                  data-tool-use-id={entry.entry.tool.tool_use_id}
                >
                  <div class="flex items-center gap-2">
                    <Icon
                      name="triangle-alert"
                      size="sm"
                      class="shrink-0 text-miwarp-status-warning"
                    />
                    <p class="truncate text-xs font-medium text-foreground">
                      {entry.entry.tool.tool_name}
                    </p>
                  </div>
                  <p class="mt-1 text-[11px] text-muted-foreground">
                    {entry.entry.tool.status === "ask_pending"
                      ? t("workbench_pendingQuestion")
                      : t("workbench_pendingApproval")}
                  </p>
                </div>
              {/if}
            {/each}
          </div>
        {:else}
          <div class="wb-empty">
            {t("workbench_noPendingWork")}
          </div>
        {/if}
      </section>

      <section class="mt-5">
        <!--
          P2-15: "Recent activity" (按 last_activity_at 排序) — 前后端统一
          语义。旧 label "Recent sessions" 暗示静态历史，现在我们以
          `selectedProjectRuns` 排序后的活动时间为序，包含活跃与已结束。
        -->
        <h3 class="mb-2 text-xs font-semibold text-foreground">
          {t("workbench_recentSession")}
        </h3>
        {#if recentSessions.length > 0}
          <div class="space-y-1.5">
            {#each recentSessions as session (session.id)}
              <button
                type="button"
                class="w-full rounded-2xl border px-3 py-2 text-left transition-[background-color,border-color,box-shadow] duration-150 ease-out hover:border-border/45 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 {session.id ===
                activeRunId
                  ? 'border-primary/30 bg-primary/10'
                  : session.status === 'running' || session.status === 'pending'
                    ? 'border-[hsl(var(--miwarp-status-info)/0.28)] bg-[hsl(var(--miwarp-status-info)/0.06)]'
                    : session.status === 'waiting_approval' || session.status === 'waiting_input'
                      ? 'border-[hsl(var(--miwarp-status-warning)/0.3)] bg-[hsl(var(--miwarp-status-warning)/0.08)]'
                      : 'border-transparent'}"
                onclick={() => workbenchStore.setActiveRun(project.id, session.id)}
                aria-current={session.id === activeRunId ? "true" : undefined}
                aria-label={t("workbench_openSessionAria", { title: session.title })}
              >
                <div class="flex items-center justify-between gap-2">
                  <p class="truncate text-xs font-medium text-foreground">
                    {truncate(session.title, 40)}
                  </p>
                  <div class="flex shrink-0 items-center gap-1.5">
                    <span
                      class="rounded-full border px-1.5 py-0.5 text-[9px] font-medium {session.surface ===
                      'project_desk'
                        ? 'border-primary/25 bg-primary/10 text-primary'
                        : 'border-border/40 bg-muted/35 text-muted-foreground'}"
                    >
                      {session.surface === "project_desk"
                        ? t("workbench_projectDeskSession")
                        : t("workbench_chatSession")}
                    </span>
                    <StatusBadge status={session.status} compact={true} />
                  </div>
                </div>
                <p class="mt-1 line-clamp-1 text-[11px] text-muted-foreground">
                  {session.preview || session.agent}
                </p>
              </button>
            {/each}
          </div>
        {:else}
          <div class="wb-empty">
            {t("workbench_noSessionsYet")}
          </div>
        {/if}
      </section>
    {:else}
      <div
        class="flex h-full items-center justify-center text-center text-xs text-muted-foreground"
      >
        {t("workbench_selectProject")}
      </div>
    {/if}
  </div>
</aside>
