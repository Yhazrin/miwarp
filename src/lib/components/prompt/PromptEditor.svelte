<!--
  PromptEditor — textarea + shell + pending permission indicator.

  Wraps the main editing surface: the animated background shell, the
  pending-permission warning, and the auto-resizing textarea.
  All input events are forwarded to the parent via callbacks.
-->
<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
  let {
    // Shell element refs (bindable)
    composerShellEl = $bindable<HTMLDivElement>(),
    composerSurfaceEl = $bindable<HTMLDivElement>(),
    // Textarea element ref (bindable)
    textareaEl = $bindable<HTMLTextAreaElement | undefined>(),
    inputText = $bindable(""),
    // Layout state
    useCapsuleStrip = false,
    btwMode = false,
    fastModeState = "",
    pendingPermission = false,
    disabled = false,
    placeholder = "",
    // Events
    onKeydown,
    onBeforeInput,
    onInput,
    onPaste,
    onCompositionStart,
    onCompositionEnd,
  }: {
    composerShellEl?: HTMLDivElement;
    composerSurfaceEl?: HTMLDivElement;
    textareaEl?: HTMLTextAreaElement | undefined;
    inputText?: string;
    useCapsuleStrip?: boolean;
    btwMode?: boolean;
    fastModeState?: string;
    pendingPermission?: boolean;
    disabled?: boolean;
    placeholder?: string;
    onKeydown?: (e: KeyboardEvent) => void;
    onBeforeInput?: (e: InputEvent) => void;
    onInput?: (e: Event) => void;
    onPaste?: (e: ClipboardEvent) => void;
    onCompositionStart?: () => void;
    onCompositionEnd?: () => void;
  } = $props();
</script>

<div
  bind:this={composerShellEl}
  class="prompt-input-shell relative isolate w-full overflow-visible"
>
  <div
    bind:this={composerSurfaceEl}
    aria-hidden="true"
    class="prompt-input-surface pointer-events-none absolute inset-0 z-0 origin-bottom border border-primary bg-background/72 backdrop-blur-2xl transition-[border-radius,border-color,background-color,box-shadow] duration-[260ms] ease-[cubic-bezier(0.22,1,0.36,1)] {useCapsuleStrip
      ? 'rounded-full'
      : 'rounded-[1.75rem]'} {btwMode ? 'border-miwarp-status-info/80' : ''} {fastModeState ===
      'on' && !btwMode
      ? 'border-miwarp-status-info/40 shadow-[0_0_12px_-2px_hsl(var(--miwarp-status-info)/0.25)]'
      : ''} {pendingPermission ? 'motion-attention-pulse' : ''}"
  ></div>

  {#if pendingPermission}
    <div
      role="status"
      aria-live="polite"
      class="relative z-10 flex items-center gap-2 px-5 pt-3 pb-0.5 text-xs text-miwarp-status-warning"
    >
      <svg
        class="h-3.5 w-3.5 shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <span>{t("prompt_pendingPermission")}</span>
    </div>
  {/if}

  <textarea
    bind:this={textareaEl}
    bind:value={inputText}
    onkeydown={onKeydown}
    onbeforeinput={onBeforeInput}
    oninput={onInput}
    onpaste={onPaste}
    oncompositionstart={onCompositionStart}
    oncompositionend={onCompositionEnd}
    {placeholder}
    rows={1}
    {disabled}
    aria-label={t("prompt_chatInput")}
    class="no-drag min-w-0 w-full resize-none bg-transparent pl-3 pr-[11.5rem] text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none disabled:opacity-50 {useCapsuleStrip
      ? 'overflow-x-auto overflow-y-hidden min-h-[24px] py-0 leading-6'
      : 'overflow-y-auto pt-1 pb-11'}"
  ></textarea>
</div>
