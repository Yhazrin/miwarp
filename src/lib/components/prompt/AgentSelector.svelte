<script lang="ts">
  let { value = "claude", onchange }: { value?: string; onchange?: (v: string) => void } = $props();
</script>

<select
  class="rounded border border-miwarp-border bg-miwarp-bg px-2 py-1 text-xs"
  {value}
  onchange={(e) => onchange?.((e.target as HTMLSelectElement).value)}
>
  <option value="claude">Claude</option>
  <option value="codex">Codex</option>
  <option value="mimo">MiMo</option>
</select>
