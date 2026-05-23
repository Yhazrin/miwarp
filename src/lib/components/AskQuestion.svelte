<!--
  AskQuestion Component

  A unified interactive question component inspired by Claude Code Cowork's
  AskUserQuestion tool. Presents multiple-choice questions with optional
  descriptions and icons.
-->
<script lang="ts">
  interface Option {
    label: string;
    value: string;
    description?: string;
    icon?: string;
  }

  interface Props {
    question: string;
    options: Option[];
    defaultIndex?: number;
    onAnswer: (value: string) => void;
    onCancel?: () => void;
    title?: string;
    showCancel?: boolean;
  }

  let {
    question,
    options,
    defaultIndex = 0,
    onAnswer,
    onCancel,
    title = "",
    showCancel = true,
  }: Props = $props();

  let selectedIndex = $state(0);

  // Sync when defaultIndex prop changes
  $effect(() => {
    selectedIndex = defaultIndex;
  });

  function handleSelect(value: string) {
    onAnswer(value);
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      selectedIndex = (selectedIndex + 1) % options.length;
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      selectedIndex = (selectedIndex - 1 + options.length) % options.length;
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onAnswer(options[selectedIndex].value);
    }
  }
</script>

<div
  class="ask-question w-full max-w-md"
  role="listbox"
  aria-label={question}
  tabindex="0"
  onkeydown={handleKeyDown}
>
  {#if title}
    <h3 class="text-base font-semibold text-foreground mb-3">{title}</h3>
  {/if}

  <p class="text-sm text-foreground/80 mb-4 leading-relaxed">{question}</p>

  <div class="options-list flex flex-col gap-2">
    {#each options as option, i}
      <button
        class="option-button flex items-start gap-3 p-3 rounded-lg border transition-all text-left w-full
               {selectedIndex === i
          ? 'border-primary bg-primary/5 shadow-sm'
          : 'border-border/50 bg-card/30 hover:border-primary/50 hover:bg-card/50'}"
        onclick={() => handleSelect(option.value)}
        role="option"
        aria-selected={selectedIndex === i}
      >
        <span class="option-indicator shrink-0 mt-0.5">
          {#if selectedIndex === i}
            <svg class="w-4 h-4 text-primary" viewBox="0 0 16 16" fill="currentColor">
              <circle cx="8" cy="8" r="6" fill="currentColor" opacity="0.2" />
              <circle cx="8" cy="8" r="3" />
            </svg>
          {:else}
            <svg class="w-4 h-4 text-muted-foreground/40" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5" />
            </svg>
          {/if}
        </span>

        <span class="flex-1 min-w-0">
          <span class="option-label flex items-center gap-2">
            {#if option.icon}
              <span class="text-base">{option.icon}</span>
            {/if}
            <span class="font-medium text-sm text-foreground">{option.label}</span>
          </span>
          {#if option.description}
            <span class="option-desc block text-xs text-muted-foreground mt-0.5"
              >{option.description}</span
            >
          {/if}
        </span>

        {#if selectedIndex === i}
          <span class="shrink-0">
            <svg class="w-4 h-4 text-primary" viewBox="0 0 16 16" fill="none">
              <path
                d="M3 8l3 3 7-7"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </span>
        {/if}
      </button>
    {/each}
  </div>

  {#if showCancel && onCancel}
    <button
      class="cancel-btn mt-4 text-xs text-muted-foreground hover:text-foreground transition-colors"
      onclick={onCancel}
    >
      取消
    </button>
  {/if}
</div>

<style>
  .ask-question {
    padding: 1rem;
  }

  .ask-question:focus {
    outline: none;
  }

  .option-button {
    cursor: pointer;
  }

  .option-button:focus-visible {
    outline: 2px solid var(--ring, hsl(var(--primary)));
    outline-offset: 2px;
    border-radius: 0.5rem;
  }
</style>
