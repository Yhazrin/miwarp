<script lang="ts">
  import { workbenchStore } from "$lib/workbench/workbench-store.svelte";
  import { sessionStore } from "$lib/stores";
  import { t } from "$lib/i18n/index.svelte";
  import { relativeTime } from "$lib/utils/format";
  import { goto } from "$app/navigation";
  import Icon from "$lib/components/Icon.svelte";
  import { workspacesStore } from "$lib/stores/workspaces-store.svelte";
  import { runProjectCwd } from "$lib/workbench/workbench-store.svelte";

  function openInChat(): void {
    const cwd = workbenchStore.selectedProject?.cwd;
    if (!cwd) return;
    void goto(`/chat?new=1&folder=${encodeURIComponent(cwd)}`);
  }

  async function refreshWorkbench(): Promise<void> {
    await workbenchStore.refresh(workspacesStore.list);
  }

  const store = sessionStore;
  const project = $derived(workbenchStore.selectedProject);
  const activeRunId = $derived(workbenchStore.selectedActiveRunId);
  const projectRuns = $derived(
    project ? workbenchStore.allRuns.filter((run) => runProjectCwd(run) === project.cwd) : [],
  );
  const deskSessionCount = $derived(
    projectRuns.filter((run) => run.run_surface === "project_desk").length,
  );
  const waitingApprovalCount = $derived(
    projectRuns.filter((run) => run.status === "waiting_approval").length,
  );
  const waitingInputCount = $derived(
    projectRuns.filter((run) => run.status === "waiting_input").length,
  );
  const runningCount = $derived(
    projectRuns.filter((run) => run.status === "running" || run.status === "pending").length,
  );
  const attentionCount = $derived(waitingApprovalCount + waitingInputCount);
  const status = $derived(project?.status ?? "idle");
  const statusDotClass = $derived(
    status === "active"
      ? "bg-[hsl(var(--miwarp-status-info))]"
      : status === "idle"
        ? "bg-[hsl(var(--miwarp-status-warning))]"
        : "bg-muted-foreground/40",
  );
  const ownsCurrentRun = $derived(!!activeRunId && store.run?.id === activeRunId);
</script>

{#if project}
  <!--
    Hero — 三段式条带（左：项目身份；中：核心计数；右：操作 + 关注标记）。
    整体高度通过 min-h 与内边距控制在 88–110px，给消息流让出空间。
  -->
  <section
    class="shrink-0 rounded-2xl border border-border/40 bg-card/60 px-4 py-3 shadow-sm backdrop-blur-xl"
    aria-label={t("workbench_hero")}
  >
    <div class="flex items-center justify-between gap-3">
      <!-- 左侧：项目名 + cwd + 上次活跃 + 状态点 -->
      <div class="flex min-w-0 items-center gap-3">
        <span class="h-2 w-2 shrink-0 rounded-full {statusDotClass}" aria-label={status}></span>
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <h1 class="truncate text-base font-semibold text-foreground">{project.label}</h1>
            {#if attentionCount > 0}
              <span
                class="inline-flex shrink-0 items-center gap-1 rounded-full border border-[hsl(var(--miwarp-status-error)/0.32)] bg-[hsl(var(--miwarp-status-error)/0.1)] px-2 py-0.5 text-[10px] font-medium text-[hsl(var(--miwarp-status-error))]"
              >
                <Icon name="triangle-alert" size="xs" />
                {t("workbench_attentionBadge")}
                <span
                  class="ml-0.5 rounded-full bg-[hsl(var(--miwarp-status-error)/0.18)] px-1 text-[9px]"
                >
                  {attentionCount}
                </span>
              </span>
            {/if}
          </div>
          <div class="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span class="truncate font-mono" title={project.cwd}>{project.cwd}</span>
            {#if project.lastActiveAt}
              <span class="text-muted-foreground/50">·</span>
              <span>{t("workbench_lastActive", { time: relativeTime(project.lastActiveAt) })}</span>
            {/if}
          </div>
        </div>
      </div>

      <!-- 中间：3 个核心计数卡片 -->
      <div class="hidden items-stretch gap-1.5 md:flex">
        <div
          class="flex flex-col justify-center rounded-xl border border-border/40 bg-background/45 px-3 py-1.5 min-w-[88px]"
        >
          <p class="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("workbench_metricSessions")}
          </p>
          <div class="mt-0.5 flex items-baseline gap-1.5">
            <span class="text-sm font-semibold text-foreground">{project.sessionCount}</span>
            <span class="text-[10px] text-muted-foreground">
              · {t("workbench_metricDeskRuns")}
              {deskSessionCount}
            </span>
          </div>
        </div>
        <div
          class="flex flex-col justify-center rounded-xl border border-[hsl(var(--miwarp-status-warning)/0.28)] bg-[hsl(var(--miwarp-status-warning)/0.06)] px-3 py-1.5 min-w-[92px]"
        >
          <p
            class="text-[9px] font-medium uppercase tracking-wide text-[hsl(var(--miwarp-status-warning))]"
          >
            {t("workbench_metricWaitingApproval")}
          </p>
          <div class="mt-0.5 flex items-baseline gap-1.5">
            <span class="text-sm font-semibold text-foreground">{waitingApprovalCount}</span>
            <span class="text-[10px] text-muted-foreground">
              · {t("workbench_metricWaitingInput")}
              {waitingInputCount}
            </span>
          </div>
        </div>
        <div
          class="flex flex-col justify-center rounded-xl border border-[hsl(var(--miwarp-status-info)/0.25)] bg-[hsl(var(--miwarp-status-info)/0.06)] px-3 py-1.5 min-w-[88px]"
        >
          <p
            class="text-[9px] font-medium uppercase tracking-wide text-[hsl(var(--miwarp-status-info))]"
          >
            {t("workbench_metricRunning")}
          </p>
          <div class="mt-0.5 flex items-baseline gap-1.5">
            <span class="text-sm font-semibold text-foreground">{runningCount}</span>
            <span class="text-[10px] text-muted-foreground">
              · desk {ownsCurrentRun ? 1 : 0}
            </span>
          </div>
        </div>
      </div>

      <!-- 右侧：操作按钮组 -->
      <div class="flex shrink-0 items-center gap-2">
        <button
          type="button"
          class="inline-flex h-8 items-center gap-1.5 rounded-full border border-border/45 bg-background/55 px-3 text-xs font-medium text-foreground transition-colors hover:border-primary/30 hover:bg-primary/5"
          onclick={refreshWorkbench}
          aria-label={t("workbench_refresh")}
          title={t("workbench_refresh")}
          disabled={workbenchStore.loading}
        >
          <Icon name="refresh-cw" size="sm" class={workbenchStore.loading ? "animate-spin" : ""} />
          <span class="hidden sm:inline">{t("workbench_refresh")}</span>
        </button>
        <button
          type="button"
          class="inline-flex h-8 items-center gap-1.5 rounded-full bg-primary px-3 text-xs font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
          onclick={openInChat}
        >
          <Icon name="external-link" size="sm" />
          {t("workbench_openInChat")}
        </button>
      </div>
    </div>
  </section>
{/if}
