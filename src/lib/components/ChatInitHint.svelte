<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
  import { fade } from "svelte/transition";
  import Icon from "$lib/components/Icon.svelte";

  interface Props {
    visible: boolean;
    onRunInit: () => void;
    onDismiss: () => void;
  }

  let { visible, onRunInit, onDismiss }: Props = $props();
</script>

{#if visible}
  <div class="mt-3 flex items-center gap-2 text-[11px] text-[hsl(var(--miwarp-status-warning)/0.8)]" transition:fade={{ duration: 200 }}>
    <Icon name="triangle-alert" size="sm" class="shrink-0" />
    <span>
      Run
      <button type="button"
        class="font-mono text-miwarp-status-warning hover:text-[hsl(var(--miwarp-status-warning)/0.8)] underline underline-offset-2 transition-colors"
        onclick={onRunInit}>{t("chat_initHintAction")}</button
      >
      to create CLAUDE.md
    </span>
    <button type="button"
      class="ml-auto text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors"
      onclick={onDismiss}
      title={t("chat_initHintDismiss")}
      aria-label={t("chat_initHintDismiss")}
    >
      <Icon name="x" size="xs" />
    </button>
  </div>
{/if}
