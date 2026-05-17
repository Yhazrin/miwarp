<script lang="ts">
  import type { MemoryFileCandidate, SessionInfoData, ContextSnapshot } from "$lib/types";
  import type { TurnUsage } from "$lib/stores/types";
  import { t } from "$lib/i18n/index.svelte";
  import { memoryStore } from "$lib/stores/memory-store.svelte";
  import { parseMemoryItems } from "$lib/utils/memory-items";
  import { sortByDisplayPriority } from "$lib/utils/memory-helpers";
  import { formatTokenCount } from "$lib/utils/format";
  import * as api from "$lib/api";
  import ContextHistoryPanel from "$lib/components/ContextHistoryPanel.svelte";

  let {
    cwd = "",
    runId = "",
    sessionInfo = null,
    contextHistory = [],
    turnUsages = [],
    toolStats,
    onSwitchToActivity,
    onSwitchToFiles,
  }: {
    cwd?: string;
    runId?: string;
    sessionInfo?: SessionInfoData | null;
    contextHistory?: ContextSnapshot[];
    turnUsages?: TurnUsage[];
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
  let expandedMemoryFiles = $state(new Set<string>());

  type WorkspaceMemoryFile = {
    label: string;
    content: string;
    path: string;
    scope: MemoryFileCandidate["scope"];
  };

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
  let memoryFileContents = $state<WorkspaceMemoryFile[]>([]);

  async function loadMemoryContent(dir: string) {
    const existing = memoryStore.candidates.filter((f) => f.exists);
    const sorted = sortByDisplayPriority(existing);
    const results: WorkspaceMemoryFile[] = [];

    // Keep the right panel focused on "memory" rather than duplicating the Instructions card.
    const projectScopeFiles = sorted
      .filter((f) => f.scope === "project" && f.exists && f.label !== "CLAUDE.md")
      .slice(0, 3);
    const globalScopeFiles = sorted.filter((f) => f.scope === "global").slice(0, 2);
    const memoryScopeFiles = sorted.filter((f) => f.scope === "memory").slice(0, 5);
    const allFiles = [...projectScopeFiles, ...globalScopeFiles, ...memoryScopeFiles];

    for (const file of allFiles) {
      try {
        const content = await api.readTextFile(file.path, dir);
        if (content.trim()) {
          results.push({ label: file.label, content, path: file.path, scope: file.scope });
        }
      } catch {
        // skip unreadable files
      }
    }
    memoryFileContents = results;
  }

  // ── Derived: parsed memory items ──
  let memorySections = $derived.by(() => {
    return memoryFileContents
      .map((file) => {
        const items = parseMemoryItems(file.content).map((item) => ({
          ...item,
          id: `${file.path}::${item.id}`,
          source: file.label,
        }));
        return {
          ...file,
          items,
          itemCount: items.length,
          shortPath:
            cwd && file.path.startsWith(`${cwd}/`) ? file.path.slice(cwd.length + 1) : file.path,
        };
      })
      .filter((section) => section.itemCount > 0);
  });

  let totalMemoryItemCount = $derived.by(() =>
    memorySections.reduce((sum, section) => sum + section.itemCount, 0),
  );
  let totalMemoryFileCount = $derived(memorySections.length);

  $effect(() => {
    const validPaths = new Set(memorySections.map((section) => section.path));
    const next = new Set<string>();
    let changed = false;
    for (const path of expandedMemoryFiles) {
      if (validPaths.has(path)) {
        next.add(path);
      } else {
        changed = true;
      }
    }
    if (changed || next.size !== expandedMemoryFiles.size) {
      expandedMemoryFiles = next;
    }
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

  // ── Derived: session context info ──
  let sessionContextItems = $derived.by(() => {
    const items: Array<{ label: string; value: string }> = [];
    if (cwd) items.push({ label: "cwd", value: cwd });
    if (runId) items.push({ label: "run", value: runId.slice(0, 8) });
    if (sessionInfo?.model) items.push({ label: "model", value: sessionInfo.model });
    if (sessionInfo?.agent) items.push({ label: "agent", value: sessionInfo.agent });
    if (sessionInfo?.remoteHostName)
      items.push({ label: "remote", value: sessionInfo.remoteHostName });
    if (sessionInfo?.inputTokens || sessionInfo?.outputTokens) {
      items.push({
        label: "tokens",
        value: `${formatTokenCount((sessionInfo?.inputTokens ?? 0) + (sessionInfo?.outputTokens ?? 0))}`,
      });
    }
    if (sessionInfo?.contextUtilization != null) {
      items.push({
        label: "context",
        value: `${Math.round(sessionInfo.contextUtilization * 100)}%`,
      });
    }
    return items;
  });

  /** Instructions + memory both empty: single compact "setup" card */
  let showMergedWorkspaceSetup = $derived(
    !claudeMdLoading && !memoryLoading && !claudeMdExists && totalMemoryItemCount === 0,
  );

  // ── Copy single memory item ──
  function copyItem(text: string) {
    navigator.clipboard.writeText(text).catch(() => {});
  }

  function toggleMemoryFile(path: string) {
    if (expandedMemoryFiles.has(path)) {
      const next = new Set(expandedMemoryFiles);
      next.delete(path);
      expandedMemoryFiles = next;
      return;
    }
    expandedMemoryFiles = new Set(expandedMemoryFiles).add(path);
  }

  function getMemoryScopeLabel(scope: MemoryFileCandidate["scope"]) {
    if (scope === "project") return t("workspaceContext_memorySourceProject");
    if (scope === "global") return t("workspaceContext_memorySourceGlobal");
    return t("workspaceContext_memorySourceAuto");
  }

  function getMemoryScopeTone(scope: MemoryFileCandidate["scope"]) {
    if (scope === "project") return "bg-blue-500/12 text-blue-500";
    if (scope === "global") return "bg-emerald-500/12 text-emerald-500";
    return "bg-amber-500/12 text-amber-500";
  }

  // ── Open CLAUDE.md in files tab ──
  function openClaudeMd() {
    if (onSwitchToFiles) onSwitchToFiles();
  }
</script>

<div class="flex flex-col h-full overflow-y-auto">
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
    {@const card =
      "rounded-xl border border-border/35 overflow-hidden bg-transparent"}
    {@const cardHd = "flex items-center gap-2 px-3 py-2 border-b border-border/25"}
    <div class="p-3 space-y-2.5">
      <!-- Session context (primary) -->
      {#if sessionContextItems.length > 0}
        <div class={card}>
          <div class={cardHd}>
            <svg
              class="h-3.5 w-3.5 text-muted-foreground shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            <span class="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("workspaceContext_sessionContext")}
            </span>
          </div>
          <div class="px-3 py-2 space-y-1">
            {#each sessionContextItems as ctx (ctx.label)}
              <div class="flex items-center gap-2 text-[11px] leading-tight">
                <span class="text-muted-foreground/45 shrink-0 w-12 text-right">{ctx.label}</span>
                <span
                  class="text-foreground/75 min-w-0 truncate font-mono text-[10px] sm:text-[11px]"
                  >{ctx.value}</span
                >
              </div>
            {/each}
          </div>
        </div>
      {/if}

      {#if showMergedWorkspaceSetup}
        <div class="{card} border-dashed border-border/35">
          <div class="px-3 py-2 border-b border-border/20">
            <span
              class="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/90"
            >
              {t("workspaceContext_setupMergedTitle")}
            </span>
          </div>
          <div class="px-3 py-2 space-y-1.5">
            <p class="text-[10px] text-muted-foreground/55 leading-snug">
              {t("workspaceContext_noClaudeMd")}
            </p>
            <p class="text-[10px] text-muted-foreground/45 leading-snug">
              {t("workspaceContext_noMemory")}
            </p>
            {#if onSwitchToFiles}
              <button
                type="button"
                class="text-[10px] font-medium text-primary/55 hover:text-primary transition-colors pt-0.5"
                onclick={onSwitchToFiles}
              >
                {t("workspaceContext_createClaudeMd")}
              </button>
            {/if}
          </div>
        </div>
      {:else}
        <!-- Instructions / CLAUDE.md card -->
        <div class={card}>
          <div class={cardHd}>
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
            <span class="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("workspaceContext_claudeMd")}
            </span>
            {#if claudeMdExists}
              <span
                class="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-[hsl(var(--miwarp-status-success)/0.12)] text-[hsl(var(--miwarp-status-success)/0.95)] font-medium"
              >
                {t("workspaceContext_active")}
              </span>
            {/if}
          </div>

          {#if claudeMdLoading}
            <div class="px-3 pb-2 pt-1">
              <div class="h-3 w-3/4 rounded bg-muted/50 animate-pulse"></div>
              <div class="h-3 w-1/2 rounded bg-muted/50 animate-pulse mt-1.5"></div>
            </div>
          {:else if claudeMdExists && claudeMdSummary.length > 0}
            <div class="px-3 pb-2 pt-1 space-y-1">
              {#each claudeMdSummary.slice(0, claudeMdExpanded ? undefined : 3) as rule, i (i)}
                <p class="text-[11px] text-foreground/70 leading-relaxed line-clamp-2">{rule}</p>
              {/each}
              {#if claudeMdSummary.length > 3}
                <button
                  class="text-[10px] text-primary/65 hover:text-primary transition-colors mt-0.5"
                  onclick={() => (claudeMdExpanded = !claudeMdExpanded)}
                >
                  {claudeMdExpanded
                    ? t("workspaceContext_collapse")
                    : t("workspaceContext_expandAll", { count: String(claudeMdSummary.length) })}
                </button>
              {/if}
            </div>
            <div class="flex items-center gap-2 px-3 py-1.5 border-t border-border/25">
              <span class="text-[10px] text-muted-foreground/50 truncate flex-1"
                >{claudeMdPath.split("/").pop()}</span
              >
              <button
                class="text-[10px] text-primary/55 hover:text-primary transition-colors shrink-0"
                onclick={openClaudeMd}
              >
                {t("workspaceContext_openFile")}
              </button>
            </div>
          {:else}
            <div class="px-3 py-2">
              <p class="text-[10px] text-muted-foreground/50 leading-relaxed">
                {t("workspaceContext_noClaudeMd")}
              </p>
              <button
                class="text-[10px] text-primary/55 hover:text-primary transition-colors mt-1.5"
                onclick={onSwitchToFiles}
              >
                {t("workspaceContext_createClaudeMd")}
              </button>
            </div>
          {/if}
        </div>

        <!-- Memory card -->
        <div class={card}>
          <div class={cardHd}>
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
            <span class="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("workspaceContext_memory")}
            </span>
            {#if totalMemoryItemCount > 0}
              <div class="ml-auto flex items-center gap-1">
                <span
                  class="text-[10px] px-1.5 py-0.5 rounded bg-muted/80 text-muted-foreground"
                >
                  {t("workspaceContext_memoryFilesCount", { count: String(totalMemoryFileCount) })}
                </span>
                <span
                  class="text-[10px] px-1.5 py-0.5 rounded bg-muted/70 text-muted-foreground/80"
                >
                  {t("workspaceContext_memoryItemsCount", { count: String(totalMemoryItemCount) })}
                </span>
              </div>
            {/if}
          </div>

          {#if memoryLoading}
            <div class="px-3 pb-2 pt-1 space-y-1.5">
              <div class="h-3 w-full rounded bg-muted/50 animate-pulse"></div>
              <div class="h-3 w-2/3 rounded bg-muted/50 animate-pulse"></div>
            </div>
          {:else if totalMemoryItemCount > 0}
            <div class="px-2.5 pb-2 pt-1 space-y-2 max-h-72 overflow-y-auto">
              {#each memorySections as section (section.path)}
                {@const sectionExpanded = expandedMemoryFiles.has(section.path)}
                {@const visibleItems = sectionExpanded ? section.items : section.items.slice(0, 2)}
                <section
                  class="rounded-xl border border-border/30 overflow-hidden bg-transparent"
                >
                  <div class="flex items-start gap-2 px-3 py-2 border-b border-border/20">
                    <div class="pt-0.5">
                      <span class="block h-2 w-2 rounded-full {section.scope === 'project'
                        ? 'bg-blue-400/80'
                        : section.scope === 'global'
                          ? 'bg-emerald-400/80'
                          : 'bg-amber-400/80'}"></span>
                    </div>
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2 min-w-0">
                        <p class="text-[11px] font-medium text-foreground/80 truncate">
                          {section.label}
                        </p>
                        <span
                          class="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium {getMemoryScopeTone(
                            section.scope,
                          )}"
                        >
                          {getMemoryScopeLabel(section.scope)}
                        </span>
                        <span
                          class="shrink-0 rounded-full bg-muted/60 px-1.5 py-0.5 text-[9px] text-muted-foreground/75"
                        >
                          {section.itemCount}
                        </span>
                      </div>
                      <p class="mt-0.5 truncate text-[10px] text-muted-foreground/45">
                        {section.shortPath}
                      </p>
                    </div>
                    {#if section.items.length > 2}
                      <button
                        class="shrink-0 text-[9px] text-primary/60 hover:text-primary transition-colors"
                        onclick={() => toggleMemoryFile(section.path)}
                      >
                        {sectionExpanded
                          ? t("workspaceContext_collapse")
                          : t("workspaceContext_memoryShowAll", {
                              count: String(section.itemCount),
                            })}
                      </button>
                    {/if}
                  </div>

                  <div class="px-2 py-1.5 space-y-1">
                    {#each visibleItems as item (item.id)}
                      <div
                        class="group/item flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-accent/20 transition-colors"
                      >
                        <span
                          class="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/30"
                        ></span>
                        <p
                          class="text-[11px] text-foreground/72 leading-relaxed flex-1 min-w-0 {expandedMemory.has(
                            item.id,
                          )
                            ? ''
                            : 'line-clamp-2'}"
                        >
                          {item.text}
                        </p>
                        <div
                          class="flex items-center gap-1 shrink-0 opacity-60 group-hover/item:opacity-100 transition-opacity"
                        >
                          {#if item.text.length > 80}
                            <button
                              class="text-[9px] text-muted-foreground/55 hover:text-foreground transition-colors"
                              onclick={() => {
                                if (expandedMemory.has(item.id)) {
                                  const next = new Set(expandedMemory);
                                  next.delete(item.id);
                                  expandedMemory = next;
                                } else {
                                  expandedMemory = new Set(expandedMemory).add(item.id);
                                }
                              }}
                            >
                              {expandedMemory.has(item.id)
                                ? t("workspaceContext_showLess")
                                : t("workspaceContext_showMore")}
                            </button>
                          {/if}
                          <button
                            class="text-[9px] text-muted-foreground/55 hover:text-foreground transition-colors"
                            onclick={() => copyItem(item.text)}
                            title={t("workspaceContext_copyMemory")}
                          >
                            <svg
                              class="h-3 w-3"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="2"
                              stroke-linecap="round"
                              stroke-linejoin="round"
                            >
                              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    {/each}
                  </div>
                </section>
              {/each}
            </div>
          {:else}
            <div class="px-3 py-2">
              <p class="text-[10px] text-muted-foreground/40 leading-relaxed">
                {t("workspaceContext_noMemory")}
              </p>
            </div>
          {/if}
        </div>
      {/if}

      <!-- Recent Activity summary -->
      <div class={card}>
        <div class="{cardHd} py-1.5">
          <svg
            class="h-3.5 w-3.5 text-muted-foreground shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path
              d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"
            />
          </svg>
          <span class="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("workspaceContext_recentActivity")}
          </span>
          {#if toolStats.totalToolCount > 0}
            <button
              class="ml-auto text-[10px] text-primary/55 hover:text-primary transition-colors"
              onclick={() => onSwitchToActivity?.()}
            >
              {t("workspaceContext_viewActivity")}
            </button>
          {/if}
        </div>
        {#if toolStats.totalToolCount > 0}
          <div class="px-3 pb-2 pt-0.5">
            <p class="text-[10px] text-foreground/58 leading-relaxed">
              {t("workspaceContext_toolSummary", {
                total: String(toolStats.totalToolCount),
                reads: String(toolStats.reads),
                bash: String(toolStats.bash),
                writes: String(toolStats.writes),
              })}
            </p>
          </div>
        {:else}
          <div class="px-3 pb-2 pt-0.5">
            <p class="text-[10px] text-muted-foreground/38 leading-relaxed">
              {t("workspaceContext_noActivity")}
            </p>
          </div>
        {/if}
      </div>

      <!-- Context Usage (collapsed by default) -->
      {#if contextHistory.length > 0 || (turnUsages && turnUsages.length > 0)}
        <div class={card}>
          <details class="group/details">
            <summary
              class="flex list-none cursor-pointer items-center gap-2 px-3 py-2 select-none hover:bg-accent/15 transition-colors [&::-webkit-details-marker]:hidden"
            >
              <svg
                class="h-3 w-3 shrink-0 text-muted-foreground/60 transition-transform group-open/details:rotate-90"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="m9 18 6-6-6-6" />
              </svg>
              <svg
                class="h-3.5 w-3.5 text-muted-foreground shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <span class="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("workspaceContext_contextUsage")}
              </span>
            </summary>
            <div class="border-t border-border/25">
              <ContextHistoryPanel history={contextHistory} {turnUsages} {sessionInfo} />
            </div>
          </details>
        </div>
      {/if}
    </div>
  {/if}
</div>
