<script lang="ts">
  import { goto } from "$app/navigation";
  import { workbenchStore } from "$lib/workbench/workbench-store.svelte";
  import ProjectPulse from "./ProjectPulse.svelte";
  import ProjectProfile from "./ProjectProfile.svelte";
  import ProjectNotesEditor from "./ProjectNotesEditor.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import { t } from "$lib/i18n/index.svelte";

  const project = $derived(workbenchStore.selectedProject);
  const cwd = $derived(project?.cwd ?? "");
  const activeRunId = $derived(workbenchStore.selectedActiveRunId);
  const recentSessions = $derived(workbenchStore.selectedSessions.slice(0, 3));
</script>

{#if project}
  <div class="flex h-full min-w-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
    <ProjectPulse {cwd} />
    <div class="grid gap-3 lg:grid-cols-2">
      <ProjectProfile {cwd} />
      <ProjectNotesEditor {cwd} />
    </div>

    <section>
      <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {t("workbench_recentSessionsTitle")}
      </h3>
      {#if recentSessions.length > 0}
        <div class="space-y-1">
          {#each recentSessions as session (session.id)}
            <button
              type="button"
              class="flex w-full items-center justify-between gap-2 rounded-md border border-border/40 bg-card/40 px-3 py-2 text-left transition-colors hover:bg-muted/40"
              onclick={() => {
                workbenchStore.setActiveRun(project.id, session.id);
                void goto(`/chat?run=${encodeURIComponent(session.id)}`);
              }}
            >
              <div class="min-w-0">
                <p class="truncate text-sm font-medium text-foreground">{session.title}</p>
                <p class="truncate text-[11px] text-muted-foreground">
                  {session.preview || session.agent}
                </p>
              </div>
              <Icon name="external-link" size="xs" class="shrink-0 text-muted-foreground" />
            </button>
          {/each}
        </div>
      {:else}
        <p class="text-[11px] text-muted-foreground">{t("workbench_noSessionsYet")}</p>
      {/if}
    </section>

    {#if activeRunId}
      <button
        type="button"
        class="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-primary text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        onclick={() => goto(`/chat?run=${encodeURIComponent(activeRunId)}`)}
      >
        <Icon name="external-link" size="sm" />
        {t("workbench_openChatSession")}
      </button>
    {:else}
      <button
        type="button"
        class="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border border-primary/30 bg-primary/10 text-xs font-medium text-primary transition-colors hover:bg-primary/15"
        onclick={() => goto(`/chat?new=1&folder=${encodeURIComponent(cwd)}`)}
      >
        <Icon name="message-square" size="sm" />
        {t("workbench_newSession")}
      </button>
    {/if}
  </div>
{/if}
