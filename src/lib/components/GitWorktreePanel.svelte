<script lang="ts">
  /**
   * Git / Worktree panel — high-density commit timeline for the active worktree.
   * Optimized for narrow right-side panel with compact rows and minimal vertical space.
   */
  import type { GitTimelineEntry } from "$lib/types";
  import type { WorktreeEntry } from "$lib/api";
  import {
    autoCommit as apiAutoCommit,
    createPullRequest as apiCreatePr,
    getGitTimeline,
    listWorktrees,
    sendSessionMessage,
  } from "$lib/api";
  import GitWorktreeTimeline from "$lib/components/git/GitWorktreeTimeline.svelte";
  import GitBranchPill from "$lib/components/git/GitBranchPill.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import { slide } from "svelte/transition";
  import { showToast } from "$lib/stores/toast-store.svelte";
  import Icon from "$lib/components/Icon.svelte";

  interface Props {
    cwd?: string;
    worktreePath?: string | null;
    parentCwd?: string | null;
    worktreeBranch?: string | null;
    creationMode?: "single" | "worktree" | string | null;
    runId?: string;
    onViewChanges?: () => void;
  }

  let {
    cwd = "",
    worktreePath = null,
    parentCwd = null,
    worktreeBranch = null,
    creationMode = null,
    runId = "",
    onViewChanges,
  }: Props = $props();

  interface PanelState {
    isRepo: boolean;
    branch: string;
    isDetached: boolean;
    isClean: boolean;
    changedFiles: number;
    timeline: GitTimelineEntry[];
    worktrees: WorktreeEntry[];
    loading: boolean;
    error: string | null;
  }

  let panelState = $state<PanelState>({
    isRepo: true,
    branch: "",
    isDetached: false,
    isClean: true,
    changedFiles: 0,
    timeline: [],
    worktrees: [],
    loading: false,
    error: null,
  });

  const effectiveCwd = $derived((worktreePath || cwd || "").trim());
  const listAnchor = $derived((parentCwd || cwd || "").trim());
  const isWorktreeSession = $derived(creationMode === "worktree");
  const displayedBranch = $derived(panelState.branch || worktreeBranch?.trim() || "");
  const isDetached = $derived(panelState.isDetached);

  let showWorktreeList = $state(false);
  let prBusy = $state(false);
  let commitBusy = $state(false);
  let commitAndPushBusy = $state(false);
  let commitMessage = $state("");
  let showCommitInput = $state(false);

  let loadGen = 0;
  let _lastLoadKey = "";
  let _refreshInterval: ReturnType<typeof setInterval> | null = null;

  async function loadPanel(path: string, listPath: string) {
    if (!path) return;
    const gen = ++loadGen;
    panelState = { ...panelState, loading: true, error: null };

    try {
      const [timelineRes, worktrees] = await Promise.all([
        getGitTimeline(path, 12).catch((e) => {
          throw e instanceof Error ? e : new Error(String(e));
        }),
        listPath
          ? listWorktrees(listPath).catch(() => [] as WorktreeEntry[])
          : Promise.resolve([] as WorktreeEntry[]),
      ]);

      if (gen !== loadGen) return;

      panelState = {
        isRepo: timelineRes.is_repo,
        branch: timelineRes.branch,
        isDetached: timelineRes.is_detached,
        isClean: timelineRes.is_clean,
        changedFiles: timelineRes.changed_files,
        timeline: timelineRes.entries,
        worktrees,
        loading: false,
        error: null,
      };
    } catch (e) {
      if (gen !== loadGen) return;
      panelState = {
        ...panelState,
        loading: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  function refresh() {
    if (effectiveCwd) void loadPanel(effectiveCwd, listAnchor);
  }

  $effect(() => {
    const eff = effectiveCwd;
    const key = `${eff}|${listAnchor}|${String(creationMode ?? "")}|${worktreePath ?? ""}`;
    if (!eff || key === _lastLoadKey) return;
    _lastLoadKey = key;
    void loadPanel(eff, listAnchor);
  });

  // Periodic refresh every 30 seconds (not high-frequency, just keeping status updated)
  $effect(() => {
    if (!effectiveCwd) return;
    _refreshInterval = setInterval(() => {
      if (effectiveCwd) void loadPanel(effectiveCwd, listAnchor);
    }, 30_000);
    return () => {
      if (_refreshInterval) clearInterval(_refreshInterval);
    };
  });

  async function handleAutoCommit() {
    if (!effectiveCwd || commitBusy) return;
    const msg =
      commitMessage.trim() || `feat: update from MiWarp (${new Date().toISOString().slice(0, 10)})`;
    commitBusy = true;
    try {
      const res = await apiAutoCommit(effectiveCwd, msg);
      commitMessage = "";
      showCommitInput = false;
      if (res.committed) {
        showToast(t("gitWorktree_commit_ok"), "success");
      } else {
        showToast(res.message || t("gitWorktree_commit_skip"), "info");
      }
      await loadPanel(effectiveCwd, listAnchor);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      commitBusy = false;
    }
  }

  async function handleCommitAndPush() {
    if (!effectiveCwd || !runId || commitAndPushBusy) return;
    commitAndPushBusy = true;
    try {
      // Ask Claude to commit and push the changes via session message
      await sendSessionMessage(
        runId,
        `请对这个工作区的变更进行提交并推送。\n\n请执行以下步骤：\n1. 查看当前的变更状态（git status）\n2. 分析变更内容\n3. 根据变更内容撰写合适的提交信息（使用中文）\n4. 执行 git add、git commit（使用你撰写的提交信息）、git push\n\n如果没有任何变更需要提交，请直接说明。`,
      );
      showToast(t("gitWorktree_commit_push_started"), "success");
      // Refresh after a short delay to show the new commit
      setTimeout(() => {
        if (effectiveCwd) void loadPanel(effectiveCwd, listAnchor);
      }, 2000);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      commitAndPushBusy = false;
    }
  }

  async function handleCreatePr() {
    const br = displayedBranch || panelState.branch;
    if (!effectiveCwd || !br || prBusy) return;
    if (isDetached) {
      showToast(t("gitWorktree_pr_detached"), "error");
      return;
    }
    prBusy = true;
    try {
      const url = await apiCreatePr(effectiveCwd, br, "main");
      showToast(t("gitWorktree_pr_started"), "success");
      if (url.trim() && typeof window !== "undefined" && /^https?:\/\//i.test(url.trim())) {
        window.open(url.trim(), "_blank", "noopener,noreferrer");
      }
      await loadPanel(effectiveCwd, listAnchor);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      prBusy = false;
    }
  }

  const statusText = $derived.by(() => {
    if (panelState.loading) return t("gitWorktree_loading");
    if (!panelState.isRepo) return t("gitWorktree_not_repo");
    if (panelState.isClean) return t("gitWorktree_summary_clean");
    return t("gitWorktree_summary_dirty", { count: String(panelState.changedFiles) });
  });

  const statusClass = $derived.by(() => {
    if (panelState.loading || !panelState.isRepo) return "text-muted-foreground";
    return panelState.isClean ? "text-miwarp-status-success" : "text-miwarp-status-warning";
  });
</script>

{#if effectiveCwd}
  <div class="space-y-1.5">
    <!-- Compact header with flexible layout -->
    <div class="px-3 py-2 border-b border-border/30">
      <!-- Row 1: icon + heading + branch + WT badge + refresh -->
      <div class="flex items-center gap-2 h-[36px]">
        <!-- Git icon -->
        <Icon name="git-branch" size="sm" class="shrink-0 text-muted-foreground" />

        <!-- Heading -->
        <span
          class="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground shrink-0"
        >
          {t("gitWorktree_heading")}
        </span>

        <!-- Branch pill -->
        {#if displayedBranch && panelState.isRepo}
          <GitBranchPill name={displayedBranch} variant="current" maxWidth="5rem" />
        {/if}

        <!-- Worktree badge -->
        {#if isWorktreeSession}
          <span
            class="text-[9px] px-1 py-0.5 rounded bg-[hsl(var(--miwarp-status-success)/0.12)] text-miwarp-status-success font-medium shrink-0"
          >
            WT
          </span>
        {/if}

        <!-- Refresh button -->
        <button
          type="button"
          class="ml-auto rounded p-0.5 text-muted-foreground/60 hover:text-foreground hover:bg-accent/40 transition-colors disabled:opacity-40 shrink-0"
          title={t("gitWorktree_refresh")}
          aria-label={t("gitWorktree_refresh")}
          disabled={panelState.loading}
          onclick={refresh}
        >
          <svg
            class="h-3 w-3 {panelState.loading ? 'animate-spin' : ''}"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M21 12a9 9 0 0 0-9-9 3 3 0 0 0-2.83 2" />
            <path d="M3 12a9 9 0 0 0 9 9 3 3 0 0 0 2.83-2" />
            <path d="M12 3v4" />
            <path d="M12 21v-4" />
          </svg>
        </button>
      </div>

      <!-- Row 2: status line (when dirty or loading) -->
      {#if panelState.loading || !panelState.isClean}
        <div class="flex items-center justify-center gap-1.5 mt-1.5 text-[10px] {statusClass}">
          {#if panelState.loading}
            <span class="h-1.5 w-1.5 rounded-full bg-current animate-pulse"></span>
          {:else}
            <span class="h-1.5 w-1.5 rounded-full bg-current"></span>
          {/if}
          {statusText}
        </div>
      {/if}
    </div>

    <!-- Timeline section -->
    {#if !panelState.isRepo && !panelState.loading}
      <div class="px-3 py-3">
        <p class="text-[11px] text-muted-foreground">{t("gitWorktree_not_repo")}</p>
      </div>
    {:else}
      <GitWorktreeTimeline
        entries={panelState.timeline}
        loading={panelState.loading}
        error={panelState.error}
      />

      <!-- Bottom action bar: unified layout -->
      {#if panelState.isRepo && !panelState.loading}
        <div class="px-3 py-2 border-t border-border/20">
          <!-- Commit input row (when showing) -->
          {#if showCommitInput && !panelState.isClean}
            <div class="flex items-center gap-1.5 mb-2" transition:slide={{ duration: 200 }}>
              <input
                type="text"
                bind:value={commitMessage}
                placeholder={t("gitWorktree_commit_placeholder")}
                class="flex-1 min-w-0 h-7 rounded-md border border-border/50 bg-background px-2 text-[10px]"
              />
              <button
                type="button"
                class="h-7 rounded-md bg-[hsl(var(--miwarp-status-success)/0.15)] px-2.5 text-[10px] font-medium text-miwarp-status-success hover:bg-[hsl(var(--miwarp-status-success)/0.25)] transition-colors disabled:opacity-40"
                onclick={handleAutoCommit}
                disabled={commitBusy}
              >
                {commitBusy ? "…" : t("gitWorktree_commit_btn")}
              </button>
              <button
                type="button"
                class="h-7 rounded-md px-1.5 text-[10px] text-muted-foreground hover:bg-accent/50 transition-colors"
                onclick={() => (showCommitInput = false)}
              >
                ✕
              </button>
            </div>
          {/if}

          <!-- Action buttons row -->
          <div class="flex items-center justify-center gap-1.5 flex-wrap">
            <!-- View changes (only when dirty) -->
            {#if !panelState.isClean && onViewChanges}
              <button
                type="button"
                class="h-7 rounded-md border border-border/50 bg-background/70 px-2.5 text-[10px] font-medium text-foreground/80 hover:bg-accent/50 transition-colors"
                onclick={onViewChanges}
              >
                {t("gitWorktree_view_changes")}
              </button>
            {/if}

            <!-- Auto commit (only when dirty) -->
            {#if !panelState.isClean}
              <button
                type="button"
                class="h-7 rounded-md bg-[hsl(var(--miwarp-status-success)/0.12)] px-2.5 text-[10px] font-medium text-miwarp-status-success hover:bg-[hsl(var(--miwarp-status-success)/0.2)] transition-colors disabled:opacity-40"
                onclick={() => (showCommitInput = !showCommitInput)}
                disabled={commitBusy}
              >
                {showCommitInput ? "✕" : t("gitWorktree_auto_commit")}
              </button>
            {/if}

            <!-- Commit and Push via Claude (only when dirty and has active session) -->
            {#if !panelState.isClean && runId}
              <button
                type="button"
                class="h-7 rounded-md bg-[hsl(var(--miwarp-accent-primary)/0.12)] px-2.5 text-[10px] font-medium text-miwarp-accent-primary hover:bg-[hsl(var(--miwarp-accent-primary)/0.2)] transition-colors disabled:opacity-40"
                onclick={handleCommitAndPush}
                disabled={commitAndPushBusy}
              >
                {commitAndPushBusy ? "…" : t("gitWorktree_commit_push")}
              </button>
            {/if}

            <!-- Create PR (always available when on a branch) -->
            {#if displayedBranch && !isDetached}
              <button
                type="button"
                class="h-7 rounded-md bg-[hsl(var(--miwarp-status-info)/0.12)] px-2.5 text-[10px] font-medium text-miwarp-status-info hover:bg-[hsl(var(--miwarp-status-info)/0.2)] transition-colors disabled:opacity-40"
                onclick={handleCreatePr}
                disabled={prBusy}
              >
                {prBusy ? "…" : t("gitWorktree_create_pr")}
              </button>
            {/if}
          </div>
        </div>
      {/if}
    {/if}

    <!-- Worktree list: collapsible -->
    {#if panelState.worktrees.length > 0}
      <div class="border-t border-border/20">
        <button
          type="button"
          class="flex w-full items-center gap-2 px-3 py-1.5 hover:bg-accent/20 transition-colors"
          onclick={() => (showWorktreeList = !showWorktreeList)}
        >
          <Icon
            name="chevron-right"
            size="xs"
            class="shrink-0 text-muted-foreground/60 transition-transform {showWorktreeList
              ? 'rotate-90'
              : ''}"
          />
          <span class="text-[10px] font-medium text-muted-foreground/70">
            {t("gitWorktree_all_worktrees", { count: String(panelState.worktrees.length) })}
          </span>
        </button>

        {#if showWorktreeList}
          <ul class="px-3 pb-1.5 space-y-0.5 list-none" transition:slide={{ duration: 200 }}>
            {#each panelState.worktrees as wt (wt.path)}
              {@const cur = !!(worktreePath && wt.path === worktreePath)}
              <li
                class="flex items-center gap-2 rounded px-1.5 py-1 text-[10px] {cur
                  ? 'bg-primary/10 text-primary'
                  : 'hover:bg-accent/20 text-muted-foreground/70'} transition-colors"
              >
                <span
                  class="h-1.5 w-1.5 rounded-full shrink-0 {cur
                    ? 'bg-primary'
                    : 'bg-muted-foreground/30'}"
                ></span>
                <span class="font-mono truncate flex-1">{wt.branch}</span>
                <span class="text-muted-foreground/40 truncate">{wt.path.split("/").pop()}</span>
                {#if cur}
                  <span class="text-[9px] font-medium shrink-0">here</span>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    {/if}
  </div>
{/if}
