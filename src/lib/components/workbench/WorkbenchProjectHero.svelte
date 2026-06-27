<script lang="ts">
  import { workbenchStore } from "$lib/workbench/workbench-store.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import { relativeTime } from "$lib/utils/format";
  import { goto } from "$app/navigation";
  import Icon from "$lib/components/Icon.svelte";

  function openInChat(): void {
    const cwd = workbenchStore.selectedProject?.cwd;
    if (!cwd) return;
    // TODO(workspace): navigate to /chat?cwd=<encoded cwd> once the chat page
    // supports project-scoped entry. For now we hop to /chat and let it pick up
    // the most recent session.
    void goto("/chat");
  }
</script>

{#if workbenchStore.selectedProject}
  {@const project = workbenchStore.selectedProject}
  <section
    class="shrink-0 rounded-3xl border border-border/40 bg-card/70 p-6 shadow-sm backdrop-blur-xl"
    aria-label={t("workbench_hero")}
  >
    <div class="flex items-start justify-between gap-4">
      <div class="min-w-0">
        <h1 class="truncate text-2xl font-semibold text-foreground">{project.label}</h1>
        <p class="mt-1 truncate font-mono text-xs text-muted-foreground" title={project.cwd}>
          {project.cwd}
        </p>
        <p class="mt-3 max-w-2xl text-sm text-muted-foreground">{project.description}</p>
      </div>
      <button
        type="button"
        class="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-xs font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
        onclick={openInChat}
      >
        <Icon name="external-link" size="sm" />
        {t("workbench_openInChat")}
      </button>
    </div>

    <div class="mt-4 flex items-center gap-3 text-[11px] text-muted-foreground">
      <span class="inline-flex items-center gap-1.5">
        <span class="h-1.5 w-1.5 rounded-full bg-[hsl(var(--miwarp-status-info))]"></span>
        {t("workbench_sessionsCount", { count: String(workbenchStore.selectedSessions.length) })}
      </span>
      {#if project.lastActiveAt}
        <span>· {t("workbench_lastActive", { time: relativeTime(project.lastActiveAt) })}</span>
      {/if}
    </div>
  </section>
{/if}
