<script lang="ts">
  /**
   * v1.0.6 follow-up: devices tab shell. Receives web server state via
   * props from the orchestrator. Covers desktop web server + mobile
   * pairing QR. The full QR + LAN access logic is delegated to the
   * orchestrator's callbacks.
   */
  import { t } from "$lib/i18n/index.svelte";
  import type { MessageKey } from "$lib/i18n/types";
  import type { UserSettings } from "$lib/types";
  import Card from "$lib/components/Card.svelte";

  let {
    settings,
    webStatus = null as {
      enabled: boolean;
      bind: string;
      port: number;
      tunnel_url: string | null;
    } | null,
    webToken = null as string | null,
    webTunnelUrl = "",
    webLinkCopied = false,
    webRestarting = false,
    webRestartWarning = null as string | null,
    webLanIp = null as string | null,
    webAdvancedOpen = false,
    webOrigins = [] as string[],
    webRestartError = null as string | null,
    mobileQrDataUrl = null as string | null,
    mobilePairingLinkCopied = false,
    onToggleWebServer = async (_enable: boolean) => {},
    onApplyWebServerSettings = async () => {},
    onCopyAccessLink = async () => {},
    onCopyPairingLink = async () => {},
  }: {
    settings: UserSettings | null;
    webStatus?: { enabled: boolean; bind: string; port: number; tunnel_url: string | null } | null;
    webToken?: string | null;
    webTunnelUrl?: string;
    webLinkCopied?: boolean;
    webRestarting?: boolean;
    webRestartWarning?: string | null;
    webLanIp?: string | null;
    webAdvancedOpen?: boolean;
    webOrigins?: string[];
    webRestartError?: string | null;
    mobileQrDataUrl?: string | null;
    mobilePairingLinkCopied?: boolean;
    onToggleWebServer?: (enable: boolean) => Promise<void>;
    onApplyWebServerSettings?: () => Promise<void>;
    onCopyAccessLink?: () => Promise<void>;
    onCopyPairingLink?: () => Promise<void>;
  } = $props();
  function lk(key: string): string {
    return t(key as MessageKey);
  }
</script>

<div class="space-y-6">
  <Card class="p-6 space-y-4">
    <h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
      {lk("settings_general_webServer")}
    </h2>
    <div class="flex items-center justify-between gap-4 py-1">
      <div class="flex-1 min-w-0">
        <p class="text-sm font-medium">{lk("settings_general_webEnabled")}</p>
        <p class="text-xs text-muted-foreground mt-0.5">
          {lk("settings_general_webEnabledDesc")}
        </p>
      </div>
      <button
        type="button"
        aria-label={lk("settings_general_webEnabled")}
        class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors {webStatus?.enabled
          ? 'bg-primary'
          : 'bg-muted'}"
        disabled={webRestarting}
        onclick={() => onToggleWebServer(!webStatus?.enabled)}
      >
        <span
          class="inline-block h-4 w-4 rounded-full bg-primary-foreground transition-transform {webStatus?.enabled
            ? 'translate-x-6'
            : 'translate-x-1'}"
        ></span>
      </button>
    </div>
    {#if webRestartWarning}
      <p class="text-xs text-miwarp-status-warning">{webRestartWarning}</p>
    {/if}
    {#if webRestartError}
      <p class="text-xs text-miwarp-status-error">{webRestartError}</p>
    {/if}
    <button
      type="button"
      class="rounded-md border border-primary px-3 py-1.5 text-xs text-primary hover:bg-primary/10 transition-colors"
      disabled={webRestarting}
      onclick={onApplyWebServerSettings}
    >
      {lk("settings_general_webApply")}
    </button>
    {#if webLinkCopied}
      <p class="text-xs text-miwarp-status-success">
        {lk("settings_general_webLinkCopied")}
      </p>
    {/if}
  </Card>

  {#if webStatus?.enabled}
    <Card class="p-6 space-y-4">
      <h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
        {lk("settings_mobile_title")}
      </h2>
      <p class="text-sm text-muted-foreground">{lk("settings_mobile_qrDesc")}</p>
      {#if mobileQrDataUrl}
        <img
          src={mobileQrDataUrl}
          alt={lk("settings_mobile_qrAlt")}
          class="h-40 w-40 rounded border"
        />
      {/if}
      <button
        type="button"
        class="rounded-md border px-3 py-1.5 text-xs hover:bg-accent transition-colors"
        onclick={onCopyPairingLink}
      >
        {mobilePairingLinkCopied
          ? lk("settings_mobile_linkCopied")
          : lk("settings_mobile_copyLink")}
      </button>
    </Card>
  {/if}
</div>
