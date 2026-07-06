<script lang="ts">
  import { workbenchStore } from "$lib/workbench/workbench-store.svelte";
  import { t } from "$lib/i18n/index.svelte";
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
  // Single reduce pass for the only hero counter that matters at a glance.
  // Operational detail (sessions / running / desk) lives on the control panel.
  const attentionCount = $derived.by(() => {
    let count = 0;
    for (const run of workbenchStore.selectedProjectRuns) {
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
  <section class="wb-frame motion-fade-in shrink-0 px-4 py-2" aria-label={t("workbench_hero")}>
    <div class="flex items-center justify-between gap-3">
      <div class="flex min-w-0 items-center gap-2.5">
        <span class="h-2 w-2 shrink-0 rounded-full {statusDotClass}" aria-label={status}></span>
        <h1 class="truncate text-sm font-semibold text-foreground">{project.label}</h1>
        {#if attentionCount > 0}
          <span
            class="inline-flex shrink-0 items-center gap-1 rounded-full bg-[hsl(var(--miwarp-status-error)/0.12)] px-1.5 py-0.5 text-[10px] font-medium text-[hsl(var(--miwarp-status-error))]"
            title={t("workbench_attentionBadge")}
          >
            <Icon name="triangle-alert" size="xs" />
            {attentionCount}
          </span>
        {/if}
        <span class="truncate font-mono text-[11px] text-muted-foreground/70" title={project.cwd}>
          {project.cwd}
        </span>
      </div>

      <div class="flex shrink-0 items-center gap-1">
        <button
          type="button"
          class="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60"
          onclick={refreshWorkbench}
          aria-label={t("workbench_refresh")}
          title={t("workbench_refresh")}
          disabled={workbenchStore.loading}
        >
          <Icon name="refresh-cw" size="xs" class={workbenchStore.loading ? "animate-spin" : ""} />
        </button>
        <button
          type="button"
          class="inline-flex h-7 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          onclick={openInChat}
          aria-label={t("workbench_openInChat")}
        >
          <Icon name="external-link" size="xs" />
          {t("workbench_openInChat")}
        </button>
      </div>
    </div>
  </section>
{/if}
