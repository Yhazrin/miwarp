<script lang="ts">
  import type { ToolActivityPanelTab } from "$lib/components/chat/tool-panel-tab";
  import { t } from "$lib/i18n/index.svelte";

  type Indicators = { context: boolean; files: boolean; tasks: boolean };

  let {
    active = "workspace",
    onSelect,
    indicators = { context: false, files: false, tasks: false },
  }: {
    active: ToolActivityPanelTab;
    onSelect: (tab: ToolActivityPanelTab) => void;
    indicators?: Indicators;
  } = $props();

  let moreOpen = $state(false);
  let moreEl: HTMLDivElement | undefined = $state();

  const primaryTabs: ToolActivityPanelTab[] = ["workspace", "tools", "files", "preview", "info"];
  const overflowTabs: ToolActivityPanelTab[] = ["context", "tasks"];

  function label(tab: ToolActivityPanelTab): string {
    switch (tab) {
      case "workspace":
        return t("sessionControl_panelWorkspace");
      case "tools":
        return t("sessionControl_panelActivity");
      case "context":
        return t("sessionControl_panelUsage");
      case "files":
        return t("sessionControl_panelFiles");
      case "preview":
        return t("sessionControl_panelPreview");
      case "info":
        return t("sessionControl_panelInfo");
      case "tasks":
        return t("sessionControl_panelTasks");
      case "scheduled-tasks":
        return t("sessionControl_panelScheduledTasks");
      default:
        return tab;
    }
  }

  function chip(activeTab: boolean): string {
    return activeTab
      ? "bg-muted/70 text-foreground shadow-sm ring-1 ring-border/45"
      : "text-muted-foreground hover:bg-muted/45 hover:text-foreground";
  }

  function pick(tab: ToolActivityPanelTab) {
    moreOpen = false;
    onSelect(tab);
  }

  function onDocClick(e: MouseEvent) {
    if (!moreOpen) return;
    const el = moreEl;
    if (el && e.target instanceof Node && !el.contains(e.target)) moreOpen = false;
  }
</script>

<svelte:window onclick={onDocClick} />

<div
  bind:this={moreEl}
  class="flex h-9 min-w-0 max-w-full items-center gap-0.5 sm:max-w-[min(20rem,100%)]"
>
  <div
    class="flex min-h-0 min-w-0 flex-1 items-center gap-0.5 overflow-x-auto pr-0.5 [scrollbar-width:thin]"
    role="tablist"
    aria-label={t("sessionControl_panelTabsAria")}
  >
    {#each primaryTabs as tab (tab)}
      <button
        type="button"
        role="tab"
        aria-selected={active === tab}
        aria-label={label(tab)}
        class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors {chip(
          active === tab,
        )}"
        onclick={() => pick(tab)}
        title={label(tab)}
      >
        {#if tab === "workspace"}
          <svg
            class="h-3.5 w-3.5 shrink-0 opacity-90"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            ><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline
              points="9 22 9 12 15 12 15 22"
            /></svg
          >
        {:else if tab === "tools"}
          <svg
            class="h-3.5 w-3.5 shrink-0 opacity-90"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            ><path
              d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"
            /></svg
          >
        {:else if tab === "files"}
          <span class="relative inline-flex shrink-0">
            <svg
              class="h-3.5 w-3.5 opacity-90"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              ><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline
                points="14 2 14 8 20 8"
              /></svg
            >
            {#if indicators.files}
              <span
                class="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-[hsl(var(--miwarp-status-warning))]"
              ></span>
            {/if}
          </span>
        {:else if tab === "preview"}
          <svg
            class="h-3.5 w-3.5 shrink-0 opacity-90"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            ><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></svg
          >
        {:else}
          <svg
            class="h-3.5 w-3.5 shrink-0 opacity-90"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            ><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line
              x1="12"
              y1="8"
              x2="12.01"
              y2="8"
            /></svg
          >
        {/if}
      </button>
    {/each}
  </div>

  <div class="relative shrink-0">
    <button
      type="button"
      class="inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors {overflowTabs.includes(
        active,
      )
        ? chip(true)
        : chip(false)}"
      onclick={(e) => {
        e.stopPropagation();
        moreOpen = !moreOpen;
      }}
      aria-expanded={moreOpen}
      aria-label={t("sessionControl_panelOverflowMenu")}
      title={t("sessionControl_panelOverflowMenu")}
    >
      <svg
        class="h-3.5 w-3.5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"><path d="m6 9 6 6 6-6" /></svg
      >
    </button>
    {#if moreOpen}
      <div
        class="absolute right-0 top-full z-[60] mt-1 min-w-[9.5rem] rounded-lg border border-border/45 bg-popover py-1 text-xs shadow-lg"
      >
        {#each overflowTabs as tab (tab)}
          <button
            type="button"
            class="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-accent/40 {active ===
            tab
              ? 'bg-muted/50 font-medium'
              : ''}"
            onclick={() => pick(tab)}
          >
            {#if tab === "context"}
              <span class="relative inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                <svg
                  class="h-3.5 w-3.5 opacity-90"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  ><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg
                >
                {#if indicators.context}
                  <span
                    class="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-[hsl(var(--miwarp-status-success))]"
                  ></span>
                {/if}
              </span>
            {:else if tab === "tasks"}
              <span class="relative inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                <svg
                  class="h-3.5 w-3.5 opacity-90"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  ><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 12l2 2 4-4" /></svg
                >
                {#if indicators.tasks}
                  <span
                    class="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-[hsl(var(--miwarp-status-info))] animate-pulse"
                  ></span>
                {/if}
              </span>
            {:else if tab === "scheduled-tasks"}
              <span class="relative inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                <svg
                  class="h-3.5 w-3.5 opacity-90"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  ><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg
                >
              </span>
            {:else}
              <span class="relative inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                <svg
                  class="h-3.5 w-3.5 opacity-90"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  ><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line
                    x1="12"
                    y1="8"
                    x2="12.01"
                    y2="8"
                  /></svg
                >
              </span>
            {/if}
            <span class="flex-1 truncate">{label(tab)}</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>
</div>
