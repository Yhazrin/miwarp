<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { getUserSettings } from "$lib/api";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import WorkspaceCapsulePanel from "$lib/components/workspace/WorkspaceCapsulePanel.svelte";
  import AttentionQueuePanel from "$lib/components/workspace/AttentionQueuePanel.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import { attentionQueueStore } from "$lib/stores/attention-queue-store.svelte";
  import { getNoSessionPersistence } from "$lib/stores/agent-settings-cache.svelte";
  import { canResumeNow } from "$lib/stores/types";
  import { hasAttention } from "$lib/stores/attention-store.svelte";
  import type { TaskRun, UserSettings } from "$lib/types";
  import { LS_PINNED_CWDS, LS_PROJECT_CWD, LS_REMOVED_CWDS } from "$lib/utils/storage-keys";
  import { normalizeCwd } from "$lib/utils/sidebar-groups";
  import { buildWorkspaceView, findDefaultWorkspaceCwd } from "$lib/workspace/selectors";
  import { workspaceInboxStore } from "$lib/workspace/workspace-inbox-store.svelte";

  let settings = $state<UserSettings | null>(null);
  let pinnedCwds = $state<string[]>([]);
  let removedCwds = $state<string[]>([]);

  const workspaceView = $derived.by(() =>
    buildWorkspaceView(workspaceInboxStore.runs, workspaceInboxStore.selectedCwd, {
      pinnedCwds,
      removedCwds,
      workspaceAliases: settings?.workspace_aliases ?? {},
      hasAttention,
      resolveCanContinue: (run: TaskRun) =>
        canResumeNow(run, run.status, getNoSessionPersistence(run.agent)),
    }),
  );

  const listEntries = $derived(workspaceView.entries);
  const capsule = $derived(workspaceView.capsule);
  const selectedCwd = $derived(workspaceInboxStore.selectedCwd);

  const gitSnapshot = $derived.by(() => {
    const key = normalizeCwd(selectedCwd);
    if (!key) return null;
    return workspaceInboxStore.gitByCwd[key] ?? null;
  });

  function readStringList(key: string): string[] {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((item): item is string => typeof item === "string");
    } catch {
      return [];
    }
  }

  function readPreferredCwd(): string {
    try {
      return normalizeCwd(localStorage.getItem(LS_PROJECT_CWD) ?? "");
    } catch {
      return "";
    }
  }

  function selectWorkspace(cwd: string): void {
    const normalized = normalizeCwd(cwd);
    workspaceInboxStore.selectCwd(normalized);
    try {
      localStorage.setItem(LS_PROJECT_CWD, normalized);
    } catch {
      // ignore storage failures
    }
    if (normalized) {
      void workspaceInboxStore.ensureGitSummary(normalized);
    }
  }

  function openChat(href: string): void {
    void goto(href);
  }

  onMount(() => {
    workspaceInboxStore.init();
    pinnedCwds = readStringList(LS_PINNED_CWDS).map(normalizeCwd);
    removedCwds = readStringList(LS_REMOVED_CWDS).map(normalizeCwd);

    void (async () => {
      try {
        settings = await getUserSettings();
      } catch {
        settings = null;
      }
      await workspaceInboxStore.refreshRuns();
      try {
        await attentionQueueStore.reconcile();
        await attentionQueueStore.loadSnapshot();
      } catch {
        // Attention queue is desktop-only; browser transport may not expose it yet.
      }
    })();
  });

  $effect(() => {
    if (workspaceInboxStore.loading) return;
    if (listEntries.length === 0) return;
    const selectedStillExists = listEntries.some((entry) => entry.cwd === selectedCwd);
    if (selectedStillExists) return;
    const defaultCwd = findDefaultWorkspaceCwd(listEntries, readPreferredCwd());
    if (defaultCwd !== null) selectWorkspace(defaultCwd);
  });

  onDestroy(() => {
    workspaceInboxStore.dispose();
  });
</script>

<div class="flex h-full flex-col overflow-hidden">
  <div class="shrink-0 px-6 py-4">
    <h1 class="text-xl font-semibold text-sidebar-foreground">{t("workspace_title")}</h1>
    <p class="mt-1 text-sm text-sidebar-foreground/70">{t("workspace_subtitle")}</p>
  </div>

  {#if workspaceInboxStore.error}
    <div
      class="mx-6 mt-4 flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
    >
      <span>{t("workspace_load_failed")}</span>
      <button
        type="button"
        class="shrink-0 rounded-md border border-destructive/30 px-2.5 py-1 text-xs font-medium transition-colors hover:bg-destructive/10 disabled:opacity-60"
        disabled={workspaceInboxStore.loading}
        onclick={() => workspaceInboxStore.refreshRuns()}
      >
        {t("workspace_retry")}
      </button>
    </div>
  {/if}

  <AttentionQueuePanel />

  <div class="min-h-0 flex-1 overflow-hidden">
    {#if listEntries.length === 0 && !workspaceInboxStore.loading}
      <div class="flex h-full items-center justify-center p-6">
        <EmptyState
          iconName="layout"
          title={t("workspace_empty_title")}
          description={t("workspace_empty_desc")}
        />
      </div>
    {:else if !selectedCwd && listEntries.length > 0}
      <div class="flex h-full items-center justify-center p-6 text-sm text-sidebar-foreground/70">
        {t("workspace_select_hint")}
      </div>
    {:else}
      <WorkspaceCapsulePanel
        label={capsule.label}
        cwd={capsule.cwd}
        sessions={capsule.sessions}
        git={gitSnapshot}
        onOpenChat={openChat}
        onContinue={openChat}
      />
    {/if}
  </div>
</div>
