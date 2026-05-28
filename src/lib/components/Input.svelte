<script lang="ts">
  let {
    value = $bindable(""),
    placeholder = "",
    type = "text",
    disabled = false,
    class: className = "",
    id,
    "aria-label": ariaLabel,
    oninput,
    onblur,
    onpaste,
  }: {
    value?: string;
    placeholder?: string;
    type?: string;
    disabled?: boolean;
    class?: string;
    id?: string;
    "aria-label"?: string;
    oninput?: (e: Event) => void;
    onblur?: (e: FocusEvent) => void;
    onpaste?: (e: ClipboardEvent) => void;
  } = $props();
</script>

<input
  {id}
  {type}
  {placeholder}
  {disabled}
  aria-label={ariaLabel || undefined}
  bind:value
  {oninput}
  {onblur}
  {onpaste}
  class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 {className}"
/>
