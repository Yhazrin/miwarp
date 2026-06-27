<script lang="ts">
  import { onMount } from "svelte";
  import { workbenchStore } from "$lib/workbench/workbench-store.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import WorkbenchProjectTree from "$lib/components/workbench/WorkbenchProjectTree.svelte";
  import WorkbenchProjectHero from "$lib/components/workbench/WorkbenchProjectHero.svelte";
  import WorkbenchProjectChat from "$lib/components/workbench/WorkbenchProjectChat.svelte";

  onMount(() => {
    const projectId = workbenchStore.selectedProjectId;
    if (projectId) {
      void workbenchStore.loadSessionsFor(projectId);
    }
  });
</script>

<div class="flex h-full flex-col">
  <!-- Page-level toolbar -->
  <header class="shrink-0 border-b border-border/40 bg-background/60 px-5 py-3 backdrop-blur-xl">
    <div class="flex items-center justify-between gap-3">
      <div>
        <h1 class="text-base font-semibold text-foreground">{t("workbench_title")}</h1>
        <p class="mt-0.5 text-xs text-muted-foreground">{t("workbench_subtitle")}</p>
      </div>
    </div>
  </header>

  <!-- Three-pane layout: tree | hero + chat | (future) detail -->
  <div class="flex min-h-0 flex-1 overflow-hidden">
    <div class="hidden w-[260px] shrink-0 md:block">
      <WorkbenchProjectTree />
    </div>

    <main class="flex min-w-0 flex-1 flex-col gap-3 p-3">
      {#if workbenchStore.selectedProject}
        <WorkbenchProjectHero />
        <div
          class="flex min-h-0 flex-1 flex-col rounded-3xl border border-border/40 bg-card/40 p-2 shadow-sm backdrop-blur-xl"
        >
          <WorkbenchProjectChat />
        </div>
      {:else}
        <div class="flex flex-1 items-center justify-center">
          <div
            class="rounded-3xl border border-dashed border-border/40 bg-card/40 px-6 py-10 text-center shadow-sm backdrop-blur-xl"
          >
            <p class="text-sm text-muted-foreground">{t("workbench_selectProject")}</p>
          </div>
        </div>
      {/if}
    </main>
  </div>
</div>
