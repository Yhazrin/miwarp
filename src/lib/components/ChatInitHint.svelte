<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
  import { fade } from "svelte/transition";

  interface Props {
    visible: boolean;
    onRunInit: () => void;
    onDismiss: () => void;
  }

  let { visible, onRunInit, onDismiss }: Props = $props();
</script>

{#if visible}
  <div class="mt-3 flex items-center gap-2 text-[11px] text-[hsl(var(--miwarp-status-warning)/0.8)]" transition:fade={{ duration: 200 }}>
    <svg
      class="h-3.5 w-3.5 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M12 9v4" /><path d="M12 17h.01" />
      <path d="M3.6 15.4 10.2 4a2 2 0 0 1 3.6 0l6.6 11.4a2 2 0 0 1-1.8 3H5.4a2 2 0 0 1-1.8-3Z" />
    </svg>
    <span>
      Run
      <button
        class="font-mono text-[hsl(var(--miwarp-status-warning))] hover:text-[hsl(var(--miwarp-status-warning)/0.8)] underline underline-offset-2 transition-colors"
        onclick={onRunInit}>{t("chat_initHintAction")}</button
      >
      to create CLAUDE.md
    </span>
    <button
      class="ml-auto text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors"
      onclick={onDismiss}
      title={t("chat_initHintDismiss")}
      aria-label={t("chat_initHintDismiss")}
    >
      <svg
        class="h-3 w-3"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M18 6 6 18" /><path d="m6 6 12 12" />
      </svg>
    </button>
  </div>
{/if}
