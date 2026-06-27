<!--
  WorkbenchSidebar — 全局 workbench 侧边栏组件,被 `src/routes/+layout.svelte`
  渲染在统一的 `<aside class:glass-sidebar>` 容器内(和 SettingsSidebar /
  WorkspaceSidebar / ScheduledTasksSidebar 同位),不再自己包 `<aside>` 也不需要
  `border-r` / `backdrop-blur` —— 这些由全局容器提供。

  职责:展示 workbench 项目列表 + 选中态 + meta 行,不负责右侧 hero / chat 主区。
-->
<script lang="ts">
  import { goto } from "$app/navigation";
  import { workbenchStore } from "$lib/workbench/workbench-store.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import { relativeTime } from "$lib/utils/format";
  import Icon from "$lib/components/Icon.svelte";

  function statusDotClass(status: "active" | "idle" | "stale"): string {
    if (status === "active") return "bg-[hsl(var(--miwarp-status-info))]";
    if (status === "idle") return "bg-[hsl(var(--miwarp-status-warning))]";
    return "bg-muted-foreground/40";
  }

  function openWorkspace(): void {
    void goto("/workspace");
  }
</script>

<div class="flex h-full w-full flex-col" aria-label={t("workbench_projectTree")}>
  <header class="shrink-0 border-b border-sidebar-border/60 px-4 py-3">
    <h2 class="text-sm font-semibold text-sidebar-foreground">{t("workbench_projects")}</h2>
    <p class="mt-0.5 text-xs text-muted-foreground">{t("workbench_projectsSubtitle")}</p>
    <div class="mt-3 grid grid-cols-3 gap-1.5">
      <div class="rounded-xl border border-sidebar-border/60 bg-sidebar-accent/30 px-2 py-1.5">
        <p class="text-[10px] text-muted-foreground">{t("workbench_metricProjects")}</p>
        <p class="mt-0.5 text-sm font-semibold text-sidebar-foreground">
          {workbenchStore.projects.length}
        </p>
      </div>
      <div class="rounded-xl border border-sidebar-border/60 bg-sidebar-accent/30 px-2 py-1.5">
        <p class="text-[10px] text-muted-foreground">{t("workbench_metricActive")}</p>
        <p class="mt-0.5 text-sm font-semibold text-sidebar-foreground">
          {workbenchStore.activeProjectCount}
        </p>
      </div>
      <div class="rounded-xl border border-sidebar-border/60 bg-sidebar-accent/30 px-2 py-1.5">
        <p class="text-[10px] text-muted-foreground">{t("workbench_metricAttention")}</p>
        <p class="mt-0.5 text-sm font-semibold text-sidebar-foreground">
          {workbenchStore.attentionRunCount}
        </p>
      </div>
    </div>
  </header>

  <div class="sidebar-scroll flex-1 overflow-y-auto p-2">
    {#if workbenchStore.projects.length === 0}
      <!--
        空项目态 onboarding：居中 icon + 文案 + 一个跳转按钮。
        侧边栏窄时不喧宾夺主；点击后跳到 /workspace 让用户先添加工作区。
      -->
      <div class="flex flex-col items-center justify-center gap-3 px-3 py-8 text-center">
        <span
          class="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-border/45 bg-background/55 text-muted-foreground"
        >
          <Icon name="folder-up" size="lg" />
        </span>
        <div class="space-y-1">
          <p class="text-xs font-semibold text-foreground">{t("workbench_onboardingTitle")}</p>
          <p class="text-[11px] leading-4 text-muted-foreground">
            {t("workbench_noProjectsHint")}
          </p>
        </div>
        <button
          type="button"
          class="inline-flex h-8 items-center gap-1.5 rounded-full bg-primary px-3 text-xs font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
          onclick={openWorkspace}
        >
          <Icon name="folder-open" size="sm" />
          {t("workbench_openWorkspace")}
        </button>
      </div>
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
</div>
