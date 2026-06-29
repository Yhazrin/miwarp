<script lang="ts">
  import { getContext } from "svelte";
  import { fade } from "svelte/transition";
  import { workbenchStore } from "$lib/workbench/workbench-store.svelte";
  import { workspacesStore } from "$lib/stores/workspaces-store.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import {
    RUNS_CACHE_CONTEXT_KEY,
    type RunsCacheContext,
    resolveLayoutCachedRuns,
  } from "$lib/layout-chrome-context";
  import Icon from "$lib/components/Icon.svelte";
  import WorkbenchProjectHero from "$lib/components/workbench/WorkbenchProjectHero.svelte";
  import WorkbenchProjectChat from "$lib/components/workbench/WorkbenchProjectChat.svelte";
  import WorkbenchControlPanel from "$lib/components/workbench/WorkbenchControlPanel.svelte";

  // v1.0.10 perf: reuse the runs the layout already loaded (and continues to
  // reconcile in the background) to skip a redundant list_runs_lite IPC on
  // workbench mount. Falls back to the IPC when the cache isn't ready yet.
  const runsCache = getContext<RunsCacheContext | undefined>(RUNS_CACHE_CONTEXT_KEY);

  $effect(() => {
    const workspaces = workspacesStore.list;
    void (async () => {
      const cached = await resolveLayoutCachedRuns(runsCache);
      void workbenchStore.refresh(workspaces, cached ?? undefined);
    })();
  });

  // First-load skeleton: store hasn't finished its first refresh and we
  // already have a persisted selection but no projects on screen yet.
  const showInitialSkeleton = $derived(
    workbenchStore.loading && !workbenchStore.hasLoadedOnce && workbenchStore.projects.length === 0,
  );
</script>

<!--
  workbench 路由的左侧 sidebar 由 +layout.svelte 的全局 `<aside class:glass-sidebar>`
  统一渲染(挂载 `<WorkbenchSidebar />`)。本页只负责右侧主区:hero + chat。

  原先这里有一个 `hidden w-[260px] shrink-0 md:block` 的页面级 sidebar wrapper,
  那是重复实现,已删除;padding 由 `p-3` 直接让给全局 aside 即可。
-->
<main class="flex h-full min-w-0 flex-1 flex-col gap-2 p-3">
  {#if showInitialSkeleton}
    <div
      class="wb-frame flex min-h-[520px] flex-1 flex-col gap-3 px-4 py-4 motion-fade-in"
      aria-busy="true"
      aria-label={t("workbench_loading")}
    >
      <div class="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon name="loader-2" size="sm" class="animate-spin text-primary" />
        <span>{t("workbench_loading")}</span>
      </div>
      <div class="flex-1 space-y-3">
        <div class="wb-skeleton h-16 w-full"></div>
        <div class="grid flex-1 gap-2 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div class="wb-skeleton h-full min-h-[420px]"></div>
          <div class="wb-skeleton h-full min-h-[420px]"></div>
        </div>
      </div>
    </div>
  {:else if workbenchStore.selectedProject}
    {#key workbenchStore.selectedProject.id}
      <div in:fade={{ duration: 180, delay: 60 }} class="flex h-full min-w-0 flex-1 flex-col gap-2">
        <WorkbenchProjectHero />
        <div class="grid min-h-0 flex-1 grid-cols-1 gap-2 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div class="wb-frame flex min-h-[520px] flex-col overflow-hidden xl:min-h-0">
            <WorkbenchProjectChat />
          </div>
          <WorkbenchControlPanel />
        </div>
      </div>
    {/key}
  {:else}
    <div in:fade={{ duration: 180 }} class="flex flex-1 items-center justify-center">
      <div
        class="rounded-3xl border border-dashed border-border/40 bg-card/40 px-6 py-10 text-center shadow-sm backdrop-blur-xl"
      >
        <p class="text-sm text-muted-foreground">{t("workbench_selectProject")}</p>
      </div>
    </div>
  {/if}
</main>
