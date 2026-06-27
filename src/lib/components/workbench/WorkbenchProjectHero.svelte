<script lang="ts">
  import { workbenchStore } from "$lib/workbench/workbench-store.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import { relativeTime } from "$lib/utils/format";
  import { goto } from "$app/navigation";
  import Icon from "$lib/components/Icon.svelte";
  import { workspacesStore } from "$lib/stores/workspaces-store.svelte";

  function openInChat(): void {
    const cwd = workbenchStore.selectedProject?.cwd;
    if (!cwd) return;
    void goto(`/chat?new=1&folder=${encodeURIComponent(cwd)}`);
  }

  async function refreshWorkbench(): Promise<void> {
    await workbenchStore.refresh(workspacesStore.list);
  }

  const project = $derived(workbenchStore.selectedProject);
  // Reuse the store-derived, already-filtered + sorted runs so we don't
  // recompute the same per-cwd filter in Hero, Chat, and ControlPanel.
  const projectRuns = $derived(workbenchStore.selectedProjectRuns);
  /** Single reduce pass for the only hero counter that matters at a glance:
   *  the attention badge. Operational detail (sessions / running / desk) lives
   *  on the control panel to keep the hero a slim identity strip. */
  const attentionCount = $derived.by(() => {
    let count = 0;
    for (const run of projectRuns) {
      if (run.status === "waiting_approval" || run.status === "waiting_input") count++;
    }
    return count;
  });
  const status = $derived(project?.status ?? "idle");
  const statusDotClass = $derived(
    status === "active"
      ? "bg-[hsl(var(--miwarp-status-info))]"
      : status === "idle"
        ? "bg-[hsl(var(--miwarp-status-warning))]"
        : "bg-muted-foreground/40",
  );
</script>

{#if project}
  <!--
    Hero — 一行身份条（左：项目名 + cwd + 状态点 + 上次活跃 + 关注标记；右：操作）。
    v1.0.10 redesign: drop the 3 central metric tiles (Sessions / Waiting / Running)
    — they're echoed on the control panel top strip and on the chat briefing
    cards. The hero's only job is "where am I, what project, any blockers?".
    Operational counters live in the control panel.
  -->
  <section class="wb-frame motion-fade-in shrink-0 px-4 py-2.5" aria-label={t("workbench_hero")}>
    <div class="flex items-center justify-between gap-3">
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

      <div class="flex shrink-0 items-center gap-2">
        <button
          type="button"
          class="inline-flex h-8 items-center gap-1.5 rounded-full border border-border/45 bg-background/55 px-3 text-xs font-medium text-foreground transition-colors hover:border-primary/30 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60"
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
          class="inline-flex h-8 items-center gap-1.5 rounded-full bg-primary px-3 text-xs font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          onclick={openInChat}
          aria-label={t("workbench_openInChat")}
        >
          <Icon name="external-link" size="sm" />
          {t("workbench_openInChat")}
        </button>
      </div>
    </div>
  </section>
{/if}
