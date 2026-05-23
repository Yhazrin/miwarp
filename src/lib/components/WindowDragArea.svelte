<script lang="ts">
  import { startWindowDragFromEvent } from "$lib/utils/window-drag";

  let {
    class: className = "",
  }: {
    class?: string;
  } = $props();
</script>

<div
  class={`window-drag-area ${className}`}
  data-tauri-drag-region
  onpointerdown={startWindowDragFromEvent}
  role="presentation"
></div>
