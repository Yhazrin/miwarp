<script lang="ts">
  import { workbenchStore } from "$lib/workbench/workbench-store.svelte";
  import { workspacesStore } from "$lib/stores/workspaces-store.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import WorkbenchProjectHero from "$lib/components/workbench/WorkbenchProjectHero.svelte";
  import WorkbenchProjectChat from "$lib/components/workbench/WorkbenchProjectChat.svelte";
  import WorkbenchControlPanel from "$lib/components/workbench/WorkbenchControlPanel.svelte";

  $effect(() => {
    const workspaces = workspacesStore.list;
    void workbenchStore.refresh(workspaces);
  });
</script>

<!--
  workbench 路由的左侧 sidebar 由 +layout.svelte 的全局 `<aside class:glass-sidebar>`
  统一渲染(挂载 `<WorkbenchSidebar />`)。本页只负责右侧主区:hero + chat。

  原先这里有一个 `hidden w-[260px] shrink-0 md:block` 的页面级 sidebar wrapper,
  那是重复实现,已删除;padding 由 `p-3` 直接让给全局 aside 即可。
-->
<main class="flex h-full min-w-0 flex-1 flex-col gap-2 p-3">
  {#if workbenchStore.selectedProject}
    <WorkbenchProjectHero />
    <div class="grid min-h-0 flex-1 grid-cols-1 gap-2 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div
        class="flex min-h-[520px] flex-col overflow-hidden rounded-3xl border border-border/40 bg-card/40 shadow-sm backdrop-blur-xl xl:min-h-0"
      >
        <WorkbenchProjectChat />
      </div>
      <WorkbenchControlPanel />
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
