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

<label
  class="flex items-center justify-between gap-4 py-1.5 cursor-pointer {disabled
    ? 'opacity-50 pointer-events-none'
    : ''}"
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
  <button
    role="switch"
    aria-checked={checked}
    class="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200
      {checked ? 'bg-primary' : 'bg-neutral-700'}"
    onclick={() => onchange(!checked)}
    {disabled}
  >
    <span
      class="inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform duration-200
      {checked ? 'translate-x-4' : 'translate-x-0.5'}"
    ></span>
  </button>
</label>
