<script lang="ts">
  import * as api from "$lib/api";
  import type { WorktreeEntry } from "$lib/api";
  import { t } from "$lib/i18n/index.svelte";

  let {
    cwd = "",
    worktreePath,
    parentCwd,
    worktreeBranch,
    creationMode,
  }: {
    cwd?: string;
    worktreePath?: string;
    parentCwd?: string;
    worktreeBranch?: string;
    creationMode?: string;
  } = $props();

  interface GitState {
    branch: string;
    isClean: boolean;
    changedFiles: number;
    ahead: number;
    behind: number;
    lastCommitMessage?: string;
    lastCommitHash?: string;
    worktrees: WorktreeEntry[];
    loading: boolean;
  }

  let gitState = $state<GitState>({
    branch: "",
    isClean: true,
    changedFiles: 0,
    ahead: 0,
    behind: 0,
    worktrees: [],
    loading: false,
  });

  const effectiveCwd = $derived(worktreePath || cwd);

  $effect(() => {
    const path = effectiveCwd;
    if (!path) return;
    loadGitState(path);
  });

  async function loadGitState(path: string) {
    gitState = { ...gitState, loading: true };
    try {
      const [branch, summary, statusOutput] = await Promise.all([
        api.getGitBranch(path).catch(() => ""),
        api.getGitSummary(path).catch(() => null),
        api.getGitStatus(path).catch(() => ""),
      ]);

      const isClean = !statusOutput.trim();
      const changedFiles = summary?.total_files ?? 0;

      // Get worktrees if we have a parent cwd (meaning we're in a worktree)
      let worktrees: WorktreeEntry[] = [];
      if (parentCwd) {
        worktrees = await api.listWorktrees(parentCwd).catch(() => []);
      }

      gitState = {
        branch,
        isClean,
        changedFiles,
        ahead: 0,
        behind: 0,
        worktrees,
        loading: false,
      };
    } catch {
      gitState = { ...gitState, loading: false };
    }
  }

  let showWorktreeList = $state(false);
  let commitMessage = $state("");
  let commitInputOpen = $state(false);

  async function handleAutoCommit() {
    if (!effectiveCwd) return;
    const msg = commitMessage || `feat: update from MiWarp`;
    commitMessage = "";
    commitInputOpen = false;
    await api.autoCommit(effectiveCwd, msg);
    await loadGitState(effectiveCwd);
  }

  async function handleCreatePr() {
    if (!effectiveCwd || !gitState.branch) return;
    await api.createPullRequest(effectiveCwd, gitState.branch, "main");
  }

  const cardClass = "rounded-xl border border-border/35 overflow-hidden bg-transparent";
  const cardHdClass = "flex items-center gap-2 px-3 py-2 border-b border-border/25";
</script>

