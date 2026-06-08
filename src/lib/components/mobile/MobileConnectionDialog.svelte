<script lang="ts">
  /**
   * MobileConnectionDialog — Full mobile connection setup flow.
   * Combines server status, QR pairing, and connection instructions.
   * Uses MiDialog for narrow-screen safe display.
   */
  import MiDialog from "$lib/ui/MiDialog.svelte";
  import MiTabs from "$lib/ui/MiTabs.svelte";
  import { t } from "$lib/i18n/index.svelte";

  let {
    open = $bindable(false),
    serverRunning = false,
    serverPort = 0,
    qrDataUrl = null as string | null,
    pairingLink = "",
    copied = false,
    onToggleServer,
    onCopyLink,
    onClose,
  }: {
    open?: boolean;
    serverRunning?: boolean;
    serverPort?: number;
    qrDataUrl?: string | null;
    pairingLink?: string;
    copied?: boolean;
    onToggleServer?: (enable: boolean) => void;
    onCopyLink?: () => void;
    onClose?: () => void;
  } = $props();

  let activeTab = $state("pairing");

  const tabs = [
    { value: "pairing", label: t("settings_mobile_qrCode") },
    { value: "manual", label: t("settings_mobile_pairingLink") },
  ];
</script>

<MiDialog bind:open size="md" title={t("settings_mobile_server")} {onClose}>
  <div class="space-y-4">
    <!-- Server status -->
    <div class="flex items-center justify-between rounded-lg border border-border/30 p-3">
      <div class="flex items-center gap-2">
        <span
          class="h-2 w-2 rounded-full {serverRunning ? 'bg-miwarp-status-success' : 'bg-muted'}"
        ></span>
        <span class="text-sm">
          {serverRunning
            ? t("settings_mobile_serverRunning")
            : t("settings_mobile_serverStopped")}
        </span>
      </div>
      {#if serverRunning}
        <span class="font-mono text-xs text-muted-foreground">:{serverPort}</span>
      {:else}
        <button
          type="button"
          class="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          onclick={() => onToggleServer?.(true)}
        >
          {t("settings_mobile_startServer")}
        </button>
      {/if}
    </div>

    {#if serverRunning}
      <MiTabs bind:value={activeTab} {tabs} contentClass="mt-3">
        {#snippet content()}
          {#if activeTab === "pairing"}
            <div class="flex flex-col items-center gap-3">
              {#if qrDataUrl}
                <img
                  src={qrDataUrl}
                  alt={t("settings_mobile_qrCode")}
                  class="h-44 w-44 rounded-lg border border-border/30 bg-background/50 p-2"
                />
              {:else}
                <div
                  class="flex h-44 w-44 items-center justify-center rounded-lg border border-border/30 bg-muted/20"
                >
                  <span class="text-xs text-muted-foreground"
                    >{t("settings_mobile_generatingQr")}</span
                  >
                </div>
              {/if}
              <p class="text-center text-xs text-muted-foreground">
                {t("settings_mobile_scanToConnect")}
              </p>
            </div>
          {:else}
            <div class="space-y-3">
              <p class="text-sm text-muted-foreground">{t("settings_mobile_pairingLink")}</p>
              {#if pairingLink}
                <div class="rounded-lg border border-border/30 bg-muted/20 p-3">
                  <p class="break-all font-mono text-[10px] text-muted-foreground">{pairingLink}</p>
                </div>
                <button
                  type="button"
                  class="w-full rounded-lg border border-border/50 px-3 py-2 text-sm transition-colors hover:bg-muted"
                  onclick={() => onCopyLink?.()}
                >
                  {copied ? "✓ Copied" : t("settings_mobile_pairingLink")}
                </button>
              {:else}
                <p class="text-xs text-muted-foreground">{t("settings_mobile_bindWarningDesc")}</p>
              {/if}
            </div>
          {/if}
        {/snippet}
      </MiTabs>
    {:else}
      <p class="text-center text-sm text-muted-foreground">
        {t("settings_mobile_startServerDesc")}
      </p>
    {/if}
  </div>
</MiDialog>
