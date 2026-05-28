<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
  import { fade } from "svelte/transition";
  import {
    getBackendVersionLabel,
    getFrontendVersionLabel,
    hasVersionMismatch,
  } from "$lib/backend-capabilities.svelte";

  const DISMISS_KEY = "ocv:version-mismatch-dismissed";

  let dismissed = $state(
    typeof sessionStorage !== "undefined" && sessionStorage.getItem(DISMISS_KEY) === "1",
  );

  const visible = $derived(
    hasVersionMismatch() && !dismissed && getFrontendVersionLabel() && getBackendVersionLabel(),
  );

  function dismiss() {
    sessionStorage.setItem(DISMISS_KEY, "1");
    dismissed = true;
  }
</script>

{#if visible}
  <div
    class="shrink-0 border-b border-[hsl(var(--miwarp-status-warning)/0.3)] bg-[hsl(var(--miwarp-status-warning)/0.1)] px-4 py-2 text-sm text-miwarp-status-warning flex items-start gap-3"
    role="status"
    transition:fade={{ duration: 200 }}
  >
    <p class="flex-1 min-w-0">
      {t("versionMismatch_message", {
        frontend: getFrontendVersionLabel() ?? "?",
        backend: getBackendVersionLabel() ?? "?",
      })}
    </p>
    <button
      type="button"
      class="shrink-0 text-xs text-[hsl(var(--miwarp-status-warning)/0.9)] hover:text-miwarp-status-warning underline-offset-2 hover:underline"
      onclick={dismiss}
    >
      {t("versionMismatch_dismiss")}
    </button>
  </div>
{/if}
