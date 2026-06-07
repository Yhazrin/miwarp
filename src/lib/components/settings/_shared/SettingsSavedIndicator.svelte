<script lang="ts">
  /**
   * v1.0.6 follow-up: small "✓ Saved" pill shown above a field after
   * a successful patch. Fades out after 2s.
   */
  import { onMount } from "svelte";
  let { visible = true }: { visible?: boolean } = $props();
  let shown = $state<boolean>(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    const v = visible;
    if (v) {
      shown = true;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => (shown = false), 2000);
    } else {
      shown = false;
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  });

  onMount(() => () => {
    if (timer) clearTimeout(timer);
  });
</script>

{#if shown}
  <span
    class="self-start inline-flex items-center gap-1 rounded-full bg-miwarp-status-success/15
      px-2 py-0.5 text-[10px] font-medium text-miwarp-status-success
      transition-opacity duration-200"
    role="status"
  >
    <span aria-hidden="true">✓</span>
    Saved
  </span>
{/if}
