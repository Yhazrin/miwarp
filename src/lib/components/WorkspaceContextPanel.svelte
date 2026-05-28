<script lang="ts">
  import type { SessionInfoData } from "$lib/types";
  import { t } from "$lib/i18n/index.svelte";
  import { memoryStore } from "$lib/stores/memory-store.svelte";
  import { parseMemoryItems } from "$lib/utils/memory-items";
  import { sortByDisplayPriority } from "$lib/utils/memory-helpers";
  import * as api from "$lib/api";
  import GitWorktreePanel from "$lib/components/GitWorktreePanel.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import type { ProcessVisibility } from "$lib/utils/process-visibility";

  let {
    cwd = "",
    runId = "",
    sessionInfo = null,
    toolStats,
    onSwitchToActivity,
    onSwitchToFiles,
    worktreePath = null,
    parentCwd = null,
    worktreeBranch = null,
    creationMode = null,
    processVisibility = "developer" as ProcessVisibility,
  }: {
    cwd?: string;
    runId?: string;
    sessionInfo?: SessionInfoData | null;
    toolStats: {
      totalToolCount: number;
      reads: number;
      searches: number;
      bash: number;
      writes: number;
      errorCount: number;
    };
    onSwitchToActivity?: () => void;
    onSwitchToFiles?: () => void;
    worktreePath?: string | null;
    parentCwd?: string | null;
    worktreeBranch?: string | null;
    creationMode?: "single" | "worktree" | string | null;
    processVisibility?: ProcessVisibility;
  } = $props();

  // ── CLAUDE.md state ──
  let claudeMdContent = $state("");
  let claudeMdPath = $state("");
  let claudeMdLoading = $state(false);
  let claudeMdExpanded = $state(false);
  let claudeMdExists = $state(false);

  // ── Memory state ──
  let memoryLoading = $state(false);
  let expandedMemory = $state(new Set<string>());

  // ── Load CLAUDE.md and memory when cwd changes ──
  let _lastCwd = "";
  $effect(() => {
    const c = cwd;
    if (c && c !== _lastCwd) {
      _lastCwd = c;
      loadWorkspaceContext(c);
    }
  });

  async function loadWorkspaceContext(dir: string) {
    // Load memory candidates
    memoryLoading = true;
    try {
      await memoryStore.loadCandidates(dir);
      // Load content for existing project files
      const projectExisting = memoryStore.candidates.filter(
        (f) => f.scope === "project" && f.exists,
      );
      const claudeMd = projectExisting.find((f) => f.label === "CLAUDE.md");
      if (claudeMd) {
        claudeMdPath = claudeMd.path;
        claudeMdExists = true;
        claudeMdLoading = true;
        try {
          claudeMdContent = await api.readTextFile(claudeMd.path, dir);
        } catch {
          claudeMdContent = "";
        }
        claudeMdLoading = false;
      } else {
        claudeMdPath = "";
        claudeMdExists = false;
        claudeMdContent = "";
      }
      // Load memory file content for display
      await loadMemoryContent(dir);
    } catch {
      // ignore
    }
    memoryLoading = false;
  }

  // Memory file contents for display
  let memoryFileContents = $state<Array<{ label: string; content: string; path: string }>>([]);

  async function loadMemoryContent(dir: string) {
    const existing = memoryStore.candidates.filter((f) => f.exists);
    const sorted = sortByDisplayPriority(existing);
    const results: Array<{ label: string; content: string; path: string }> = [];

    // Load memory-scope files (auto-memory files, up to 5)
    const memoryScopeFiles = sorted.filter((f) => f.scope === "memory").slice(0, 5);
    // Also include project-scope files (e.g. CLAUDE.md) that have memory-like content
    const projectScopeFiles = sorted.filter((f) => f.scope === "project" && f.exists).slice(0, 3);
    const allFiles = [...memoryScopeFiles, ...projectScopeFiles];

    for (const file of allFiles) {
      try {
        const content = await api.readTextFile(file.path, dir);
        if (content.trim()) {
          results.push({ label: file.label, content, path: file.path });
        }
      } catch {
        // skip unreadable files
      }
    }
    memoryFileContents = results;
  }

  // ── Derived: parsed memory items ──
  let memoryItems = $derived.by(() => {
    const all: Array<{ id: string; text: string; source: string }> = [];
    for (const file of memoryFileContents) {
      const items = parseMemoryItems(file.content);
      for (const item of items) {
        all.push({ ...item, source: file.label });
      }
    }
    return all;
  });

  // ── Derived: CLAUDE.md summary (heuristic, no LLM) ──
  let claudeMdSummary = $derived.by(() => {
    if (!claudeMdContent) return [];
    const lines = claudeMdContent.split("\n");
    const summary: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // Collect headings
      if (/^#{1,6}\s+/.test(trimmed)) {
        summary.push(trimmed.replace(/^#{1,6}\s+/, "").slice(0, 120));
        if (summary.length >= 6) break;
        continue;
      }
      // Collect bullet items
      const bulletMatch = trimmed.match(/^[-*]\s+(.+)/);
      if (bulletMatch) {
        summary.push(bulletMatch[1].slice(0, 120));
        if (summary.length >= 6) break;
      }
    }
    return summary;
  });

  let minimalOutputWorkspace = $derived(processVisibility === "output");

  // ── Copy single memory item ──
  function copyItem(text: string) {
    navigator.clipboard.writeText(text).catch(() => {});
  }

  // ── Open CLAUDE.md in files tab ──
  function openClaudeMd() {
    if (onSwitchToFiles) onSwitchToFiles();
  }
</script>

<div class="flex flex-col h-full overflow-y-auto scrollbar-hide">
  {#if !cwd}
    <!-- No workspace selected -->
    <div class="flex flex-col items-center justify-center h-full px-6 text-center">
      <svg
        class="h-10 w-10 text-muted-foreground/20 mb-3"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
      <p class="text-xs text-muted-foreground/60">{t("workspaceContext_noWorkspace")}</p>
    </div>
  {:else}
    <div class="p-4 space-y-4">
      {#if minimalOutputWorkspace}
        <p
          class="text-[11px] text-muted-foreground rounded-lg border border-border/30 bg-muted/20 px-2 py-1.5 leading-relaxed"
        >
          {t("workspaceContext_outputMinimalHint")}
        </p>
      {/if}
      <!-- Instructions / CLAUDE.md card -->
      {#if !minimalOutputWorkspace}
        <div class="rounded-xl border border-border/40 bg-background/40 overflow-hidden px-3 pt-3">
          <div class="flex items-center gap-2 h-[48px]">
            <svg
              class="h-3.5 w-3.5 text-muted-foreground shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
            <span class="text-[11px] font-semibold text-foreground">
              {t("workspaceContext_claudeMd")}
            </span>
            {#if claudeMdExists}
              <span
                class="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-[hsl(var(--miwarp-status-success)/0.15)] text-[hsl(var(--miwarp-status-success))] font-medium"
              >
                {t("workspaceContext_active")}
              </span>
            {/if}
          </div>

          {#if claudeMdLoading}
            <div class="px-3 pb-2">
              <div class="h-3 w-3/4 rounded bg-muted/50 animate-pulse"></div>
              <div class="h-3 w-1/2 rounded bg-muted/50 animate-pulse mt-1.5"></div>
            </div>
          {:else if claudeMdExists && claudeMdSummary.length > 0}
            <div class="px-3 pb-2 space-y-1">
              {#each claudeMdSummary.slice(0, claudeMdExpanded ? undefined : 3) as rule, i (i)}
                <p class="text-[11px] text-foreground/70 leading-relaxed line-clamp-2">{rule}</p>
              {/each}
              {#if claudeMdSummary.length > 3}
                <button
                  class="text-[10px] text-primary/70 hover:text-primary transition-colors mt-0.5"
                  onclick={() => (claudeMdExpanded = !claudeMdExpanded)}
                >
                  {claudeMdExpanded
                    ? t("workspaceContext_collapse")
                    : t("workspaceContext_expandAll", { count: String(claudeMdSummary.length) })}
                </button>
              {/if}
            </div>
            <div class="flex items-center gap-2 px-3 py-1.5 border-t border-border/30">
              <span class="text-[10px] text-muted-foreground/50 truncate flex-1"
                >{claudeMdPath.split("/").pop()}</span
              >
              <button
                class="text-[10px] text-primary/60 hover:text-primary transition-colors shrink-0"
                onclick={openClaudeMd}
              >
                {t("workspaceContext_openFile")}
              </button>
            </div>
          {:else}
            <div class="px-3 pb-2">
              <p class="text-[11px] text-muted-foreground/50">{t("workspaceContext_noClaudeMd")}</p>
              <button
                class="text-[10px] text-primary/60 hover:text-primary transition-colors mt-1"
                onclick={onSwitchToFiles}
              >
                {t("workspaceContext_createClaudeMd")}
              </button>
            </div>
          {/if}
        </div>

        <!-- Memory card -->
        <div class="rounded-xl border border-border/40 bg-background/40 overflow-hidden px-3 pt-3">
          <div class="flex items-center gap-2 h-[48px]">
            <svg
              class="h-3.5 w-3.5 text-muted-foreground shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M12 2a10 10 0 1 0 10 10H12V2z" />
              <path d="M12 2a10 10 0 0 1 10 10" />
              <circle cx="12" cy="12" r="6" />
            </svg>
            <span class="text-[11px] font-semibold text-foreground">
              {t("workspaceContext_memory")}
            </span>
            {#if memoryItems.length > 0}
              <span
                class="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
              >
                {memoryItems.length}
              </span>
            {/if}
          </div>

          {#if memoryLoading}
            <div class="px-3 pb-2 space-y-1.5">
              <div class="h-3 w-full rounded bg-muted/50 animate-pulse"></div>
              <div class="h-3 w-2/3 rounded bg-muted/50 animate-pulse"></div>
            </div>
          {:else if memoryItems.length > 0}
            <div class="px-2.5 pb-2 space-y-1 max-h-60 overflow-y-auto scrollbar-hide">
              {#each memoryItems as item (item.id)}
                <div
                  class="group flex items-start gap-1.5 rounded-lg px-2 py-1.5 hover:bg-accent/30 transition-colors"
                >
                  <span class="text-[10px] text-muted-foreground/40 mt-0.5 shrink-0">&#x2022;</span>
                  <p
                    class="text-[11px] text-foreground/70 leading-relaxed flex-1 min-w-0 {expandedMemory.has(
                      item.id,
                    )
                      ? ''
                      : 'line-clamp-2'}"
                  >
                    {item.text}
                  </p>
                  <div
                    class="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    {#if item.text.length > 80}
                      <button
                        class="text-[9px] text-muted-foreground/50 hover:text-foreground transition-colors"
                        onclick={() => {
                          if (expandedMemory.has(item.id)) {
                            expandedMemory.delete(item.id);
                          } else {
                            expandedMemory = new Set(expandedMemory).add(item.id);
                          }
                        }}
                      >
                        {expandedMemory.has(item.id) ? "Less" : "More"}
                      </button>
                    {/if}
                    <button
                      class="text-[9px] text-muted-foreground/50 hover:text-foreground transition-colors"
                      onclick={() => copyItem(item.text)}
                      title={t("workspaceContext_copyMemory")}
                    >
                      <Icon name="external-link" size="xs" />
                    </button>
                  </div>
                </div>
              {/each}
            </div>
          {:else}
            <div class="px-3 pb-2">
              <p class="text-[11px] text-muted-foreground/40">{t("workspaceContext_noMemory")}</p>
            </div>
          {/if}
        </div>
      {/if}

      <GitWorktreePanel
        {cwd}
        {worktreePath}
        {parentCwd}
        {worktreeBranch}
        {creationMode}
        {runId}
        {sessionInfo}
      />

      <!-- Recent Activity summary -->
      {#if !minimalOutputWorkspace}
        <div class="rounded-xl border border-border/40 bg-background/40 overflow-hidden px-3 pt-3">
          <div class="flex items-center gap-2 h-[48px]">
            <Icon name="wrench" size="sm" class="text-muted-foreground shrink-0" />
            <span class="text-[11px] font-semibold text-foreground">
              {t("workspaceContext_recentActivity")}
            </span>
            {#if toolStats.totalToolCount > 0}
              <button
                class="ml-auto text-[10px] text-primary/60 hover:text-primary transition-colors"
                onclick={() => onSwitchToActivity?.()}
              >
                {t("workspaceContext_viewActivity")}
              </button>
            {/if}
          </div>
          {#if toolStats.totalToolCount > 0}
            <div class="px-3 pb-2">
              <p class="text-[11px] text-foreground/60">
                {t("workspaceContext_toolSummary", {
                  total: String(toolStats.totalToolCount),
                  reads: String(toolStats.reads),
                  bash: String(toolStats.bash),
                  writes: String(toolStats.writes),
                })}
              </p>
            </div>
          {:else}
            <div class="px-3 pb-2">
              <p class="text-[11px] text-muted-foreground/40">{t("workspaceContext_noActivity")}</p>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>
