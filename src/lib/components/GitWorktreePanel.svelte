<script lang="ts">
  /**
   * Git + worktree 可视化：会话内 Git 状态、同款 worktree 列表、Project Root → 当前 worktree 的链路。
   * 设计沿袭历史 GitWorktreePanel（会话侧栏上下文），改用 i18n 与稍加强化的排版。
   */
  import type { WorktreeEntry } from "$lib/api";
  import {
    autoCommit as apiAutoCommit,
    createPullRequest as apiCreatePr,
    getGitBranch,
    getGitStatus,
    getGitSummary,
    listWorktrees,
  } from "$lib/api";
  import { t } from "$lib/i18n/index.svelte";
  import { showToast } from "$lib/stores/toast-store.svelte";

  interface Props {
    cwd?: string;
    worktreePath?: string | null;
    parentCwd?: string | null;
    worktreeBranch?: string | null;
    creationMode?: "single" | "worktree" | string | null;
  }

  let {
    cwd = "",
    worktreePath = null,
    parentCwd = null,
    worktreeBranch = null,
    creationMode = null,
  }: Props = $props();

  interface GitState {
    branch: string;
    isClean: boolean;
    changedFiles: number;
    worktrees: WorktreeEntry[];
    loading: boolean;
  }

  let gitState = $state<GitState>({
    branch: "",
    isClean: true,
    changedFiles: 0,
    worktrees: [],
    loading: false,
  });

  const effectiveCwd = $derived((worktreePath || cwd || "").trim());
  const listAnchor = $derived((parentCwd || cwd || "").trim());
  const isWorktreeSession = $derived(creationMode === "worktree");

  let showWorktreeList = $state(false);
  let commitMessage = $state("");
  let commitInputOpen = $state(false);
  let prBusy = $state(false);
  let commitBusy = $state(false);

  function pathTail(p: string): string {
    if (!p) return "";
    const norm = p.replace(/\\/g, "/");
    const segs = norm.split("/").filter(Boolean);
    return segs[segs.length - 1] ?? p;
  }

  const displayedBranch = $derived(gitState.branch || worktreeBranch?.trim() || "");

  const cardClass =
    "rounded-xl border border-border/35 bg-transparent overflow-hidden backdrop-blur-[2px]";
  const cardHdClass = "flex items-center gap-2 px-3 py-2 border-b border-border/25";

  async function loadGitState(path: string) {
    if (!path) return;
    gitState = { ...gitState, loading: true };
    try {
      const [branch, summary, statusOutput, worktrees] = await Promise.all([
        getGitBranch(path).catch(() => ""),
        getGitSummary(path).catch(() => null),
        getGitStatus(path).catch(() => ""),
        listAnchor
          ? listWorktrees(listAnchor).catch(() => [] as WorktreeEntry[])
          : Promise.resolve([]),
      ]);

      const isClean = !statusOutput.trim();
      const changedFiles = summary?.total_files ?? 0;

      gitState = {
        branch,
        isClean,
        changedFiles,
        worktrees,
        loading: false,
      };
    } catch {
      gitState = { ...gitState, loading: false };
    }
  }

  let _lastLoadKey = "";

  /** effective cwd / 列表锚点 / worktree 元数据变化时都刷新（避免只靠 cwd） */
  $effect(() => {
    const eff = effectiveCwd;
    const key = `${eff}|${listAnchor}|${String(creationMode ?? "")}|${worktreePath ?? ""}`;
    if (!eff || key === _lastLoadKey) return;
    _lastLoadKey = key;
    loadGitState(eff);
  });

  async function handleAutoCommit() {
    if (!effectiveCwd || commitBusy) return;
    const msg =
      commitMessage.trim() || `feat: update from MiWarp (${new Date().toISOString().slice(0, 10)})`;
    commitBusy = true;
    try {
      const res = await apiAutoCommit(effectiveCwd, msg);
      commitMessage = "";
      commitInputOpen = false;
      if (res.committed) {
        showToast(t("gitWorktree_commit_ok"), "success");
      } else {
        showToast(res.message || t("gitWorktree_commit_skip"), "info");
      }
      await loadGitState(effectiveCwd);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      commitBusy = false;
    }
  }

  async function handleCreatePr() {
    const br = displayedBranch || gitState.branch;
    if (!effectiveCwd || !br || prBusy) return;
    if (br.includes("(detached")) {
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
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      prBusy = false;
    }
  }
