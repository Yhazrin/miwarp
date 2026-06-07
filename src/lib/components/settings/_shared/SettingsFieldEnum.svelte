<script lang="ts">
  /**
   * v1.0.6 follow-up: segmented control for picking one of N options.
   * Replaces the 3 ad-hoc segmented groups (language / permission mode /
   * visual performance mode) in the old settings page.
   */
  import SettingsFieldRow from "./SettingsFieldRow.svelte";

  let {
    label,
    description = "",
    overrideBadge = "",
    savedIndicator = false,
    value,
    options,
    onchange,
    disabled = false,
  }: {
    label?: string;
    description?: string;
    overrideBadge?: string;
    savedIndicator?: boolean;
    value: string;
    options: Array<{ value: string; label: string }>;
    onchange: (v: string) => void;
    disabled?: boolean;
  } = $props();
</script>

<SettingsFieldRow
  {label}
  {description}
  {overrideBadge}
  {savedIndicator}
  align="between"
>
  {#snippet children()}
    <div
      role="radiogroup"
      aria-label={label}
      class="inline-flex rounded-lg border border-border bg-muted/40 p-0.5 gap-0.5 {disabled
        ? 'opacity-50 pointer-events-none'
        : ''}"
    >
      {#each options as opt (opt.value)}
        <button
          type="button"
          role="radio"
          aria-checked={value === opt.value}
          disabled={disabled}
          class="rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-150
            select-none whitespace-nowrap text-center
            {value === opt.value
            ? 'bg-background text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground'}"
          onclick={() => onchange(opt.value)}
        >
          {opt.label}
        </button>
      {/each}
    </div>
  {/snippet}
</SettingsFieldRow>
