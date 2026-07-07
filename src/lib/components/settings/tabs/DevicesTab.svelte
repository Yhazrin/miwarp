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
      running: boolean;
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
    webSelfCheckRunning = false,
    webSelfCheckResult = null as string | null,
    webSelfCheckError = null as string | null,
    onToggleWebServer = async (_enable: boolean) => {},
    onApplyWebServerSettings = async () => {},
    onCopyAccessLink = async () => {},
    onCopyPairingLink = async () => {},
    onRunWebSelfCheck = async () => {},
  }: {
    settings: UserSettings | null;
    webStatus?: {
      enabled: boolean;
      running: boolean;
      bind: string;
      port: number;
      tunnel_url: string | null;
    } | null;
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
    webSelfCheckRunning?: boolean;
    webSelfCheckResult?: string | null;
    webSelfCheckError?: string | null;
    onToggleWebServer?: (enable: boolean) => Promise<void>;
    onApplyWebServerSettings?: () => Promise<void>;
    onCopyAccessLink?: () => Promise<void>;
    onCopyPairingLink?: () => Promise<void>;
    onRunWebSelfCheck?: () => Promise<void>;
  } = $props();
  function lk(key: string): string {
    return t(key as MessageKey);
  }
</script>

<div class="space-y-6">
  <Card class="p-6 space-y-4">
    <div class="flex items-center justify-between gap-4">
      <h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
        {lk("settings_general_webServer")}
      </h2>
      <!-- Inline status badge: gives users an at-a-glance read on the web
           server without having to mentally parse the toggle state. -->
      <span
        class="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium
          {webStatus?.running
          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
          : 'bg-muted text-muted-foreground'}"
      >
        <span
          class="h-1.5 w-1.5 rounded-full {webStatus?.running
            ? 'bg-emerald-500'
            : 'bg-muted-foreground/50'}"
        ></span>
        {#if webStatus?.running && webStatus?.port}
          {lk("settings_general_webStatusRunning")} :{webStatus.port}
        {:else}
          {lk("settings_general_webStatusStopped")}
        {/if}
      </span>
    </div>

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

    <!-- Access link: shown only when the server is reachable. The tunnel
         URL is what the user types into their phone browser, so it
         deserves a copy button + monospace readout. -->
    {#if webStatus?.enabled && (webTunnelUrl || (webStatus?.running && webLanIp))}
      <div class="rounded-md border bg-muted/30 p-3 space-y-2">
        <p class="text-xs font-medium text-muted-foreground">
          {lk("settings_general_webAccessLink")}
        </p>
        {#if webTunnelUrl}
          <div class="flex items-center gap-2">
            <code class="flex-1 truncate rounded bg-background px-2 py-1 text-xs font-mono">
              {webTunnelUrl}
            </code>
            <button
              type="button"
              class="rounded-md border px-2 py-1 text-xs hover:bg-accent transition-colors"
              onclick={onCopyAccessLink}
            >
              {webLinkCopied
                ? lk("settings_general_webLinkCopied")
                : lk("settings_general_webCopyLink")}
            </button>
          </div>
        {/if}
        {#if webLanIp && webStatus?.port}
          <p class="text-[10px] text-muted-foreground font-mono truncate">
            http://{webLanIp}:{webStatus.port}
          </p>
        {/if}
      </div>
    {/if}

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

    <!-- Advanced settings: bind address + CORS origins. The orchestrator
         already manages the open/closed state and the origin list; this
         section just renders them. Hidden when the server is off so users
         don't edit config for a process that isn't running. -->
    {#if webStatus?.enabled}
      <details class="rounded-md border border-dashed border-border" open={webAdvancedOpen}>
        <summary
          class="cursor-pointer select-none px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          {lk("settings_general_webAdvanced")}
        </summary>
        <div class="space-y-3 px-3 pb-3 text-xs">
          <div>
            <p class="text-muted-foreground mb-1">
              {lk("settings_general_webBindLabel")}
            </p>
            <code class="block rounded bg-muted px-2 py-1 font-mono text-foreground">
              {webStatus?.bind ?? "127.0.0.1"}:{webStatus?.port ?? "—"}
            </code>
          </div>
          {#if webOrigins.length > 0}
            <div>
              <p class="text-muted-foreground mb-1">
                {lk("settings_general_webOriginsLabel")}
              </p>
              <ul class="space-y-0.5 font-mono">
                {#each webOrigins as origin (origin)}
                  <li class="rounded bg-muted px-2 py-0.5">{origin}</li>
                {/each}
              </ul>
            </div>
          {/if}
        </div>
      </details>
    {/if}

    <div class="rounded-md border border-dashed border-border p-3 space-y-2">
      <div class="flex items-center justify-between gap-3">
        <p class="text-xs font-medium">{lk("settings_general_webSelfCheck")}</p>
        <button
          type="button"
          class="rounded-md border px-3 py-1 text-xs hover:bg-accent transition-colors disabled:opacity-50"
          disabled={!webStatus?.running || webSelfCheckRunning}
          onclick={onRunWebSelfCheck}
        >
          {webSelfCheckRunning
            ? lk("settings_general_webSelfCheckRunning")
            : lk("settings_general_webSelfCheckRun")}
        </button>
      </div>
      {#if webSelfCheckError}
        <p class="text-xs text-miwarp-status-error">{webSelfCheckError}</p>
      {:else if webSelfCheckResult}
        <p class="text-xs text-miwarp-status-success">{webSelfCheckResult}</p>
      {:else if !webStatus?.running}
        <p class="text-xs text-muted-foreground">
          {lk("settings_general_webSelfCheckDisabled")}
        </p>
      {/if}
    </div>
  </Card>

  <Card class="p-6 space-y-4">
    <h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
      {lk("settings_mobile_title")}
    </h2>
    {#if webStatus?.enabled}
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
    {:else}
      <p class="text-sm text-muted-foreground italic">
        {lk("settings_mobile_disabledHint")}
      </p>
    {/if}
  </Card>
</div>
