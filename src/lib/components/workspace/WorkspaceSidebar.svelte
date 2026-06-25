<script lang="ts">
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";
  import WorkspaceListPanel from "$lib/components/workspace/WorkspaceListPanel.svelte";
  import { getNoSessionPersistence } from "$lib/stores/agent-settings-cache.svelte";
  import { hasAttention } from "$lib/stores/attention-store.svelte";
  import { attentionQueueStore } from "$lib/stores/attention-queue-store.svelte";
  import { canResumeNow } from "$lib/stores/types";
  import type { TaskRun, UserSettings } from "$lib/types";
  import { LS_PINNED_CWDS, LS_PROJECT_CWD, LS_REMOVED_CWDS } from "$lib/utils/storage-keys";
  import { normalizeCwd } from "$lib/utils/sidebar-groups";
  import { buildWorkspaceView, findDefaultWorkspaceCwd } from "$lib/workspace/selectors";
  import { workspaceInboxStore } from "$lib/workspace/workspace-inbox-store.svelte";

  let {
    settings = null,
  }: {
    settings?: UserSettings | null;
  } = $props();

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
  const selectedCwd = $derived(workspaceInboxStore.selectedCwd);

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

  onMount(() => {
    workspaceInboxStore.init();
    pinnedCwds = readStringList(LS_PINNED_CWDS).map(normalizeCwd);
    removedCwds = readStringList(LS_REMOVED_CWDS).map(normalizeCwd);
    void workspaceInboxStore.refreshRuns();
    void attentionQueueStore
      .reconcile()
      .then(() => attentionQueueStore.loadSnapshot())
      .catch(() => {
        // Attention queue is desktop-only in some transports.
      });
  });

  $effect(() => {
    if (workspaceInboxStore.loading) return;
    if (listEntries.length === 0) return;
    const selectedStillExists = listEntries.some((entry) => entry.cwd === selectedCwd);
    if (selectedStillExists) return;
    const defaultCwd = findDefaultWorkspaceCwd(listEntries, readPreferredCwd());
    if (defaultCwd !== null) selectWorkspace(defaultCwd);
  });

  function openWorkspace(cwd: string) {
    selectWorkspace(cwd);
    void goto("/workspace", { replaceState: false, noScroll: true, keepFocus: true });
  }
</script>

<WorkspaceListPanel
  entries={listEntries}
  {selectedCwd}
  loading={workspaceInboxStore.loading}
  onSelect={openWorkspace}
/>