</script>

{#if effectiveCwd}
  <div class="space-y-2.5">
    <!-- Git -->
    <div class={cardClass}>
      <div class={cardHdClass}>
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
        <span class="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t("gitWorktree_heading")}
        </span>
        {#if isWorktreeSession}
          <span
            class="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-medium"
          >
            {t("gitWorktree_badge_worktree")}
          </span>
        {/if}
      </div>

      <div class="px-3 py-2 space-y-1.5">
        <div class="flex items-center gap-2">
          <span class="text-[11px] text-muted-foreground w-14 shrink-0"
            >{t("gitWorktree_branch")}</span
          >
          <span class="flex items-center gap-1.5 text-[11px] font-mono text-foreground min-w-0">
            {#if isWorktreeSession}
              <svg
                class="h-3 w-3 text-emerald-500 shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                aria-hidden="true"
              >
                <line x1="6" y1="3" x2="6" y2="15" />
                <circle cx="18" cy="6" r="3" />
                <circle cx="6" cy="18" r="3" />
                <path d="M18 9a9 9 0 0 1-9 9" />
              </svg>
            {/if}
            <span class="truncate">{displayedBranch || "—"}</span>
          </span>
        </div>

        {#if isWorktreeSession && worktreePath}
          <div class="flex items-center gap-2">
            <span class="text-[11px] text-muted-foreground w-14 shrink-0"
              >{t("gitWorktree_path")}</span
            >
            <span
              class="text-[10px] font-mono text-foreground/60 truncate flex-1"
              title={worktreePath}
            >
              {worktreePath}
            </span>
          </div>
        {/if}

        <div class="flex items-center gap-2">
          <span class="text-[11px] text-muted-foreground w-14 shrink-0"
            >{t("gitWorktree_status")}</span
          >
          <span class="flex flex-wrap items-center gap-1.5">
            {#if gitState.loading}
              <span class="flex items-center gap-1 text-[11px] text-muted-foreground">
                <span class="h-1.5 w-1.5 rounded-full bg-muted-foreground/40 animate-pulse"></span>
                {t("gitWorktree_loading")}
              </span>
            {:else if gitState.isClean}
              <span class="flex items-center gap-1 text-[11px] text-emerald-500">
                <span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                {t("gitWorktree_clean")}
              </span>
            {:else}
              <span class="flex items-center gap-1 text-[11px] text-amber-500">
                <span class="h-1.5 w-1.5 rounded-full bg-amber-500"></span>
                {t("gitWorktree_modified")}
              </span>
              {#if gitState.changedFiles > 0}
                <span class="text-[10px] text-muted-foreground">
                  ({gitState.changedFiles}
                  {gitState.changedFiles === 1
                    ? t("gitWorktree_file_one")
                    : t("gitWorktree_file_many")})
                </span>
              {/if}
            {/if}
          </span>
        </div>
      </div>

      {#if !gitState.loading}
        <div class="flex flex-wrap items-center gap-1 px-3 py-2 border-t border-border/25">
          {#if !gitState.isClean}
            {#if commitInputOpen}
              <input
                bind:value={commitMessage}
                placeholder={t("gitWorktree_commit_placeholder")}
                class="flex-1 min-w-[8rem] text-[10px] px-2 py-1 rounded border border-border bg-background"
              />
              <button
                type="button"
                class="text-[10px] px-2 py-1 rounded bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/30 transition-colors disabled:opacity-40"
                onclick={handleAutoCommit}
                disabled={commitBusy}
              >
                {t("gitWorktree_commit_btn")}
              </button>
              <button
                type="button"
                class="text-[10px] px-2 py-1 rounded text-muted-foreground hover:bg-accent transition-colors"
                onclick={() => (commitInputOpen = false)}
              >
                ✕
              </button>
            {:else}
              <button
                type="button"
                class="text-[10px] px-2 py-1 rounded bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/30 transition-colors"
                onclick={() => (commitInputOpen = true)}
              >
                {t("gitWorktree_auto_commit")}
              </button>
            {/if}
          {/if}

          {#if displayedBranch && !displayedBranch.includes("(detached)")}
            <button
              type="button"
              class="ml-auto text-[10px] px-2 py-1 rounded bg-blue-500/15 text-blue-600 dark:text-blue-400 hover:bg-blue-500/25 transition-colors disabled:opacity-40"
              onclick={handleCreatePr}
              disabled={prBusy}
            >
              {prBusy ? "…" : t("gitWorktree_create_pr")}
            </button>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Worktree 列表 -->
    {#if gitState.worktrees.length > 0}
      <div class={cardClass}>
        <button
          type="button"
          class="{cardHdClass} w-full text-left hover:bg-accent/15 transition-colors"
          onclick={() => (showWorktreeList = !showWorktreeList)}
        >
          <svg
            class="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform {showWorktreeList
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
          <span class="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("gitWorktree_all_worktrees", { count: String(gitState.worktrees.length) })}
          </span>
        </button>

        {#if showWorktreeList}
          <ul class="px-2.5 py-2 space-y-1 list-none">
            {#each gitState.worktrees as wt (wt.path)}
              {@const cur = !!(worktreePath && wt.path === worktreePath)}
              <li
                class="flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] {cur
                  ? 'bg-primary/15 ring-1 ring-primary/25'
                  : 'hover:bg-accent/20'} transition-colors"
              >
                <span
                  class="h-2 w-2 rounded-full shrink-0 {cur
                    ? 'bg-primary'
                    : 'bg-muted-foreground/35'}"
                ></span>
                <span class="flex-1 min-w-0">
                  <span class="font-mono text-foreground/85 truncate block">{wt.branch}</span>
                  <span class="text-[10px] text-muted-foreground/60 truncate block">{wt.path}</span>
                </span>
                {#if cur}
                  <span class="text-[9px] text-primary font-medium shrink-0"
                    >{t("gitWorktree_here")}</span
                  >
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    {/if}

    <!-- 会话链路：根目录 → 当前 worktree -->
    {#if isWorktreeSession && parentCwd && worktreePath}
      <div class={cardClass}>
        <div class={cardHdClass}>
          <svg
            class="h-3.5 w-3.5 shrink-0 text-muted-foreground"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"
          >
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
          <span class="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("gitWorktree_session_chain")}
          </span>
        </div>
        <div class="px-3 py-2 relative">
          <!-- 竖向导轨 -->
          <div
            class="absolute left-[1.125rem] top-3 bottom-3 w-px bg-border/50"
            aria-hidden="true"
          ></div>
          <!-- Project root -->
          <div class="relative flex items-center gap-2 text-[11px] pl-6">
            <span
              class="absolute left-2 top-1/2 -translate-y-1/2 h-2 w-2 rounded-full bg-blue-400 ring-2 ring-background"
              aria-hidden="true"
            ></span>
            <svg
              class="h-3 w-3 shrink-0 text-blue-400 -ml-0.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              aria-hidden="true"
            >
              <path
                d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"
              />
            </svg>
            <span class="text-muted-foreground truncate">{t("gitWorktree_project_root")}</span>
            <span
              class="text-[10px] text-muted-foreground/50 truncate font-mono ml-auto"
              title={parentCwd}>{pathTail(parentCwd)}</span
            >
          </div>

          <div class="relative flex justify-center py-1 pl-6">
            <svg
              class="h-3 w-3 text-muted-foreground/45"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              aria-hidden="true"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </div>

          <!-- Current worktree -->
          <div class="relative flex items-center gap-2 text-[11px] pl-6">
            <span
              class="absolute left-2 top-1/2 -translate-y-1/2 h-2 w-2 rounded-full bg-emerald-400 ring-2 ring-background"
              aria-hidden="true"
            ></span>
            <svg
              class="h-3 w-3 shrink-0 text-emerald-400 -ml-0.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              aria-hidden="true"
            >
              <line x1="6" y1="3" x2="6" y2="15" />
              <circle cx="18" cy="6" r="3" />
              <circle cx="6" cy="18" r="3" />
              <path d="M18 9a9 9 0 0 1-9 9" />
            </svg>
            <span class="text-foreground font-mono truncate flex-1 min-w-0"
              >{displayedBranch || "—"}</span
            >
            <span class="text-[10px] text-emerald-600/80 dark:text-emerald-400/80 shrink-0"
              >{t("gitWorktree_this_session")}</span
            >
          </div>
        </div>
      </div>
    {/if}
  </div>
{/if}
