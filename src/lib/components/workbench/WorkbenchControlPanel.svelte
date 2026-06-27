<script lang="ts">
  import { goto } from "$app/navigation";
  import { workbenchStore } from "$lib/workbench/workbench-store.svelte";
  import { sessionStore } from "$lib/stores";
  import type { TimelineEntry } from "$lib/types";
  import type { TaskNotificationItem } from "$lib/stores/session-store.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import { EVT_WORKBENCH_STAGE_PROMPT } from "$lib/utils/bus-events";
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
            status === "permission_prompt" ||
            status === "ask_pending" ||
            name === "AskUserQuestion"
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
            complete: pendingTimelineItems.length === 0,
            tone: pendingTimelineItems.length > 0 ? "attention" : "complete",
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

  const projectDeskContextTokens = $derived(
    hasProjectDeskContext && project ? estimateSystemPromptTokens(project.cwd) : 0,
  );
</script>

<aside
  class="flex min-h-0 w-full flex-col overflow-hidden rounded-3xl border border-border/40 bg-card/35 shadow-sm backdrop-blur-xl xl:w-[320px]"
  aria-label={t("workbench_controlPanel")}
>
  <header class="shrink-0 border-b border-border/40 px-4 py-3">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <p class="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          {t("workbench_controlPanel")}
        </p>
        {#if project}
          <h2 class="mt-1 truncate text-sm font-semibold text-foreground">{project.label}</h2>
          <p
            class="mt-0.5 truncate font-mono text-[10px] text-muted-foreground"
            title={project.cwd}
          >
            {project.cwd}
          </p>
        {:else}
          <h2 class="mt-1 truncate text-sm font-semibold text-foreground">
            {t("workbench_selectProject")}
          </h2>
        {/if}
      </div>
      <div class="flex shrink-0 flex-col items-end gap-1.5">
        {#if project}
          <div class="flex items-center gap-1.5">
            <span
              class="h-2 w-2 rounded-full {project.status === 'active'
                ? 'bg-[hsl(var(--miwarp-status-info))]'
                : project.status === 'idle'
                  ? 'bg-[hsl(var(--miwarp-status-warning))]'
                  : 'bg-muted-foreground/40'}"
              aria-label={project.status}
            ></span>
            {#if activeRun}
              <StatusBadge status={activeRun.status} shortLabel={true} />
            {/if}
          </div>
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
      <section class="space-y-2">
        <div class="grid grid-cols-3 gap-2">
          <div class="rounded-2xl border border-border/40 bg-background/45 px-3 py-2">
            <p class="text-[10px] text-muted-foreground">{t("workbench_metricSessions")}</p>
            <p class="mt-1 text-lg font-semibold text-foreground">{project.sessionCount}</p>
          </div>
          <div class="rounded-2xl border border-border/40 bg-background/45 px-3 py-2">
            <p class="text-[10px] text-muted-foreground">{t("workbench_metricTools")}</p>
            <p class="mt-1 text-lg font-semibold text-foreground">{store.tools.length}</p>
          </div>
          <div class="rounded-2xl border border-border/40 bg-background/45 px-3 py-2">
            <p class="text-[10px] text-muted-foreground">{t("workbench_metricPending")}</p>
            <p class="mt-1 text-lg font-semibold text-foreground">{pendingTimelineItems.length}</p>
          </div>
        </div>

        <div class="rounded-2xl border border-border/40 bg-background/45 px-3 py-2.5">
          <p class="text-[10px] text-muted-foreground">{t("workbench_projectPath")}</p>
          <p class="mt-1 break-all font-mono text-[11px] leading-4 text-foreground/80">
            {project.cwd}
          </p>
        </div>
      </section>

      <section class="mt-5">
        <div class="mb-2 flex items-center justify-between gap-2">
          <h3 class="text-xs font-semibold text-foreground">{t("workbench_takeoverChecklist")}</h3>
          <span class="text-[10px] text-muted-foreground">{t("workbench_takeoverHint")}</span>
        </div>
        <div class="space-y-1.5">
          {#each takeoverSteps as step (step.label)}
            <button
              type="button"
              class="w-full rounded-2xl border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 {step.tone ===
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
        <div class="mb-2 flex items-center justify-between gap-2">
          <h3 class="text-xs font-semibold text-foreground">
            {t("workbench_projectDeskContextEnabled")}
          </h3>
          <span class="text-[10px] text-muted-foreground">
            {t("workbench_takeoverHint")}
          </span>
        </div>
        <div
          class="rounded-2xl border px-3 py-2.5 {hasProjectDeskContext
            ? 'border-primary/25 bg-primary/8'
            : 'border-border/40 bg-background/45'}"
        >
          <div class="flex items-start gap-2.5">
            <span
              class="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-xl border {hasProjectDeskContext
                ? 'border-primary/25 bg-primary/15 text-primary'
                : 'border-border/40 bg-background/45 text-muted-foreground'}"
            >
              <Icon name={hasProjectDeskContext ? "layout" : "message-square"} size="sm" />
            </span>
            <span class="min-w-0">
              <span class="block text-xs font-semibold text-foreground">
                {hasProjectDeskContext
                  ? t("workbench_projectDeskSystemContextEnabled")
                  : t("workbench_standardChatContext")}
              </span>
              <span class="mt-0.5 line-clamp-3 block text-[11px] leading-4 text-muted-foreground">
                {#if hasProjectDeskContext && project}
                  {t("workbench_projectDeskSystemContextHint", {
                    tokens: String(projectDeskContextTokens),
                  })}
                {:else}
                  {t("workbench_projectDeskSystemContextFallback")}
                {/if}
              </span>
              <div class="mt-2 flex flex-wrap items-center gap-1.5">
                <span
                  class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] {hasProjectDeskContext
                    ? 'border-primary/25 bg-primary/10 text-primary'
                    : 'border-border/40 bg-muted/35 text-muted-foreground'}"
                  title={project?.cwd ?? ""}
                >
                  <Icon name="folder-open" size="xs" />
                  <span class="truncate">{project?.cwd ?? ""}</span>
                </span>
                {#if hasProjectDeskContext}
                  <span
                    class="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/8 px-2 py-0.5 text-[10px] font-medium text-primary"
                  >
                    <Icon name="sparkles" size="xs" />
                    ~{projectDeskContextTokens} tokens
                  </span>
                {/if}
              </div>
            </span>
          </div>
        </div>
      </section>

      <section class="mt-5">
        <h3 class="mb-2 text-xs font-semibold text-foreground">{t("workbench_outputFiles")}</h3>
        {#if recentFiles.length > 0}
          <div class="space-y-1.5">
            {#each recentFiles as file (file.path)}
              <button
                type="button"
                class="w-full rounded-2xl border border-border/35 bg-background/35 px-3 py-2 text-left transition-colors hover:border-primary/30 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
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
          <div
            class="rounded-2xl border border-border/35 bg-background/35 px-3 py-3 text-xs text-muted-foreground"
          >
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
          <div
            class="rounded-2xl border border-border/35 bg-background/35 px-3 py-3 text-xs text-muted-foreground"
          >
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
                class="w-full rounded-2xl border border-[hsl(var(--miwarp-status-error)/0.28)] bg-[hsl(var(--miwarp-status-error)/0.08)] px-3 py-2 text-left transition-colors hover:bg-[hsl(var(--miwarp-status-error)/0.12)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--miwarp-status-error)/0.4)]"
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
          <div
            class="rounded-2xl border border-border/35 bg-background/35 px-3 py-3 text-xs text-muted-foreground"
          >
            {t("workbench_noRisks")}
          </div>
        {/if}
      </section>

      <section class="mt-5">
        <div class="mb-2 flex items-center justify-between gap-2">
          <h3 class="text-xs font-semibold text-foreground">{t("workbench_activeSession")}</h3>
          {#if activeRun}
            <StatusBadge status={activeRun.status} shortLabel={true} />
          {/if}
        </div>
        {#if activeRun}
          <button
            type="button"
            class="w-full rounded-2xl border border-border/40 bg-background/45 px-3 py-2.5 text-left transition-colors hover:border-primary/30 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
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
            </div>
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
        {#if pendingTimelineItems.length > 0}
          <div class="space-y-2">
            {#each pendingTimelineItems as item (item.id)}
              <div
                class="rounded-2xl border border-[hsl(var(--miwarp-status-warning)/0.28)] bg-[hsl(var(--miwarp-status-warning)/0.08)] px-3 py-2"
              >
                <div class="flex items-center gap-2">
                  <Icon
                    name="triangle-alert"
                    size="sm"
                    class="shrink-0 text-miwarp-status-warning"
                  />
                  <p class="truncate text-xs font-medium text-foreground">
                    {item.tool.tool_name}
                  </p>
                </div>
                <p class="mt-1 text-[11px] text-muted-foreground">
                  {item.tool.status === "ask_pending"
                    ? t("workbench_pendingQuestion")
                    : t("workbench_pendingApproval")}
                </p>
              </div>
            {/each}
          </div>
        {:else}
          <div
            class="rounded-2xl border border-border/35 bg-background/35 px-3 py-3 text-xs text-muted-foreground"
          >
            {t("workbench_noPendingWork")}
          </div>
        {/if}
      </section>

      <section class="mt-5">
        <h3 class="mb-2 text-xs font-semibold text-foreground">{t("workbench_recentSessions")}</h3>
        {#if recentSessions.length > 0}
          <div class="space-y-1.5">
            {#each recentSessions as session (session.id)}
              <button
                type="button"
                class="w-full rounded-2xl border px-3 py-2 text-left transition-colors hover:border-border/45 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 {session.id ===
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
          <div
            class="rounded-2xl border border-border/35 bg-background/35 px-3 py-3 text-xs text-muted-foreground"
          >
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
