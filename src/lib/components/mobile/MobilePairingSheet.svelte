<script lang="ts">
  /**
   * MobilePairingSheet — QR code + pairing link for mobile device connection.
   * Uses MiDialog (size=sm) for narrow-screen safe display.
   */
  import MiDialog from "$lib/ui/MiDialog.svelte";
  import { t } from "$lib/i18n/index.svelte";

  let {
    open = $bindable(false),
    qrDataUrl = null as string | null,
    pairingLink = "",
    copied = false,
    onCopyLink,
    onClose,
  }: {
    open?: boolean;
    qrDataUrl?: string | null;
    pairingLink?: string;
    copied?: boolean;
    onCopyLink?: () => void;
    onClose?: () => void;
  } = $props();
</script>

<MiDialog bind:open size="sm" title={t("settings_mobile_qrCode")} {onClose}>
  <div class="flex flex-col items-center gap-4">
    <p class="text-center text-sm text-muted-foreground">{t("settings_mobile_scanToConnect")}</p>
    {#if qrDataUrl}
      <img
        src={qrDataUrl}
        alt={t("settings_mobile_qrCode")}
        class="h-48 w-48 rounded-lg border border-border/30 bg-background/50 p-2"
      />
    {:else}
      <div
        class="flex h-48 w-48 items-center justify-center rounded-lg border border-border/30 bg-muted/20"
      >
        <span class="text-xs text-muted-foreground">{t("settings_mobile_generatingQr")}</span>
      </div>
    {/if}
    {#if pairingLink}
      <div class="w-full rounded-lg border border-border/30 bg-muted/20 p-3">
        <p class="break-all font-mono text-[10px] text-muted-foreground">{pairingLink}</p>
      </div>
    {/if}
  </div>
  {#snippet actions()}
    <button
      type="button"
      class="rounded-lg border border-border/50 px-4 py-2 text-sm text-foreground transition-colors hover:bg-muted"
      onclick={() => (open = false)}
    >
      {t("common_close")}
    </button>
    {#if pairingLink}
      <button
        type="button"
        class="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        onclick={() => onCopyLink?.()}
      >
        {copied ? t("settings_mobile_pairingLink") + " ✓" : t("settings_mobile_pairingLink")}
      </button>
    {/if}
  {/snippet}
</MiDialog>
