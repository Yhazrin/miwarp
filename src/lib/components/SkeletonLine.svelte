<script lang="ts">
  let {
    width = "100%",
    height = "0.75rem",
    rounded = "rounded",
    class: className = "",
  } = $props();
</script>

<div
  class="animate-pulse bg-muted {rounded} {className}"
  style="width: {width}; height: {height}"
  aria-hidden="true"
></div>
