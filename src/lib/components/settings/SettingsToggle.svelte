<script lang="ts">
  let {
    checked,
    onchange,
    label,
    description,
    disabled = false,
  }: {
    checked: boolean;
    onchange: (value: boolean) => void;
    label?: string;
    description?: string;
    disabled?: boolean;
  } = $props();
</script>

<button
  type="button"
  class="flex w-full items-center justify-between gap-4 py-1.5 cursor-pointer text-left relative z-10 {disabled
    ? 'opacity-50 cursor-not-allowed'
    : ''}"
  role="switch"
  aria-checked={checked}
  aria-label={label || "Toggle setting"}
  {disabled}
  onclick={() => {
    if (!disabled) onchange(!checked);
  }}
>
  {#if label || description}
    <div class="min-w-0 flex-1">
      {#if label}
        <span class="text-sm font-medium">{label}</span>
      {/if}
      {#if description}
        <p class="text-xs text-muted-foreground mt-0.5">{description}</p>
      {/if}
    </div>
  {/if}
  <div
    aria-hidden="true"
    class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 border-transparent transition-colors duration-200 {checked
      ? 'bg-primary'
      : 'bg-input'}"
  >
    <span
      class="pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform duration-200
      {checked ? 'translate-x-5' : 'translate-x-0'}"
    ></span>
  </div>
</button>
