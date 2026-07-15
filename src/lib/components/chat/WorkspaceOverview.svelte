<!--
  WorkspaceOverview — 在聊天页面的欢迎屏上方展示选中工作区的项目概览。
  当用户在侧边栏选中了一个项目文件夹（folderCwdOverride 已设置）但尚未
  选择具体会话时，此组件替代原来空白的欢迎屏，展示：
    - 项目标题 + git 状态（ProjectPulse）
    - 技术栈 / 命令 / CLAUDE.md / README（ProjectProfile）
    - 项目笔记（ProjectNotesEditor）
    - 最近会话列表（来自 runsSidebarStore）
    - 操作按钮：新会话 / 打开文件夹
-->
<script lang="ts">
  import { goto, replaceState } from "$app/navigation";
  import { openDirectoryInFinder } from "$lib/api";
  import { projectProfileStore } from "$lib/workbench/project-profile-store.svelte";
  import { runsSidebarStore } from "$lib/layout/runs-sidebar-store.svelte";
  import { normalizeCwd } from "$lib/utils/sidebar-groups";
  import { cwdDisplayLabel, relativeTime } from "$lib/utils/format";
  import { t } from "$lib/i18n/index.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import ProjectPulse from "$lib/components/workbench/ProjectPulse.svelte";
  import ProjectProfile from "$lib/components/workbench/ProjectProfile.svelte";
  import ProjectNotesEditor from "$lib/components/workbench/ProjectNotesEditor.svelte";

  interface Props {
    cwd: string;
  }

  let { cwd }: Props = $props();

  const label = $derived(cwdDisplayLabel(cwd));

  // Recent sessions for this workspace, sorted by most recent activity.
  const recentSessions = $derived.by(() => {
    if (!cwd) return [];
    const normalized = normalizeCwd(cwd);
    return runsSidebarStore.runs
      .filter((r) => normalizeCwd(r.cwd) === normalized)
      .sort((a, b) => {
        const ta = a.last_activity_at || a.started_at || "";
        const tb = b.last_activity_at || b.started_at || "";
        return tb.localeCompare(ta);
      })
      .slice(0, 5)
      .map((r) => ({
        id: r.id,
        title: r.name || r.prompt?.slice(0, 60) || r.id.slice(0, 8),
        preview: r.last_message_preview || r.agent,
        status: r.status,
        time: r.last_activity_at || r.started_at,
      }));
  });

  // Trigger profile load when cwd changes.
  $effect(() => {
    if (cwd) {
      void projectProfileStore.load(cwd);
    } else {
      projectProfileStore.reset();
    }
  });
</script>

{#if cwd}
  <div class="workspace-overview mx-auto w-full max-w-3xl px-6 py-6">
    <!-- Header -->
    <header class="mb-4 flex items-center gap-3">
      <div class="flex min-w-0 items-center gap-2">
        <Icon name="folder-open" size="sm" class="shrink-0 text-muted-foreground" />
        <h2 class="truncate text-base font-semibold text-foreground">{label}</h2>
      </div>
      <span class="truncate font-mono text-[11px] text-muted-foreground/60" title={cwd}>
        {cwd}
      </span>
      <div class="ml-auto flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          class="inline-flex h-7 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          onclick={() => goto(`/chat?new=1&folder=${encodeURIComponent(cwd)}`)}
        >
          <Icon name="message-square" size="xs" />
          {t("workbench_newSession")}
        </button>
        <button
          type="button"
          class="inline-flex h-7 items-center gap-1.5 rounded-md border border-border/40 bg-background/60 px-2.5 text-xs font-medium text-foreground/80 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          onclick={() => void openDirectoryInFinder(cwd).catch(() => {})}
        >
          <Icon name="folder-open" size="xs" />
          {t("sidebar_openFolder")}
        </button>
      </div>
    </header>

    <!-- Git status -->
    <div class="mb-3">
      <ProjectPulse {cwd} />
    </div>

    <!-- Profile + Notes side by side -->
    <div class="mb-4 grid gap-3 lg:grid-cols-2">
      <ProjectProfile {cwd} />
      <ProjectNotesEditor {cwd} />
    </div>

    <!-- Recent sessions -->
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
              onclick={() => replaceState(`/chat?run=${encodeURIComponent(session.id)}`, {})}
            >
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium text-foreground">{session.title}</p>
                <p class="truncate text-[11px] text-muted-foreground">
                  {session.preview}
                </p>
              </div>
              <div class="flex shrink-0 items-center gap-2">
                {#if session.time}
                  <span class="text-[10px] text-muted-foreground/60">
                    {relativeTime(session.time)}
                  </span>
                {/if}
                <Icon name="external-link" size="xs" class="text-muted-foreground" />
              </div>
            </button>
          {/each}
        </div>
      {:else}
        <p class="text-[11px] text-muted-foreground">{t("workbench_noSessionsYet")}</p>
      {/if}
    </section>
  </div>
{/if}
