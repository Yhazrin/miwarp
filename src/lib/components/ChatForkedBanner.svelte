<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";

  interface Props {
    onViewParent: () => void;
  }

  let { onViewParent }: Props = $props();
</script>

<div class="chat-content-width py-2" data-export-exclude>
  <div
    class="flex items-center gap-2 rounded-md border border-blue-500/20 bg-blue-500/5 px-3 py-2 text-xs text-blue-400"
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
      <circle cx="12" cy="18" r="3" /><circle cx="6" cy="6" r="3" /><circle cx="18" cy="6" r="3" />
      <path d="M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9" /><path d="M12 12v3" />
    </svg>
    <span class="text-foreground/60">{t("chat_forkedBanner")}</span>
    <button
      class="ml-auto shrink-0 text-blue-400 hover:text-blue-300 underline underline-offset-2"
      onclick={onViewParent}>{t("chat_viewParent")}</button
    >
  </div>
</div>
