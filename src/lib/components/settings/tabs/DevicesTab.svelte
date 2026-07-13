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
  import Icon from "$lib/components/Icon.svelte";
  import Spinner from "$lib/components/Spinner.svelte";

  let {
    settings: _settings,
    webStatus = null as {
      enabled: boolean;
      running: boolean;
      bind: string;
      port: number;
      tunnel_url: string | null;
    } | null,
    webToken = null as string | null,
    webPortInput = $bindable("9476"),
    webBindValue = $bindable("127.0.0.1"),
    webTunnelUrl = $bindable(""),
    webLinkCopied = false,
    webRestarting = false,
    webRestartWarning = null as string | null,
    webLanIp = null as string | null,
    webAdvancedOpen = $bindable(false),
    webOrigins = $bindable<string[]>([]),
    webRestartError = null as string | null,
    mobileQrDataUrl = null as string | null,
    mobilePairingLinkCopied = false,
    mobileQrRefreshing = false,
    webSelfCheckRunning = false,
    webSelfCheckResult = null as string | null,
    webSelfCheckError = null as string | null,
    onToggleWebServer = async (_enable: boolean) => {},
    onApplyWebServerSettings = async () => {},
    onCopyAccessLink = async () => {},
    onCopyPairingLink = async () => {},
    onRefreshMobilePairing = async () => {},
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
    webPortInput?: string;
    webBindValue?: string;
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
    mobileQrRefreshing?: boolean;
    webSelfCheckRunning?: boolean;
    webSelfCheckResult?: string | null;
    webSelfCheckError?: string | null;
    onToggleWebServer?: (enable: boolean) => Promise<void>;
    onApplyWebServerSettings?: () => Promise<void>;
    onCopyAccessLink?: () => Promise<void>;
    onCopyPairingLink?: () => Promise<void>;
    onRefreshMobilePairing?: () => Promise<void>;
    onRunWebSelfCheck?: () => Promise<void>;
  } = $props();
  let originDraft = $state("");

  function lk(key: string): string {
    return t(key as MessageKey);
  }

  function addOrigin() {
    const origin = originDraft.trim();
    if (!origin || webOrigins.includes(origin)) return;
    webOrigins = [...webOrigins, origin];
    originDraft = "";
  }

  function removeOrigin(origin: string) {
    webOrigins = webOrigins.filter((candidate) => candidate !== origin);
  }

  const localAccessOrigin = $derived.by(() => {
    if (!webStatus?.running || !webStatus.port) return null;
    const rawHost = webLanIp ?? webStatus.bind;
    if (!rawHost) return null;
    const host = rawHost.includes(":") ? `[${rawHost}]` : rawHost;
    return `http://${host}:${webStatus.port}`;
  });

  const displayedAccessOrigin = $derived(webTunnelUrl || localAccessOrigin);
</script>

