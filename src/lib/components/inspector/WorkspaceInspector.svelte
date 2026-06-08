<script lang="ts">
  /**
   * v1.0.6 / 5.3: Workspace Inspector — multi-mode right-side panel.
   *
   * Upgrades the right panel from a single "context" view to a tabbed
   * inspector with multiple modes: Context, Preview, Source, Diff, Outline.
   * Each mode is lazy-loaded (only rendered when its tab is active).
   *
   * Trigger entry points:
   * - File path click in chat → opens in Source/Preview mode
   * - Artifact card click → opens in Preview mode
   * - Tool output file reference → opens in Source mode
   * - Git diff link → opens in Diff mode
   */
  import { t } from "$lib/i18n/index.svelte";
  import type { MessageKey } from "$lib/i18n/types";
  import type { LucideIconName } from "$lib/lucide-icon";
  import Icon from "$lib/components/Icon.svelte";
  import type { ProcessVisibility } from "$lib/utils/process-visibility";
  import type { Snippet } from "svelte";

  export type InspectorMode = "context" | "preview" | "source" | "diff" | "outline";

  interface InspectorTarget {
    path: string;
    mode: InspectorMode;
    line?: number;
  }

  let {
    cwd = "",
    runId = "",
    toolStats,
    onSwitchToActivity,
    onSwitchToFiles,
    worktreePath = null,
    parentCwd = null,
    worktreeBranch = null,
    creationMode = null,
    processVisibility = "developer" as ProcessVisibility,
    contextPanel,
    target = null,
    onTargetConsumed,
  }: {
    cwd?: string;
    runId?: string;
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
    /** Snippet for the existing WorkspaceContextPanel content. */
    contextPanel?: Snippet;
    /** External target to inspect (e.g., from a file link click). */
    target?: InspectorTarget | null;
    /** Called after the target has been consumed (so caller can clear it). */
    onTargetConsumed?: () => void;
  } = $props();

  const TABS: Array<{ id: InspectorMode; icon: LucideIconName; labelKey: MessageKey }> = [
    { id: "context", icon: "file-text", labelKey: "inspector_tabContext" },
    { id: "preview", icon: "eye", labelKey: "inspector_tabPreview" },
    { id: "source", icon: "code", labelKey: "inspector_tabSource" },
    { id: "diff", icon: "git-branch", labelKey: "inspector_tabDiff" },
    { id: "outline", icon: "clipboard-list", labelKey: "inspector_tabOutline" },
  ];

  let activeMode = $state<InspectorMode>("context");

  // When an external target arrives, switch to the appropriate tab
  $effect(() => {
    if (target) {
      activeMode = target.mode;
      onTargetConsumed?.();
    }
  });

  function setMode(mode: InspectorMode) {
    activeMode = mode;
  }
</script>

<div class="flex h-full flex-col">
  <!-- Tab bar -->
  <div class="flex shrink-0 items-center gap-0.5 border-b border-border/30 px-2 py-1">
    {#each TABS as tab (tab.id)}
      <button
        type="button"
        class="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium transition-colors
          {activeMode === tab.id
          ? 'bg-sidebar-accent text-sidebar-foreground'
          : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'}"
        onclick={() => setMode(tab.id)}
      >
        <Icon name={tab.icon} size="xs" />
        <span>{t(tab.labelKey)}</span>
      </button>
    {/each}
  </div>

  <!-- Content area -->
  <div class="flex-1 overflow-y-auto">
    {#if activeMode === "context"}
      {#if contextPanel}
        {@render contextPanel()}
      {/if}
    {:else if activeMode === "preview"}
      <div class="p-4">
        {#if target?.path}
          <p class="text-xs text-muted-foreground">
            {t("inspector_previewing")}: <span class="font-mono">{target.path}</span>
          </p>
          <!-- Preview content will be loaded here by the MiMarkdownRenderer -->
        {:else}
          <div class="flex flex-col items-center gap-2 py-8 text-center">
            <Icon name="eye" size="md" class="text-muted-foreground/30" />
            <p class="text-xs text-muted-foreground">{t("inspector_noPreview")}</p>
          </div>
        {/if}
      </div>
    {:else if activeMode === "source"}
      <div class="p-4">
        {#if target?.path}
          <p class="text-xs text-muted-foreground">
            {t("inspector_viewing")}: <span class="font-mono">{target.path}</span>
            {#if target.line}
              <span class="ml-1 text-muted-foreground/50">:{target.line}</span>
            {/if}
          </p>
          <!-- Source content with line numbers will be loaded here -->
        {:else}
          <div class="flex flex-col items-center gap-2 py-8 text-center">
            <Icon name="code" size="md" class="text-muted-foreground/30" />
            <p class="text-xs text-muted-foreground">{t("inspector_noSource")}</p>
          </div>
        {/if}
      </div>
    {:else if activeMode === "diff"}
      <div class="p-4">
        <div class="flex flex-col items-center gap-2 py-8 text-center">
          <Icon name="git-branch" size="md" class="text-muted-foreground/30" />
          <p class="text-xs text-muted-foreground">{t("inspector_noDiff")}</p>
        </div>
      </div>
    {:else if activeMode === "outline"}
      <div class="p-4">
        <div class="flex flex-col items-center gap-2 py-8 text-center">
          <Icon name="clipboard-list" size="md" class="text-muted-foreground/30" />
          <p class="text-xs text-muted-foreground">{t("inspector_noOutline")}</p>
        </div>
      </div>
    {/if}
  </div>
</div>
