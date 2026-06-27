<script lang="ts">
  import { workbenchStore } from "$lib/workbench/workbench-store.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import { relativeTime } from "$lib/utils/format";
  import Icon from "$lib/components/Icon.svelte";

  function statusDotClass(status: "active" | "idle" | "stale"): string {
    if (status === "active") return "bg-[hsl(var(--miwarp-status-info))]";
    if (status === "idle") return "bg-[hsl(var(--miwarp-status-warning))]";
    return "bg-muted-foreground/40";
  }
</script>

<aside
  class="flex h-full w-full flex-col gap-3 bg-transparent p-3"
  aria-label={t("workbench_projectTree")}
>
  <header
    class="shrink-0 rounded-2xl border border-border/40 bg-card/70 px-4 py-3 shadow-sm backdrop-blur-xl"
  >
    <h2 class="text-sm font-semibold text-foreground">{t("workbench_projects")}</h2>
    <p class="mt-0.5 text-xs text-muted-foreground">{t("workbench_projectsSubtitle")}</p>
  </header>

  <div
    class="flex-1 overflow-y-auto rounded-2xl border border-border/40 bg-card/60 p-2 shadow-sm backdrop-blur-xl"
  >
    {#if workbenchStore.projects.length === 0}
      <p class="px-3 py-6 text-xs text-muted-foreground">{t("workbench_noProjects")}</p>
    {:else}
      <ul class="space-y-1">
        {#each workbenchStore.projects as project (project.id)}
          {@const isSelected = project.id === workbenchStore.selectedProjectId}
          <li>
            <button
              type="button"
              class="w-full rounded-2xl border px-3.5 py-3 text-left transition-colors
                {isSelected
                ? 'border-primary/30 bg-primary/10 shadow-sm'
                : 'border-transparent hover:border-border/40 hover:bg-muted/40'}"
              onclick={() => workbenchStore.selectProject(project.id)}
            >
              <div class="flex items-start justify-between gap-2">
                <div class="flex min-w-0 items-center gap-2">
                  <span class="mt-1 h-2 w-2 shrink-0 rounded-full {statusDotClass(project.status)}"
                  ></span>
                  <div class="min-w-0">
                    <p class="truncate text-sm font-medium text-foreground">{project.label}</p>
                    <p
                      class="truncate font-mono text-[10px] text-muted-foreground"
                      title={project.cwd}
                    >
                      {project.cwd}
                    </p>
                  </div>
                </div>
                <Icon name="folder-open" size="sm" class="shrink-0 text-muted-foreground/70" />
              </div>
              <div
                class="mt-1.5 flex items-center justify-between gap-2 text-[10px] text-muted-foreground"
              >
                <span>{t("workbench_sessionsCount", { count: String(project.sessionCount) })}</span>
                {#if project.lastActiveAt}
                  <span
                    >{t("workbench_lastActive", { time: relativeTime(project.lastActiveAt) })}</span
                  >
                {/if}
              </div>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</aside>
