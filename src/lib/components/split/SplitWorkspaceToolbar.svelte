<!--
  SplitWorkspaceToolbar — layout controls + exit split while in workspace mode.
-->
<script lang="ts">
  import { splitWorkspaceStore, layoutDescription, type LayoutMode } from "$lib/split";
  import { setSplitLayoutMode, exitSplitWorkspace } from "$lib/split/split-workspace-lifecycle";
  import Icon from "$lib/components/Icon.svelte";
  import { t } from "$lib/i18n/index.svelte";

  const split = splitWorkspaceStore;

  const layoutOptions: LayoutMode[] = ["single", "dual", "triple", "quad"];

  function layoutLabel(mode: LayoutMode): string {
    return layoutDescription(mode, (key) => t(key as never));
  }

  async function pickLayout(mode: LayoutMode) {
    await setSplitLayoutMode(mode);
  }
</script>

{#if split.enabled}
  <div
    class="flex shrink-0 items-center gap-2 border-b border-border/40 bg-muted/20 px-3 py-1.5"
    data-testid="split-workspace-toolbar"
  >
    <span class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {t("split_mode_enter")}
    </span>
    <div class="flex items-center gap-1">
      {#each layoutOptions as mode (mode)}
        <button
          type="button"
          class="rounded px-2 py-1 text-[10px] font-medium transition-colors
            {split.layoutMode === mode
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:bg-accent hover:text-foreground'}"
          aria-pressed={split.layoutMode === mode}
          title={layoutLabel(mode)}
          onclick={() => void pickLayout(mode)}
        >
          {mode}
        </button>
      {/each}
    </div>
    <span class="ml-1 text-[10px] text-muted-foreground">
      {split.panes.length}/4
    </span>
    <button
      type="button"
      class="ml-auto inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
      onclick={() => void exitSplitWorkspace({ restoreRun: true })}
    >
      <Icon name="x" size="xs" />
      {t("split_mode_exit")}
    </button>
  </div>
{/if}
