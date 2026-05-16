<script lang="ts">
  import { renderMarkdown } from "$lib/utils/markdown";
  import type { Snippet } from "svelte";

  interface Props {
    title: string;
    description?: string;
    type: "skill" | "agent" | "mcp" | "hook" | "plugin";
    source?: string;
    scope?: string;
    installed?: boolean;
    enabled?: boolean;
    version?: string;
    path?: string;
    content?: string;
    tags?: string[];
    installCount?: number;
    links?: { label: string; url: string }[];
    onClose: () => void;
    actions?: Snippet;
  }

  let {
    title,
    description,
    type,
    source,
    scope,
    installed = false,
    enabled = true,
    version,
    path,
    content,
    tags = [],
    installCount,
    links = [],
    onClose,
    actions,
  }: Props = $props();

  const typeColors: Record<string, string> = {
    skill: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
    agent: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
    mcp: "bg-teal-500/10 text-teal-600 dark:text-teal-400",
    hook: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    plugin: "bg-green-500/10 text-green-600 dark:text-green-400",
  };

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") onClose();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- Backdrop -->
<div
  class="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
  onclick={onClose}
  role="presentation"
/>

<!-- Panel -->
<div
  class="fixed top-0 right-0 bottom-0 z-50 w-full max-w-md border-l border-border/60 bg-background/95 backdrop-blur-md shadow-2xl flex flex-col"
>
  <!-- Header -->
  <div class="flex items-start justify-between gap-3 px-5 py-4 border-b border-border shrink-0">
    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-2 flex-wrap">
        <h2 class="text-sm font-semibold text-foreground truncate">{title}</h2>
        <span
          class="rounded-full px-1.5 py-0.5 text-[10px] font-medium {typeColors[type] ??
            'bg-muted text-muted-foreground'}"
        >
          {type}
        </span>
        {#if installed}
          <span
            class="inline-block h-1.5 w-1.5 rounded-full {enabled
              ? 'bg-green-500'
              : 'bg-muted-foreground/40'}"
            title={enabled ? "Enabled" : "Disabled"}
          ></span>
        {/if}
      </div>
      {#if version}
        <span class="text-[11px] text-muted-foreground">v{version}</span>
      {/if}
    </div>
    <button
      class="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
      onclick={onClose}
    >
      <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
        ><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg
      >
    </button>
  </div>

  <!-- Content -->
  <div class="flex-1 overflow-y-auto px-5 py-4 space-y-4">
    <!-- Description -->
    {#if description}
      <p class="text-xs text-muted-foreground leading-relaxed">{description}</p>
    {/if}

    <!-- Meta info -->
    <div class="space-y-2">
      {#if source}
        <div class="flex items-center gap-2">
          <span class="text-[11px] text-muted-foreground w-16 shrink-0">Source</span>
          <span class="text-xs text-foreground">{source}</span>
        </div>
      {/if}
      {#if scope}
        <div class="flex items-center gap-2">
          <span class="text-[11px] text-muted-foreground w-16 shrink-0">Scope</span>
          <span class="text-xs text-foreground">{scope}</span>
        </div>
      {/if}
      {#if path}
        <div class="flex items-center gap-2">
          <span class="text-[11px] text-muted-foreground w-16 shrink-0">Path</span>
          <span class="text-xs text-foreground font-mono truncate">{path}</span>
        </div>
      {/if}
      {#if installCount != null && installCount > 0}
        <div class="flex items-center gap-2">
          <span class="text-[11px] text-muted-foreground w-16 shrink-0">Installs</span>
          <span class="text-xs text-foreground">{installCount}</span>
        </div>
      {/if}
    </div>

    <!-- Tags -->
    {#if tags.length > 0}
      <div class="flex flex-wrap gap-1">
        {#each tags as tag}
          <span class="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{tag}</span
          >
        {/each}
      </div>
    {/if}

    <!-- Links -->
    {#if links.length > 0}
      <div class="flex flex-wrap gap-2">
        {#each links as link}
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            class="text-[11px] text-primary hover:underline">{link.label}</a
          >
        {/each}
      </div>
    {/if}

    <!-- Content preview (markdown) -->
    {#if content}
      <div class="border-t border-border pt-4">
        <h3 class="text-xs font-medium text-muted-foreground mb-2">Content</h3>
        <div class="prose prose-sm dark:prose-invert max-w-none">
          {@html renderMarkdown(content)}
        </div>
      </div>
    {/if}
  </div>

  <!-- Actions footer -->
  {#if actions}
    <div class="flex items-center justify-end gap-2 px-5 py-3 border-t border-border shrink-0">
      {@render actions()}
    </div>
  {/if}
</div>
