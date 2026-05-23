<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    title: string;
    description?: string;
    type: "skill" | "agent" | "mcp" | "hook" | "plugin";
    source?: string;
    scope?: string;
    installed?: boolean;
    enabled?: boolean;
    variant?: "official" | "community" | "local";
    tags?: string[];
    installCount?: number;
    version?: string;
    onclick?: () => void;
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
    variant,
    tags = [],
    installCount,
    version,
    onclick,
    actions,
  }: Props = $props();

  const typeConfig = {
    skill: {
      color: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
      label: "Skill",
    },
    agent: {
      color: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
      label: "Agent",
    },
    mcp: {
      color: "bg-teal-500/10 text-teal-600 dark:text-teal-400",
      label: "MCP",
    },
    hook: {
      color: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
      label: "Hook",
    },
    plugin: {
      color: "bg-green-500/10 text-green-600 dark:text-green-400",
      label: "Plugin",
    },
  };

  const scopeConfig: Record<string, { color: string }> = {
    user: { color: "bg-muted text-muted-foreground" },
    project: { color: "bg-blue-500/10 text-blue-600 dark:text-blue-400" },
    local: { color: "bg-orange-500/10 text-orange-600 dark:text-orange-400" },
  };
</script>

{#if onclick}
  <button
    type="button"
    class="w-full text-left rounded-2xl border border-border/40 bg-card/50 px-4 py-3 transition-all hover:bg-accent/10 hover:shadow-sm cursor-pointer"
    {onclick}
  >
    <div class="flex items-start justify-between gap-2">
      <div class="flex-1 min-w-0">
        <!-- Title row -->
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-sm font-medium text-foreground truncate">{title}</span>
          {#if version}
            <span class="text-[11px] text-muted-foreground shrink-0">v{version}</span>
          {/if}
          <!-- Type badge -->
          <span
            class="rounded-full px-1.5 py-0.5 text-[10px] font-medium shrink-0 {typeConfig[type]
              .color}"
          >
            {typeConfig[type].label}
          </span>
          <!-- Status dot -->
          {#if installed}
            <span
              class="inline-block h-1.5 w-1.5 rounded-full shrink-0 {enabled
                ? 'bg-green-500'
                : 'bg-muted-foreground/40'}"
              title={enabled ? "Enabled" : "Disabled"}
            ></span>
          {/if}
        </div>

        <!-- Meta row -->
        <div class="flex items-center gap-2 mt-0.5 flex-wrap">
          {#if scope && scopeConfig[scope]}
            <span
              class="rounded-full px-1.5 py-0.5 text-[10px] font-medium {scopeConfig[scope].color}"
              >{scope}</span
            >
          {/if}
          {#if source}
            <span class="text-[10px] text-muted-foreground/60 truncate">{source}</span>
          {/if}
          {#if installCount != null && installCount > 0}
            <span class="text-[10px] text-muted-foreground">{installCount} installs</span>
          {/if}
          {#if variant === "community"}
            <span
              class="rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-violet-500/10 text-violet-600 dark:text-violet-400"
              >community</span
            >
          {/if}
        </div>

        <!-- Description -->
        {#if description}
          <p class="text-xs text-muted-foreground mt-1 line-clamp-2">{description}</p>
        {/if}

        <!-- Tags -->
        {#if tags.length > 0}
          <div class="flex flex-wrap gap-1 mt-1.5">
            {#each tags as tag}
              <span class="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                >{tag}</span
              >
            {/each}
          </div>
        {/if}
      </div>

      <!-- Actions slot -->
      {#if actions}
        <div class="flex items-center gap-1 shrink-0">
          {@render actions()}
        </div>
      {/if}
    </div>
  </button>
{:else}
  <div
    class="rounded-2xl border border-border/40 bg-card/50 px-4 py-3 transition-all hover:bg-accent/10 hover:shadow-sm"
  >
    <div class="flex items-start justify-between gap-2">
      <div class="flex-1 min-w-0">
        <!-- Title row -->
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-sm font-medium text-foreground truncate">{title}</span>
          {#if version}
            <span class="text-[11px] text-muted-foreground shrink-0">v{version}</span>
          {/if}
          <!-- Type badge -->
          <span
            class="rounded-full px-1.5 py-0.5 text-[10px] font-medium shrink-0 {typeConfig[type]
              .color}"
          >
            {typeConfig[type].label}
          </span>
          <!-- Status dot -->
          {#if installed}
            <span
              class="inline-block h-1.5 w-1.5 rounded-full shrink-0 {enabled
                ? 'bg-green-500'
                : 'bg-muted-foreground/40'}"
              title={enabled ? "Enabled" : "Disabled"}
            ></span>
          {/if}
        </div>

        <!-- Meta row -->
        <div class="flex items-center gap-2 mt-0.5 flex-wrap">
          {#if scope && scopeConfig[scope]}
            <span
              class="rounded-full px-1.5 py-0.5 text-[10px] font-medium {scopeConfig[scope].color}"
              >{scope}</span
            >
          {/if}
          {#if source}
            <span class="text-[10px] text-muted-foreground/60 truncate">{source}</span>
          {/if}
          {#if installCount != null && installCount > 0}
            <span class="text-[10px] text-muted-foreground">{installCount} installs</span>
          {/if}
          {#if variant === "community"}
            <span
              class="rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-violet-500/10 text-violet-600 dark:text-violet-400"
              >community</span
            >
          {/if}
        </div>

        <!-- Description -->
        {#if description}
          <p class="text-xs text-muted-foreground mt-1 line-clamp-2">{description}</p>
        {/if}

        <!-- Tags -->
        {#if tags.length > 0}
          <div class="flex flex-wrap gap-1 mt-1.5">
            {#each tags as tag}
              <span class="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                >{tag}</span
              >
            {/each}
          </div>
        {/if}
      </div>

      <!-- Actions slot -->
      {#if actions}
        <div class="flex items-center gap-1 shrink-0">
          {@render actions()}
        </div>
      {/if}
    </div>
  </div>
{/if}
