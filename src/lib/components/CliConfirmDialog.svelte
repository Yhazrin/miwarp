<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
  import { sessionStore } from "$lib/stores/session-store.svelte";

  let submitting = $state(false);

  const prompt = $derived(sessionStore.pendingCliConfirm);

  async function handleConfirm(choice: "y" | "n") {
    if (!prompt || submitting) return;
    submitting = true;

    try {
      const runId = sessionStore.currentRunId;
      if (runId) {
        await sessionStore.respondCliConfirm(runId, prompt.requestId, choice);
      }
    } finally {
      submitting = false;
    }
  }
</script>

{#if prompt}
  <div
    class="mx-4 mb-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4 shadow-lg"
    role="dialog"
    aria-label={t("cli_confirm_title", { default: "CLI Confirm" })}
  >
    <!-- Header -->
    <div class="mb-3 flex items-center gap-2">
      <div
        class="flex h-6 w-6 items-center justify-center rounded-full bg-yellow-500/20 text-xs text-yellow-500"
      >
        !
      </div>
      <div class="flex-1">
        <div class="text-sm font-medium text-neutral-200">
          {t("cli_confirm_title", { default: "CLI Confirm" })}
        </div>
        <div class="text-xs text-neutral-400">
          {t("cli_confirm_from_cli", { default: "Confirmation requested by CLI" })}
        </div>
      </div>
    </div>

    <!-- Message -->
    <p class="mb-4 text-sm text-neutral-300">{prompt.message}</p>

    <!-- Actions -->
    <div class="flex items-center justify-end gap-2">
      <button
        class="rounded px-3 py-1.5 text-xs {prompt.default === 'n'
          ? 'border border-yellow-500 text-yellow-400'
          : 'text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200'} disabled:opacity-50"
        disabled={submitting}
        onclick={() => handleConfirm("n")}
      >
        {t("cli_confirm_no", { default: "No (n)" })}
      </button>
      <button
        class="rounded px-3 py-1.5 text-xs font-medium {prompt.default === 'y'
          ? 'bg-yellow-500 text-black'
          : 'bg-yellow-600 text-white'} hover:opacity-80 disabled:opacity-50"
        disabled={submitting}
        onclick={() => handleConfirm("y")}
      >
        {submitting ? "..." : t("cli_confirm_yes", { default: "Yes (y)" })}
      </button>
    </div>
  </div>
{/if}
