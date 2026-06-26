<script lang="ts">
  /**
   * Shared section shell for every card on the Personal Profile page.
   * Owns: title + optional eyebrow + description, optional trailing action
   * (e.g. a "Jump to settings" link), and the children slot for the body.
   * Pure layout — never reads store state on its own, the parent passes props.
   */
  import type { Snippet } from "svelte";
  import type { LucideIconName } from "$lib/lucide-icon";
  import Icon from "$lib/components/Icon.svelte";

  let {
    icon,
    eyebrow = "",
    title,
    description = "",
    action,
    children,
  }: {
    icon?: LucideIconName;
    eyebrow?: string;
    title: string;
    description?: string;
    action?: Snippet;
    children?: Snippet;
  } = $props();
</script>

<section
  class="rounded-xl border border-sidebar-border/60 bg-sidebar/40 p-6 space-y-5"
  aria-labelledby="personal-section-{title.replace(/\s+/g, '-').toLowerCase()}"
>
  <header class="flex items-start justify-between gap-4">
    <div class="min-w-0 flex-1 space-y-1.5">
      {#if eyebrow}
        <p class="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {eyebrow}
        </p>
      {/if}
      <h2
        id="personal-section-{title.replace(/\s+/g, '-').toLowerCase()}"
        class="flex items-center gap-2 text-sm font-semibold text-foreground"
      >
        {#if icon}
          <Icon name={icon} size="sm" class="text-muted-foreground" />
        {/if}
        <span>{title}</span>
      </h2>
      {#if description}
        <p class="text-xs leading-relaxed text-muted-foreground">{description}</p>
      {/if}
    </div>
    {#if action}
      <div class="shrink-0">
        {@render action()}
      </div>
    {/if}
  </header>

  <div class="space-y-4">
    {@render children?.()}
  </div>
</section>
