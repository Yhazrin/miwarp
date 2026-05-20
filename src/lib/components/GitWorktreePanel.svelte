<script lang="ts">
  /**
   * Git / Worktree panel — high-density commit timeline for the active worktree.
   * Optimized for narrow right-side panel with compact rows and minimal vertical space.
   */
  import type { GitTimelineEntry, GitTimelineResponse } from "$lib/types";
  import type { WorktreeEntry } from "$lib/api";
  import {
    autoCommit as apiAutoCommit,
    createPullRequest as apiCreatePr,
    getGitTimeline,
    listWorktrees,
  } from "$lib/api";
  import GitWorktreeTimeline from "$lib/components/git/GitWorktreeTimeline.svelte";
  import GitBranchPill from "$lib/components/git/GitBranchPill.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import { showToast } from "$lib/stores/toast-store.svelte";

  interface Props {
    cwd?: string;
    worktreePath?: string | null;
    parentCwd?: string | null;
    worktreeBranch?: string | null;
    creationMode?: "single" | "worktree" | string | null;
    onViewChanges?: () => void;
  }

  let {
    cwd = "",
    worktreePath = null,
    parentCwd = null,
    worktreeBranch = null,
    creationMode = null,
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
  let commitMessage = $state("");
  let showCommitInput = $state(false);

  let loadGen = 0;
  let _lastLoadKey = "";

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
    return panelState.isClean ? "text-emerald-500" : "text-amber-500";
  });
</script>

{#if effectiveCwd}
  <div class="space-y-1.5">
    <!-- Compact header with flexible layout -->
    <div class="px-3 py-2 border-b border-border/30">
      <!-- Row 1: icon + heading + branch + WT badge + refresh -->
      <div class="flex items-center gap-2">
        <!-- Git icon -->
        <svg
          class="h-3.5 w-3.5 shrink-0 text-muted-foreground"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <line x1="6" y1="3" x2="6" y2="15" />
          <circle cx="18" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
          <path d="M18 9a9 9 0 0 1-9 9" />
        </svg>

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
            class="text-[9px] px-1 py-0.5 rounded bg-emerald-500/12 text-emerald-600 dark:text-emerald-400 font-medium shrink-0"
          >
            WT
          </span>
        {/if}

        <!-- Refresh button -->
        <button
          type="button"
          class="ml-auto rounded p-0.5 text-muted-foreground/60 hover:text-foreground hover:bg-accent/40 transition-colors disabled:opacity-40 shrink-0"
          title={t("gitWorktree_refresh")}
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
            <div class="flex items-center gap-1.5 mb-2">
              <input
                type="text"
                bind:value={commitMessage}
                placeholder={t("gitWorktree_commit_placeholder")}
                class="flex-1 min-w-0 h-7 rounded-md border border-border/50 bg-background px-2 text-[10px]"
              />
              <button
                type="button"
                class="h-7 rounded-md bg-emerald-500/15 px-2.5 text-[10px] font-medium text-emerald-600 hover:bg-emerald-500/25 transition-colors disabled:opacity-40"
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
          <div class="flex items-center gap-1.5">
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
                class="h-7 rounded-md bg-emerald-500/12 px-2.5 text-[10px] font-medium text-emerald-600 hover:bg-emerald-500/20 transition-colors disabled:opacity-40"
                onclick={() => (showCommitInput = !showCommitInput)}
                disabled={commitBusy}
              >
                {showCommitInput ? "✕" : t("gitWorktree_auto_commit")}
              </button>
            {/if}

            <!-- Create PR (always available when on a branch) -->
            {#if displayedBranch && !isDetached}
              <button
                type="button"
                class="h-7 rounded-md bg-blue-500/12 px-2.5 text-[10px] font-medium text-blue-600 hover:bg-blue-500/20 transition-colors disabled:opacity-40 ml-auto"
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
          <svg
            class="h-3 w-3 shrink-0 text-muted-foreground/60 transition-transform {showWorktreeList
              ? 'rotate-90'
              : ''}"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
          <span class="text-[10px] font-medium text-muted-foreground/70">
            {t("gitWorktree_all_worktrees", { count: String(panelState.worktrees.length) })}
          </span>
        </button>

        {#if showWorktreeList}
          <ul class="px-3 pb-1.5 space-y-0.5 list-none">
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
