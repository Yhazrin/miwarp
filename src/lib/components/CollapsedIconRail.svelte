<!--
  CollapsedIconRail — the thin icon rail shown when ToolActivity is collapsed.
-->
<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import type { ToolActivityPanelTab } from "$lib/components/chat/tool-panel-tab";
  import type { TaskNotificationItem } from "$lib/stores/session-store.svelte";

  let {
    activeTab,
    onToggle,
    onSwitchTab,
    activeBackgroundTasks,
    totalToolCount,
  }: {
    activeTab: ToolActivityPanelTab;
    onToggle: () => void;
    onSwitchTab: (tab: ToolActivityPanelTab) => void;
    activeBackgroundTasks: TaskNotificationItem[];
    totalToolCount: number;
  } = $props();
</script>

<div
  class="absolute top-0 left-0 h-full flex flex-col items-center py-2 px-1 gap-1"
  style="width: 0px;"
>
  <button
    type="button"
    class="text-muted-foreground hover:text-foreground transition-colors p-1 rounded hover:bg-accent"
    onclick={onToggle}
    title={t("toolActivity_show")}
  >
    <Icon name="chevron-right" size="md" />
  </button>
  <!-- Collapsed icon buttons -->
  <button
    type="button"
    class="p-1 rounded transition-colors {activeTab === 'workspace'
      ? 'text-foreground bg-accent'
      : 'text-muted-foreground/50 hover:text-muted-foreground'}"
    onclick={() => onSwitchTab("workspace")}
    title={t("toolActivity_tabWorkspace")}
  >
    <Icon name="home" size="sm" />
  </button>
  <button
    type="button"
    class="p-1 rounded transition-colors {activeTab === 'tools'
      ? 'text-foreground bg-accent'
      : 'text-muted-foreground/50 hover:text-muted-foreground'}"
    onclick={() => onSwitchTab("tools")}
    title={t("toolActivity_tabActivity")}
  >
    <Icon name="wrench" size="sm" />
  </button>
  <button
    type="button"
    class="p-1 rounded transition-colors {activeTab === 'context'
      ? 'text-foreground bg-accent'
      : 'text-muted-foreground/50 hover:text-muted-foreground'}"
    onclick={() => onSwitchTab("context")}
    title={t("toolActivity_tabContext")}
  >
    <Icon name="clock" size="sm" />
  </button>
  <button
    type="button"
    class="p-1 rounded transition-colors {activeTab === 'files'
      ? 'text-foreground bg-accent'
      : 'text-muted-foreground/50 hover:text-muted-foreground'}"
    onclick={() => onSwitchTab("files")}
    title={t("toolActivity_tabFiles")}
  >
    <Icon name="file" size="sm" />
  </button>
  <button
    type="button"
    class="p-1 rounded transition-colors relative {activeTab === 'tasks'
      ? 'text-foreground bg-accent'
      : 'text-muted-foreground/50 hover:text-muted-foreground'}"
    onclick={() => onSwitchTab("tasks")}
    title={t("toolActivity_tabTasks")}
  >
    <Icon name="check-square" size="sm" />
    {#if activeBackgroundTasks.length > 0}
      <span
        class="absolute top-0 right-0 h-1.5 w-1.5 rounded-full bg-miwarp-status-info animate-pulse"
      ></span>
    {/if}
  </button>
  <button
    type="button"
    class="p-1 rounded transition-colors {activeTab === 'scheduled-tasks'
      ? 'text-foreground bg-accent'
      : 'text-muted-foreground/50 hover:text-muted-foreground'}"
    onclick={() => onSwitchTab("scheduled-tasks")}
    title={t("sessionControl_panelScheduledTasks")}
  >
    <Icon name="clock" size="sm" />
  </button>
  {#if totalToolCount > 0}
    <span class="mt-1 text-[10px] text-muted-foreground" style="writing-mode: vertical-rl;"
      >{totalToolCount}</span
    >
  {/if}
</div>
