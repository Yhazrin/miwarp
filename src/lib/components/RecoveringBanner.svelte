<script lang="ts">
  /**
   * v1.0.6 / 3.8: Non-blocking banner shown when the CLI session enters
   * quarantine/recovery mode. Displays the recovery reason and a 5s countdown.
   */

  let {
    message,
    class: className = "",
  }: {
    /** The recovery notice message from the session store. */
    message: string;
    class?: string;
  } = $props();
</script>

<div
  class="mx-4 mb-2 rounded-lg border border-[hsl(var(--miwarp-status-warning)/0.3)] bg-[hsl(var(--miwarp-status-warning)/0.1)] px-3 py-2 text-xs text-miwarp-status-warning {className}"
  role="status"
>
  {message}
</div>
