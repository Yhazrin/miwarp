<script lang="ts">
  import type { Snippet } from "svelte";
  import TopWindowDrag from "$lib/components/TopWindowDrag.svelte";
  import VersionMismatchBanner from "$lib/components/VersionMismatchBanner.svelte";

  interface Props {
    children: Snippet;
    sidebarResizing: boolean;
    sidebarGhostX: number;
    sidebarGhostEl: HTMLElement | null;
    dragRunId: string | null;
    sessionDragLabel: string;
    sessionDragX: number;
    sessionDragY: number;
    titlebarBandHeight: number;
    windowChromeLeftInset: number;
  }

  let {
    children,
    sidebarResizing,
    sidebarGhostX,
    sidebarGhostEl = $bindable(null),
    dragRunId,
    sessionDragLabel,
    sessionDragX,
    sessionDragY,
    titlebarBandHeight,
    windowChromeLeftInset,
  }: Props = $props();
</script>

<div class="sidebar-main-corner-bridge" aria-hidden="true"></div>

{#if sidebarResizing}
  <div
    bind:this={sidebarGhostEl}
    class="fixed top-0 bottom-0 z-[9999] pointer-events-none bg-primary"
    style="left: {sidebarGhostX - 1}px; width: 3px; box-shadow: 0 0 8px hsl(var(--primary) / 0.6);"
  ></div>
{/if}

{#if dragRunId}
  <div
    class="fixed z-[9999] pointer-events-none max-w-[220px] truncate rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground shadow-lg"
    style="left: {sessionDragX + 12}px; top: {sessionDragY + 12}px;"
  >
    {sessionDragLabel}
  </div>
{/if}

<div class="app-main-shell flex flex-col overflow-hidden relative">
  <div
    class="absolute top-0 left-0 right-0 h-11 pointer-events-none"
    data-tauri-drag-region
    aria-hidden="true"
    style="-webkit-app-region: drag; z-index: 0;"
  ></div>
  <VersionMismatchBanner />
  <main class="miwarp-main-surface flex-1 min-h-0 overflow-hidden flex flex-col">
    <div class="flex-1 min-h-0 flex flex-col">
      {@render children()}
    </div>
  </main>
</div>

<TopWindowDrag height={titlebarBandHeight} leftInset={windowChromeLeftInset} />
