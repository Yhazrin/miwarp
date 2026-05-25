<script lang="ts">
  import { getIntentEngine, type IntentSuggestion } from "$lib/stores/intent-suggestions.svelte";
  import { t } from "$lib/i18n/index.svelte";

  let {
    maxSuggestions = 5,
    showLabels = true,
    showDescriptions = false,
    compact = false,
    onSelect,
    class: className = "",
  }: {
    maxSuggestions?: number;
    showLabels?: boolean;
    showDescriptions?: boolean;
    compact?: boolean;
    onSelect?: (action: string) => void;
    class?: string;
  } = $props();

  const engine = getIntentEngine();
  const suggestions = $derived(engine.getSuggestions(maxSuggestions));

  function handleClick(suggestion: IntentSuggestion) {
    if (onSelect) {
      onSelect(suggestion.action);
    }
    // Also dispatch a custom event for global handling
    const event = new CustomEvent("intent-suggestion", {
      detail: { action: suggestion.action },
    });
    window.dispatchEvent(event);
  }

  function getConfidenceColor(confidence: number): string {
    if (confidence >= 0.8) return "bg-emerald-500/20 border-emerald-500/30";
    if (confidence >= 0.6) return "bg-blue-500/20 border-blue-500/30";
    return "bg-neutral-500/20 border-neutral-500/30";
  }

  function getConfidenceBar(confidence: number): string {
    return `${Math.round(confidence * 100)}%`;
  }
</script>

{#if suggestions.length > 0}
  <div
    class="intent-suggestions flex flex-wrap gap-1.5 {compact
      ? 'items-center'
      : 'items-start'} {className}"
    role="listbox"
    aria-label={t("intent.suggestionsLabel") || "Intent suggestions"}
  >
    {#each suggestions as suggestion (suggestion.action)}
      <button
        class="intent-suggestion inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs transition-all duration-200 hover:scale-105 hover:shadow-md {getConfidenceColor(
          suggestion.confidence,
        )}"
        onclick={() => handleClick(suggestion)}
        title={showDescriptions ? suggestion.description : undefined}
        role="option"
        aria-selected="false"
      >
        <span class="text-base leading-none">{suggestion.icon}</span>

        {#if showLabels}
          <span class="text-foreground/90 font-medium whitespace-nowrap">
            {suggestion.label}
          </span>
        {/if}

        {#if !compact && suggestion.shortcut}
          <kbd
            class="ml-1 px-1 py-0.5 text-[10px] bg-neutral-800 rounded border border-neutral-700 text-neutral-400"
          >
            {suggestion.shortcut}
          </kbd>
        {/if}

        {#if !compact && showDescriptions && suggestion.description}
          <span class="ml-1 text-neutral-500 text-[10px] hidden sm:inline">
            {suggestion.description}
          </span>
        {/if}
      </button>
    {/each}
  </div>
{:else}
  <div class="intent-suggestions-empty text-xs text-muted-foreground/50 {className}">
    {t("intent.noSuggestions") || "No suggestions available"}
  </div>
{/if}

<style>
  .intent-suggestion:hover {
    transform: translateY(-1px);
  }

  .intent-suggestion:active {
    transform: translateY(0) scale(0.98);
  }
</style>