{#if effectiveCwd}
  <div class="space-y-2.5">
    <!-- Git Status Card -->
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
        >
          <line x1="6" y1="3" x2="6" y2="15" />
          <circle cx="18" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
          <path d="M18 9a9 9 0 0 1-9 9" />
        </svg>
        <span class="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Git / Worktree
        </span>
        {#if creationMode === "worktree"}
          <span
            class="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-500 font-medium"
          >
            Worktree
          </span>
        {/if}
      </div>

      <div class="px-3 py-2 space-y-1.5">
        <!-- Branch row -->
        <div class="flex items-center gap-2">
          <span class="text-[11px] text-muted-foreground w-14 shrink-0">Branch</span>
          <span class="flex items-center gap-1.5 text-[11px] font-mono text-foreground">
            {#if creationMode === "worktree"}
              <svg
                class="h-3 w-3 text-emerald-500 shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <line x1="6" y1="3" x2="6" y2="15" />
                <circle cx="18" cy="6" r="3" />
                <circle cx="6" cy="18" r="3" />
                <path d="M18 9a9 9 0 0 1-9 9" />
              </svg>
            {/if}
            {gitState.branch || "—"}
          </span>
        </div>

        <!-- Worktree path row -->
        {#if creationMode === "worktree" && worktreePath}
          <div class="flex items-center gap-2">
            <span class="text-[11px] text-muted-foreground w-14 shrink-0">Path</span>
            <span class="text-[10px] font-mono text-foreground/50 truncate" title={worktreePath}>
              {worktreePath}
            </span>
          </div>
        {/if}

        <!-- Git status row -->
        <div class="flex items-center gap-2">
          <span class="text-[11px] text-muted-foreground w-14 shrink-0">Status</span>
          <span class="flex items-center gap-1.5">
            {#if gitState.loading}
              <span class="flex items-center gap-1 text-[11px] text-muted-foreground">
                <span class="h-1.5 w-1.5 rounded-full bg-muted-foreground/40 animate-pulse"></span>
                Loading...
              </span>
            {:else if gitState.isClean}
              <span class="flex items-center gap-1 text-[11px] text-emerald-500">
                <span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                Clean
              </span>
            {:else}
              <span class="flex items-center gap-1 text-[11px] text-amber-500">
                <span class="h-1.5 w-1.5 rounded-full bg-amber-500"></span>
                Modified
              </span>
              {#if gitState.changedFiles > 0}
                <span class="text-[10px] text-muted-foreground">
                  ({gitState.changedFiles}
                  {gitState.changedFiles === 1 ? "file" : "files"})
                </span>
              {/if}
            {/if}
          </span>
        </div>
      </div>

      <!-- Actions -->
      {#if !gitState.loading}
        <div class="flex items-center gap-1 px-3 py-2 border-t border-border/25">
          {#if !gitState.isClean}
            {#if commitInputOpen}
              <input
                bind:value={commitMessage}
                placeholder="commit message..."
                class="flex-1 text-[10px] px-2 py-1 rounded border border-border bg-background"
              />
              <button
                class="text-[10px] px-2 py-1 rounded bg-emerald-500/20 text-emerald-500 hover:bg-emerald-500/30 transition-colors"
                onclick={handleAutoCommit}
              >
                Commit
              </button>
              <button
                class="text-[10px] px-2 py-1 rounded text-muted-foreground hover:bg-accent transition-colors"
                onclick={() => (commitInputOpen = false)}
              >
                ✕
              </button>
            {:else}
              <button
                class="text-[10px] px-2 py-1 rounded bg-emerald-500/20 text-emerald-500 hover:bg-emerald-500/30 transition-colors"
                onclick={() => (commitInputOpen = true)}
              >
                Auto Commit
              </button>
            {/if}
          {/if}

          {#if gitState.branch && !gitState.branch.includes("(detached)")}
            <button
              class="ml-auto text-[10px] px-2 py-1 rounded bg-blue-500/20 text-blue-500 hover:bg-blue-500/30 transition-colors"
              onclick={handleCreatePr}
            >
              Create PR
            </button>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Worktree List Card -->
    {#if gitState.worktrees.length > 0}
      <div class={cardClass}>
        <button
          class={cardHdClass + " w-full hover:bg-accent/10 transition-colors"}
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
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
          <span class="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            All Worktrees ({gitState.worktrees.length})
          </span>
        </button>

        {#if showWorktreeList}
          <div class="px-2.5 py-2 space-y-1">
            {#each gitState.worktrees as wt}
              {@const isCurrent = wt.path === worktreePath}
              <div
                class="flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] {isCurrent
                  ? 'bg-accent/30'
                  : 'hover:bg-accent/20'} transition-colors"
              >
                <span
                  class="h-2 w-2 rounded-full shrink-0 {isCurrent
                    ? 'bg-primary'
                    : 'bg-muted-foreground/30'}"
                ></span>
                <span class="flex-1 min-w-0">
                  <span class="font-mono text-foreground/80 truncate block">{wt.branch}</span>
                  <span class="text-[10px] text-muted-foreground/50 truncate block">{wt.path}</span>
                </span>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    <!-- Worktree Chain -->
    {#if creationMode === "worktree" && parentCwd}
      <div class={cardClass}>
        <div class={cardHdClass}>
          <svg
            class="h-3.5 w-3.5 shrink-0 text-muted-foreground"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
          <span class="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Session Chain
          </span>
        </div>
        <div class="px-3 py-2 space-y-1.5">
          <!-- Project Root -->
          <div class="flex items-center gap-2 text-[11px]">
            <svg
              class="h-3 w-3 shrink-0 text-blue-400"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path
                d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"
              />
            </svg>
            <span class="text-muted-foreground truncate">Project Root</span>
            <span class="text-[10px] text-muted-foreground/50 truncate font-mono ml-auto"
              >{parentCwd.split("/").pop()}</span
            >
          </div>

          <div class="flex items-center justify-center">
            <svg
              class="h-3 w-3 text-muted-foreground/40"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </div>

          <!-- Current Worktree -->
          <div class="flex items-center gap-2 text-[11px]">
            <svg
              class="h-3 w-3 shrink-0 text-emerald-400"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <line x1="6" y1="3" x2="6" y2="15" />
              <circle cx="18" cy="6" r="3" />
              <circle cx="6" cy="18" r="3" />
              <path d="M18 9a9 9 0 0 1-9 9" />
            </svg>
            <span class="text-foreground font-mono truncate">{gitState.branch || "—"}</span>
            <span class="text-[10px] text-emerald-500/70 ml-auto">This Session</span>
          </div>
        </div>
      </div>
    {/if}
  </div>
{/if}
