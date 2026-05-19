<script lang="ts">
  import { viewModeStore, type ViewMode } from "$lib/stores/view-mode-store.svelte";
  import { t } from "$lib/i18n/index.svelte";

  const modeLabels: Record<ViewMode, string> = {
    verbose: "Verbose",
    summary: "Summary",
  };

  const modeIcons: Record<ViewMode, string> = {
    verbose: "M4 6h16M4 10h16M4 14h16M4 18h16", // dense list
    summary: "M4 6h16M4 18h16", // top+bottom only
  };

  function handleKeydown(e: KeyboardEvent) {
    if (e.ctrlKey && e.key === "o") {
      e.preventDefault();
      viewModeStore.cycle();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<button
  class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-xs font-medium transition-colors hover:bg-accent"
  onclick={() => viewModeStore.cycle()}
  title={t("viewMode_label", { mode: modeLabels[viewModeStore.mode] })}
>
  <svg
    class="h-3.5 w-3.5"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
  >
    <path d={modeIcons[viewModeStore.mode]} />
  </svg>
  <span>{modeLabels[viewModeStore.mode]}</span>
</button>
