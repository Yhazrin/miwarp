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
  <!-- 紧凑工具条风格 hero：只占视口顶部 ~80px，给消息流让出更多空间。
       文案 i18n key 全部保留，即便此处不再渲染也方便以后复用。 -->
  <section
    class="shrink-0 rounded-2xl border border-border/40 bg-card/60 px-4 py-3 shadow-sm backdrop-blur-xl"
    aria-label={t("workbench_hero")}
  >
    <div class="flex items-center justify-between gap-3">
      <div class="flex min-w-0 items-center gap-3">
        <div class="min-w-0">
          <h1 class="truncate text-base font-semibold text-foreground">{project.label}</h1>
          <p class="truncate font-mono text-[11px] text-muted-foreground" title={project.cwd}>
            {project.cwd}
          </p>
        </div>
      </div>
      <div class="flex shrink-0 items-center gap-3">
        <span class="hidden items-center gap-1.5 text-[10px] text-muted-foreground sm:inline-flex">
          <span class="h-1.5 w-1.5 rounded-full bg-[hsl(var(--miwarp-status-info))]"></span>
          {t("workbench_sessionsCount", { count: String(workbenchStore.selectedSessions.length) })}
          {#if project.lastActiveAt}
            <span class="text-muted-foreground/60">·</span>
            <span>{t("workbench_lastActive", { time: relativeTime(project.lastActiveAt) })}</span>
          {/if}
        </span>
        <button
          type="button"
          class="inline-flex h-8 items-center gap-1.5 rounded-full bg-primary px-3 text-xs font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
          onclick={openInChat}
        >
          <Icon name="external-link" size="sm" />
          {t("workbench_openInChat")}
        </button>
      </div>
    </div>
  </section>
{/if}
