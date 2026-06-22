<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
  import GitBranchPill from "$lib/components/git/GitBranchPill.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import type { WorkspaceGitSnapshot, WorkspaceSessionRow } from "$lib/types/workspace";
  import { relativeTime } from "$lib/utils/format";

  let {
    label,
    cwd,
    sessions,
    git,
    onOpenChat,
    onContinue,
  }: {
    label: string;
    cwd: string;
    sessions: WorkspaceSessionRow[];
    git: WorkspaceGitSnapshot | null;
    onOpenChat: (href: string) => void;
    onContinue: (href: string) => void;
  } = $props();

  function statusLabel(row: WorkspaceSessionRow): string {
    if (row.needsAttention) return t("workspace_waiting");
    if (row.isActive) return t("workspace_running");
    if (row.isFailed) return t("workspace_failed");
    return row.status;
  }

  function statusClass(row: WorkspaceSessionRow): string {
    if (row.needsAttention) return "text-[hsl(var(--miwarp-status-warning))]";
    if (row.isActive) return "text-[hsl(var(--miwarp-status-info))]";
    if (row.isFailed) return "text-[hsl(var(--miwarp-status-error))]";
    return "text-muted-foreground";
  }
</script>

<div class="flex h-full flex-col">
  <div class="shrink-0 border-b border-border px-6 py-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <h2 class="truncate text-lg font-semibold text-foreground">
          {label || t("workspace_uncategorized")}
        </h2>
        {#if cwd}
          <p class="mt-0.5 truncate font-mono text-xs text-muted-foreground" title={cwd}>{cwd}</p>
        {/if}
        <p class="mt-1 text-xs text-muted-foreground">{t("workspace_execution_local")}</p>
      </div>

      {#if git}
        <div class="min-w-[10rem] rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
          {#if git.loading}
            <p class="text-xs text-muted-foreground">{t("workspace_git_loading")}</p>
          {:else if git.error}
            <p class="text-xs text-muted-foreground">{t("workspace_git_unavailable")}</p>
          {:else}
            <div class="flex items-center gap-2">
              <GitBranchPill name={git.branch || "—"} variant="current" maxWidth="10rem" />
              <span class="text-[10px] text-muted-foreground">
                {git.isClean
                  ? t("workspace_git_clean")
                  : t("workspace_git_dirty", { count: String(git.changedFiles) })}
              </span>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  </div>

  <div class="flex-1 overflow-y-auto px-6 py-4">
    <div class="mb-3 flex items-center justify-between gap-2">
      <h3 class="text-sm font-medium text-foreground">{t("workspace_recent_sessions")}</h3>
      <a href="/history" class="text-xs text-primary hover:underline"
        >{t("workspace_view_history")}</a
      >
    </div>

    {#if sessions.length === 0}
      <div class="rounded-lg border border-dashed border-border px-4 py-8 text-center">
        <Icon name="message-square" size="sm" class="mx-auto mb-2 text-muted-foreground" />
        <p class="text-sm text-muted-foreground">{t("workspace_no_sessions")}</p>
        <a href="/chat" class="mt-3 inline-block text-xs text-primary hover:underline">
          {t("workspace_open_chat")}
        </a>
      </div>
    {:else}
      <ul class="space-y-2">
        {#each sessions as row (row.groupKey)}
          <li class="rounded-lg border border-border/70 bg-card/40 px-4 py-3">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <p class="truncate text-sm font-medium text-foreground">{row.title}</p>
                  <span class="text-[10px] font-medium uppercase tracking-wide {statusClass(row)}">
                    {statusLabel(row)}
                  </span>
                </div>
                <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                  <span>{t("workspace_agent")}: {row.agentLabel}</span>
                  <span>{t("workspace_runtime")}: {row.runtimeLabel}</span>
                  <span>{t("workspace_model")}: {row.modelLabel}</span>
                  {#if row.lastActivityAt}
                    <span>{t("workspace_last_activity")}: {relativeTime(row.lastActivityAt)}</span>
                  {/if}
                </div>
              </div>
              <div class="flex shrink-0 items-center gap-2">
                {#if row.canContinue}
                  <button
                    type="button"
                    class="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                    onclick={() => onContinue(row.href)}
                  >
                    {t("workspace_continue")}
                  </button>
                {/if}
                <button
                  type="button"
                  class="rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-muted/50"
                  onclick={() => onOpenChat(row.href)}
                >
                  {t("workspace_open_chat")}
                </button>
              </div>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>
