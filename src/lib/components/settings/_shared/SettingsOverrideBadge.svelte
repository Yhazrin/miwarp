<script lang="ts">
  /**
   * v1.0.6 follow-up: small pill shown next to a setting label when
   * the value is overridden by a project-level config (CLI config).
   * Visually distinct from a saved indicator.
   */
  let { label }: { label: string } = $props();
</script>

<span
  class="inline-flex items-center rounded-full bg-miwarp-accent-violet/15 px-1.5 py-0.5
    text-[10px] font-medium text-miwarp-accent-violet/90 whitespace-nowrap"
  title={`Project override: ${label}`}
>
  {label}
</span>
