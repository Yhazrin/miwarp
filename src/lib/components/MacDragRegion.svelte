<script lang="ts">
  let { class: className = "" }: { class?: string } = $props();
</script>

<div class={`mac-drag-region ${className}`} data-tauri-drag-region></div>