{#snippet connectionDiagnostic()}
  <Card class="space-y-3 border-border/60 bg-muted/[0.12] p-4">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0 space-y-1">
        <div class="flex items-center gap-2">
          <Icon name="network" size="sm" class="text-muted-foreground" />
          <p class="text-sm font-medium">{lk("settings_mobile_diagnosticTitle")}</p>
        </div>
        <p class="text-xs leading-5 text-muted-foreground">
          {lk("settings_mobile_diagnosticDesc")}
        </p>
      </div>
      <button
        type="button"
        class="shrink-0 rounded-md border border-border/70 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-50"
        disabled={!webStatus?.running || webSelfCheckRunning}
        onclick={onRunWebSelfCheck}
      >
        {webSelfCheckRunning
          ? lk("settings_mobile_diagnosticRunning")
          : lk("settings_mobile_diagnosticRun")}
      </button>
    </div>
    <div class="border-t border-border/50 pt-3" aria-live="polite">
      {#if webSelfCheckError}
        <p class="text-xs leading-5 text-miwarp-status-error">{webSelfCheckError}</p>
      {:else if webSelfCheckResult}
        <p class="text-xs leading-5 text-miwarp-status-success">{webSelfCheckResult}</p>
      {:else}
        <p class="text-xs text-muted-foreground">
          {webStatus?.running
            ? lk("settings_mobile_diagnosticIdle")
            : lk("settings_general_webSelfCheckDisabled")}
        </p>
      {/if}
    </div>
  </Card>
{/snippet}

<div
  class="mx-auto grid w-full max-w-[62rem] grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(19rem,0.9fr)] lg:gap-6"
>
  <Card class="min-h-[23rem] w-full space-y-5 p-5 sm:p-6 lg:h-full">
    <div class="flex items-center justify-between gap-4">
      <h2 class="text-sm font-semibold tracking-[0.08em] text-muted-foreground">
        {lk("settings_general_webServer")}
      </h2>
      <!-- Inline status badge: gives users an at-a-glance read on the web
           server without having to mentally parse the toggle state. -->
      <span
        aria-live="polite"
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

    <div
      class="flex items-center justify-between gap-4 rounded-xl border border-border/60 bg-muted/20 px-4 py-3"
    >
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
    {#if webStatus?.running && webToken && displayedAccessOrigin}
      <div class="space-y-2 rounded-xl border border-primary/15 bg-primary/[0.035] p-3.5">
        <p class="text-xs font-medium text-muted-foreground">
          {lk("settings_general_webAccessLink")}
        </p>
        <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
          <code
            class="min-w-0 flex-1 truncate rounded-md bg-background px-2.5 py-1.5 text-xs font-mono"
          >
            {displayedAccessOrigin}
          </code>
          <button
            type="button"
            class="shrink-0 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-accent transition-colors"
            onclick={onCopyAccessLink}
          >
            {webLinkCopied
              ? lk("settings_general_webLinkCopied")
              : lk("settings_general_webCopyLink")}
          </button>
        </div>
      </div>
    {/if}

    {#if webRestartWarning}
      <p class="text-xs text-miwarp-status-warning">{webRestartWarning}</p>
    {/if}
    {#if webRestartError}
      <p class="text-xs text-miwarp-status-error">{webRestartError}</p>
    {/if}
    {#if webStatus?.enabled}
      <details class="rounded-xl border border-dashed border-border" bind:open={webAdvancedOpen}>
        <summary
          class="cursor-pointer select-none px-3.5 py-3 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          {lk("settings_general_webAdvanced")}
        </summary>
        <div class="space-y-4 border-t border-dashed border-border px-3.5 pb-3.5 pt-3 text-xs">
          <div class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem]">
            <label class="grid gap-1.5">
              <span class="text-muted-foreground">{lk("settings_general_webBindLabel")}</span>
              <input
                bind:value={webBindValue}
                class="rounded-md border bg-background px-2.5 py-1.5 font-mono text-xs outline-none transition-colors focus:border-primary/60"
              />
            </label>
            <label class="grid gap-1.5">
              <span class="text-muted-foreground">{lk("settings_general_webPort")}</span>
              <input
                type="number"
                min="1024"
                max="65535"
                bind:value={webPortInput}
                class="rounded-md border bg-background px-2.5 py-1.5 font-mono text-xs outline-none transition-colors focus:border-primary/60"
              />
            </label>
          </div>
          <label class="grid gap-1.5">
            <span class="text-muted-foreground">{lk("settings_general_webTunnel")}</span>
            <input
              bind:value={webTunnelUrl}
              type="url"
              placeholder={lk("settings_general_webTunnelPlaceholder")}
              class="rounded-md border bg-background px-2.5 py-1.5 text-xs outline-none transition-colors focus:border-primary/60"
            />
            <span class="text-[11px] text-muted-foreground/75"
              >{lk("settings_general_webTunnelDesc")}</span
            >
          </label>
          <div class="grid gap-1.5">
            <span class="text-muted-foreground">{lk("settings_general_webOriginsLabel")}</span>
            <div class="flex gap-2">
              <input
                bind:value={originDraft}
                onkeydown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addOrigin();
                  }
                }}
                placeholder={lk("settings_general_webAllowedOriginsPlaceholder")}
                class="min-w-0 flex-1 rounded-md border bg-background px-2.5 py-1.5 text-xs outline-none transition-colors focus:border-primary/60"
              />
              <button
                type="button"
                class="rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-accent transition-colors disabled:opacity-40"
                disabled={!originDraft.trim()}
                onclick={addOrigin}
              >
                {lk("settings_general_webAddOrigin")}
              </button>
            </div>
            {#if webOrigins.length > 0}
              <ul class="flex flex-wrap gap-1.5 pt-0.5 font-mono">
                {#each webOrigins as origin (origin)}
                  <li
                    class="inline-flex max-w-full items-center gap-1 rounded-md bg-muted px-2 py-1 text-[11px]"
                  >
                    <span class="truncate">{origin}</span>
                    <button
                      type="button"
                      class="rounded px-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
                      aria-label={lk("settings_general_webAllowedOrigins")}
                      onclick={() => removeOrigin(origin)}>×</button
                    >
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
          <button
            type="button"
            class="w-full rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            disabled={webRestarting}
            onclick={onApplyWebServerSettings}
          >
            {webRestarting ? lk("settings_general_webApplying") : lk("settings_general_webApply")}
          </button>
        </div>
      </details>
    {/if}
  </Card>

  <div class="w-full space-y-4">
    <Card class="relative overflow-hidden border-border/60 bg-muted/[0.1] p-5 sm:p-6">
      <div class="absolute inset-x-0 top-0 h-px bg-primary/20"></div>
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0 space-y-1">
          <div class="flex items-center gap-2">
            <span
              class="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary"
              aria-hidden="true"
            >
              <Icon name="link" size="sm" />
            </span>
            <h2 class="text-base font-semibold tracking-tight">
              {lk("settings_mobile_connectTitle")}
            </h2>
          </div>
          <p class="text-xs leading-5 text-muted-foreground">{lk("settings_mobile_connectDesc")}</p>
        </div>
        <span
          class="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-medium {webStatus?.running
            ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
            : 'bg-muted text-muted-foreground'}"
        >
          <span
            class="h-1.5 w-1.5 rounded-full {webStatus?.running
              ? 'bg-emerald-500 animate-pulse'
              : 'bg-muted-foreground/50'}"
          ></span>
          {webStatus?.running
            ? lk("settings_mobile_serviceRunning")
            : lk("settings_mobile_serviceStopped")}
        </span>
      </div>

      {#if webStatus?.running}
        <div class="flex flex-col items-center gap-3 py-6 text-center sm:py-7">
          <div
            class="relative flex h-52 w-52 shrink-0 items-center justify-center rounded-2xl border border-primary/15 bg-primary/[0.045] p-3"
          >
            <span class="absolute left-3 top-3 h-4 w-4 border-l border-t border-primary/40"></span>
            <span class="absolute right-3 top-3 h-4 w-4 border-r border-t border-primary/40"></span>
            <span class="absolute bottom-3 left-3 h-4 w-4 border-b border-l border-primary/40"
            ></span>
            <span class="absolute bottom-3 right-3 h-4 w-4 border-b border-r border-primary/40"
            ></span>
            {#if mobileQrDataUrl}
              <img
                src={mobileQrDataUrl}
                alt={lk("settings_mobile_qrAlt")}
                class="h-44 w-44 rounded-xl bg-white p-2"
              />
            {:else}
              <div class="flex flex-col items-center gap-2 text-center">
                <Spinner size="sm" />
                <span class="text-xs text-muted-foreground"
                  >{lk("settings_mobile_generatingQr")}</span
                >
              </div>
            {/if}
          </div>
          <div class="space-y-1">
            <p
              class="flex items-center justify-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400"
            >
              <span class="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              {lk("settings_mobile_waitingForScan")}
            </p>
            <p class="text-xs text-muted-foreground">{lk("settings_mobile_scanToConnect")}</p>
          </div>
          <div class="flex w-full items-center justify-center gap-2 pt-1">
            <button
              type="button"
              class="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-md bg-primary/10 px-3 text-xs font-medium text-primary transition-colors hover:bg-primary/15 disabled:opacity-50"
              onclick={onCopyPairingLink}
            >
              <Icon name={mobilePairingLinkCopied ? "check" : "copy"} size="sm" />
              {mobilePairingLinkCopied
                ? lk("settings_mobile_linkCopied")
                : lk("settings_mobile_copyPairingLink")}
            </button>
            <button
              type="button"
              class="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border/70 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
              aria-label={lk("settings_mobile_refreshQr")}
              title={lk("settings_mobile_refreshQr")}
              disabled={mobileQrRefreshing}
              onclick={onRefreshMobilePairing}
            >
              <Icon name="refresh-cw" size="sm" class={mobileQrRefreshing ? "animate-spin" : ""} />
            </button>
          </div>
          <ol class="grid w-full grid-cols-3 gap-1 border-t border-border/50 pt-4 text-left">
            <li class="space-y-1 px-1.5">
              <span class="text-[11px] font-medium text-primary">01</span>
              <p class="text-[11px] leading-4 text-muted-foreground">
                {lk("settings_mobile_stepOpen")}
              </p>
            </li>
            <li class="space-y-1 border-x border-border/50 px-2">
              <span class="text-[11px] font-medium text-primary">02</span>
              <p class="text-[11px] leading-4 text-muted-foreground">
                {lk("settings_mobile_stepScan")}
              </p>
            </li>
            <li class="space-y-1 px-1.5 text-right">
              <span class="text-[11px] font-medium text-primary">03</span>
              <p class="text-[11px] leading-4 text-muted-foreground">
                {lk("settings_mobile_stepConfirm")}
              </p>
            </li>
          </ol>
        </div>
      {:else}
        <div class="flex flex-col items-center justify-center gap-3 py-12 text-center">
          <p class="max-w-60 text-sm leading-6 text-muted-foreground">
            {lk("settings_mobile_disabledHint")}
          </p>
          <button
            type="button"
            class="h-10 rounded-md bg-primary px-4 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            disabled={webRestarting}
            onclick={() => onToggleWebServer(true)}
          >
            {lk("settings_mobile_enableServer")}
          </button>
        </div>
      {/if}
    </Card>
    {@render connectionDiagnostic()}
  </div>
</div>
