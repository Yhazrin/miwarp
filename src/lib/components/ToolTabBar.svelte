<!--
  ToolTabBar — the horizontal icon tab bar shown when ToolActivity is expanded.
-->
<script lang="ts">
  import type { ContextSnapshot, FileEntry } from "$lib/types";
  import { t } from "$lib/i18n/index.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import type { TaskNotificationItem } from "$lib/stores/session-store.svelte";
  import type { ToolActivityPanelTab } from "$lib/components/chat/tool-panel-tab";

  let {
    activeTab,
    onTabChange,
    onToggle,
    contextHistory,
    fileEntries,
    activeBackgroundTasks,
  }: {
    activeTab: ToolActivityPanelTab;
    onTabChange: (tab: ToolActivityPanelTab) => void;
    onToggle: () => void;
    contextHistory: ContextSnapshot[];
    fileEntries: FileEntry[];
    activeBackgroundTasks: TaskNotificationItem[];
  } = $props();
</script>

<div
  class="mt-3 mx-1.5 mb-1.5 rounded-2xl border border-border/40 bg-background/40 px-2 py-1.5 backdrop-blur-xl"
>
  <div class="flex items-center justify-between">
    <div class="flex items-center gap-0.5 overflow-x-auto pr-1 scrollbar-hide">
      <!-- Workspace icon -->
      <button
        type="button"
        class="p-1.5 rounded-xl transition-colors {activeTab === 'workspace'
          ? 'bg-accent/30 text-foreground'
          : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'}"
        onclick={() => onTabChange("workspace")}
        title={t("toolActivity_tabWorkspace")}
      >
        <Icon name="home" size="sm" />
      </button>
      <!-- Activity (tools) icon -->
      <button
        type="button"
        class="p-1.5 rounded-xl transition-colors {activeTab === 'tools'
          ? 'bg-accent/30 text-foreground'
          : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'}"
        onclick={() => onTabChange("tools")}
        title={t("toolActivity_tabActivity")}
      >
        <Icon name="wrench" size="sm" />
      </button>
      <!-- Context icon -->
      <button
        type="button"
        class="p-1.5 rounded-xl transition-colors relative {activeTab === 'context'
          ? 'bg-accent/30 text-foreground'
          : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'}"
        onclick={() => onTabChange("context")}
        title={t("toolActivity_tabContext")}
      >
        <Icon name="clock" size="sm" />
        {#if contextHistory.length > 0}
          <span class="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-miwarp-status-success"
          ></span>
        {/if}
      </button>
      <!-- Files icon -->
      <button
        type="button"
        class="p-1.5 rounded-xl transition-colors relative {activeTab === 'files'
          ? 'bg-accent/30 text-foreground'
          : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'}"
        onclick={() => onTabChange("files")}
        title={t("toolActivity_tabFiles")}
      >
        <Icon name="file" size="sm" />
        {#if fileEntries.length > 0}
          <span class="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-miwarp-status-warning"
          ></span>
        {/if}
      </button>
      <!-- Preview icon -->
      <button
        type="button"
        class="p-1.5 rounded-xl transition-colors {activeTab === 'preview'
          ? 'bg-accent/30 text-foreground'
          : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'}"
        onclick={() => onTabChange("preview")}
        title={t("toolActivity_tabPreview")}
      >
        <svg
          class="h-3.5 w-3.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <path d="M8 21h8M12 17v4" />
        </svg>
      </button>
      <!-- Tasks icon -->
      <button
        type="button"
        class="p-1.5 rounded-xl transition-colors relative {activeTab === 'tasks'
          ? 'bg-accent/30 text-foreground'
          : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'}"
        onclick={() => onTabChange("tasks")}
        title={t("toolActivity_tabTasks")}
      >
        <svg
          class="h-3.5 w-3.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M9 12l2 2 4-4" />
        </svg>
        {#if activeBackgroundTasks.length > 0}
          <span
            class="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-miwarp-status-info animate-pulse"
          ></span>
        {/if}
      </button>
      <!-- Scheduled Tasks icon -->
      <button
        type="button"
        class="p-1.5 rounded-xl transition-colors {activeTab === 'scheduled-tasks'
          ? 'bg-accent/30 text-foreground'
          : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'}"
        onclick={() => onTabChange("scheduled-tasks")}
        title={t("sessionControl_panelScheduledTasks")}
      >
        <Icon name="clock" size="sm" />
      </button>
    </div>
    <button
      type="button"
      class="rounded-xl p-1 text-muted-foreground transition-colors hover:bg-accent/30 hover:text-foreground"
      onclick={onToggle}
      title={t("toolActivity_collapse")}
    >
      <Icon name="chevron-left" size="md" />
    </button>
  </div>
</div>
