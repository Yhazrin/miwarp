<script lang="ts">
  import type { Snippet } from "svelte";
  import { dbgWarn } from "$lib/utils/debug";
  import { t } from "$lib/i18n/index.svelte";

  let {
    runId = null,
    entryId = null,
    componentName = "ChatRender",
    onReload,
    children,
  }: {
    runId?: string | null;
    entryId?: string | null;
    componentName?: string;
    onReload?: () => void | Promise<void>;
    children: Snippet;
  } = $props();

  let renderError = $state<string | null>(null);

  function handleBoundaryError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    renderError = message;
    dbgWarn("chat-render", "boundary error", {
      componentName,
      runId,
      entryId,
      error: message,
    });
    return false;
  }

  async function reloadFromEventLog() {
    renderError = null;
    await onReload?.();
  }
</script>

<svelte:boundary onerror={handleBoundaryError}>
  {#snippet failed()}
    <div
      class="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
      role="alert"
    >
      <p>{t("chat_messageRenderFailed")}</p>
      {#if renderError}
        <p class="mt-1 font-mono text-[10px] opacity-70">{renderError}</p>
      {/if}
      {#if onReload}
        <button
          type="button"
          class="mt-2 rounded border border-destructive/40 px-2 py-1 text-[11px] hover:bg-destructive/10"
          onclick={() => void reloadFromEventLog()}
        >
          {t("chat_messageRenderReload")}
        </button>
      {/if}
    </div>
  {/snippet}
  {@render children()}
</svelte:boundary>
