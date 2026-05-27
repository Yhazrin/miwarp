<script lang="ts">
  let {
    icon = "" as string,
    title = "",
    description = "",
    class: className = "",
    action,
  } = $props();
</script>

<div class="flex flex-col items-center justify-center gap-3 py-12 text-center {className}">
  {#if icon}
    <div class="text-4xl opacity-50">{icon}</div>
  {/if}
  {#if title}
    <h3 class="text-sm font-medium text-foreground">{title}</h3>
  {/if}
  {#if description}
    <p class="text-sm text-muted-foreground max-w-[280px]">{description}</p>
  {/if}
  {#if action}
    {@render action()}
  {/if}
</div>
