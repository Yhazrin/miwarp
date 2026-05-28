<script lang="ts">
  import { onMount } from "svelte";
  import { t } from "$lib/i18n/index.svelte";
  import { dbg, dbgWarn } from "$lib/utils/debug";
  import Icon from "$lib/components/Icon.svelte";
  import {
    discoverAppUpdate,
    installInAppUpdate,
    openExternalUpdateUrl,
    type AppUpdateOffer,
    type AppUpdateProgress,
  } from "$lib/utils/app-updater";

  let offer = $state<AppUpdateOffer | null>(null);
  let busy = $state(false);
  let progress = $state<AppUpdateProgress>({ phase: "idle", percent: null });

  function isDismissed(version: string): boolean {
    return sessionStorage.getItem(`ocv:update-dismissed:${version}`) === "1";
  }

  function dismiss() {
    if (!offer) return;
    dbg("update-banner", "dismissed", offer.version);
    sessionStorage.setItem(`ocv:update-dismissed:${offer.version}`, "1");
    offer = null;
  }

  async function applyUpdate() {
    if (!offer || busy) return;
    busy = true;
    try {
      if (offer.kind === "in_app") {
        dbg("update-banner", "installing in-app", offer.version);
        await installInAppUpdate((p) => {
          progress = p;
        });
      } else {
        dbg("update-banner", "opening external download", offer.downloadUrl);
        await openExternalUpdateUrl(offer.downloadUrl);
      }
    } catch (e) {
      dbgWarn("update-banner", "update failed", e);
    } finally {
      busy = false;
      progress = { phase: "idle", percent: null };
    }
  }

  const actionLabel = $derived.by(() => {
    if (!offer || !busy) {
      return offer?.kind === "in_app" ? t("appUpdate_install") : t("appUpdate_download");
    }
    switch (progress.phase) {
      case "downloading":
        return progress.percent != null
          ? t("appUpdate_downloading", { percent: String(progress.percent) })
          : t("appUpdate_downloading", { percent: "0" });
      case "installing":
        return t("appUpdate_installing");
      case "relaunching":
        return t("appUpdate_relaunching");
      default:
        return t("appUpdate_install");
    }
  });

  onMount(() => {
    const timerId = setTimeout(async () => {
      try {
        const found = await discoverAppUpdate();
        dbg("update-banner", "check result", found);
        if (found && !isDismissed(found.version)) {
          offer = found;
        }
      } catch (e) {
        dbgWarn("update-banner", "check failed", e);
      }
    }, 3000);
    return () => clearTimeout(timerId);
  });
</script>

{#if offer}
  <div
    class="flex items-center justify-between gap-2 border-b border-primary/30 bg-primary/10 px-4 py-1.5 text-sm"
  >
    <span class="min-w-0 truncate text-foreground">
      {t("appUpdate_available", { version: offer.version })}
    </span>
    <div class="flex shrink-0 items-center gap-2">
      <button type="button"
        class="rounded-md bg-primary px-3 py-0.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
        onclick={applyUpdate}
        disabled={busy}
      >
        {actionLabel}
      </button>
      <button type="button"
        class="rounded-md px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
        onclick={dismiss}
        disabled={busy}
        title={t("appUpdate_dismiss")}
        aria-label={t("appUpdate_dismiss")}
      >
        <Icon name="x" size="sm" />
      </button>
    </div>
  </div>
{/if}
