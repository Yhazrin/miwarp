<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
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
    class="shrink-0 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-100 flex items-start gap-3"
    role="status"
  >
    <p class="flex-1 min-w-0">
      {t("versionMismatch_message", {
        frontend: getFrontendVersionLabel() ?? "?",
        backend: getBackendVersionLabel() ?? "?",
      })}
    </p>
    <button
      type="button"
      class="shrink-0 text-xs text-amber-200/90 hover:text-amber-50 underline-offset-2 hover:underline"
      onclick={dismiss}
    >
      {t("versionMismatch_dismiss")}
    </button>
  </div>
{/if}
