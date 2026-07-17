<script lang="ts">
  let {
    value = $bindable(""),
    placeholder = "",
    rows = 3,
    disabled = false,
    class: className = "",
    id,
    "aria-label": ariaLabel,
    onkeydown,
  }: {
    value?: string;
    placeholder?: string;
    rows?: number;
    disabled?: boolean;
    class?: string;
    id?: string;
    "aria-label"?: string;
    onkeydown?: (e: KeyboardEvent) => void;
  } = $props();
</script>

<textarea
  {id}
  {placeholder}
  {rows}
  {disabled}
  aria-label={ariaLabel || undefined}
  bind:value
  {onkeydown}
  class="flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 resize-none {className}"
></textarea>
