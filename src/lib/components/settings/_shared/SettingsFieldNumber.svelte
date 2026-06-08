<script lang="ts">
  /**
   * v1.0.6 follow-up: number input wrapped in SettingsFieldRow.
   * Commits on blur or Enter.
   */
  import SettingsFieldRow from "./SettingsFieldRow.svelte";

  let {
    label,
    description = "",
    overrideBadge = "",
    value = 0,
    min,
    max,
    step = 1,
    suffix = "",
    onCommit,
  }: {
    label?: string;
    description?: string;
    overrideBadge?: string;
    value?: number;
    min?: number;
    max?: number;
    step?: number;
    suffix?: string;
    onCommit?: (v: number) => void;
  } = $props();

  let local = $state<string>("");
  $effect(() => {
    local = String(value);
  });

  function commit() {
    const n = Number(local);
    if (Number.isFinite(n) && n !== value && onCommit) onCommit(n);
    else if (!Number.isFinite(n)) local = String(value);
  }
</script>

<SettingsFieldRow {label} {description} {overrideBadge} align="between">
  {#snippet children()}
    <div class="flex items-center gap-1.5">
      <input
        type="number"
        bind:value={local}
        {min}
        {max}
        {step}
        onblur={commit}
        onkeydown={(e) => {
          if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
        }}
        class="w-24 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm
          text-foreground outline-none focus:border-primary/50 focus:ring-1
          focus:ring-primary/30"
      />
      {#if suffix}
        <span class="text-xs text-muted-foreground">{suffix}</span>
      {/if}
    </div>
  {/snippet}
</SettingsFieldRow>
