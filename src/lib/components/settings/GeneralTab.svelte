<script lang="ts">
  import { onMount } from "svelte";
  import * as api from "$lib/api";
  import type { UserSettings } from "$lib/types";
  import Card from "$lib/components/Card.svelte";
  import SettingsToggle from "$lib/components/settings/SettingsToggle.svelte";
  import { t, LOCALE_REGISTRY, currentLocale, switchLocale } from "$lib/i18n/index.svelte";
  import { getTransport } from "$lib/transport";
  import { dbg, dbgWarn } from "$lib/utils/debug";

  let {
    initialSettings,
    onSettingsUpdated,
  }: {
    initialSettings: UserSettings;
    onSettingsUpdated: (updated: UserSettings) => void;
  } = $props();

  // ── Local working copy of settings ──
  let settings = $state<UserSettings>(initialSettings);

  // ── UI Zoom state (desktop-only) ──
  let cachedWebview: any = null;
  async function getWebview() {
    if (!cachedWebview) {
      const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      cachedWebview = getCurrentWebviewWindow();
    }
    return cachedWebview;
  }

  let zoomPreview = $state(1.0);

  $effect(() => {
    if (settings) {
      zoomPreview = Math.min(1.5, Math.max(0.75, settings.ui_zoom ?? 1.0));
    }
  });

  function clampZoom(v: number): number | null {
    if (!Number.isFinite(v)) return null;
    return Math.min(1.5, Math.max(0.75, v));
  }

  let pendingZoom: number | null = null;
  let zoomFlying = false;

  async function applyZoomQueued(factor: number) {
    if (zoomFlying) {
      pendingZoom = factor;
      return;
    }

    zoomFlying = true;
    try {
      const wv = await getWebview();
      await wv.setZoom(factor);
      dbg("settings", "applyZoomQueued", { factor });
    } catch (e) {
      dbgWarn("settings", "applyZoomQueued failed", e);
    }
    zoomFlying = false;

    if (pendingZoom !== null) {
      const next = pendingZoom;
      pendingZoom = null;
      void applyZoomQueued(next);
    }
  }

  function previewZoom(raw: number) {
    const factor = clampZoom(raw);
    if (factor === null) return;
    zoomPreview = factor;
  }

  let displaySaved = $state(false);

  async function commitZoom(raw: number) {
    const factor = clampZoom(raw);
    if (factor === null) return;

    // Persist
    try {
      settings = await api.updateUserSettings({ ui_zoom: factor });
      onSettingsUpdated(settings);
      dbg("settings", "commitZoom saved", { factor });
      displaySaved = true;
      setTimeout(() => (displaySaved = false), 1500);
    } catch (e) {
      dbgWarn("settings", "commitZoom save failed", e);
      // Rollback to last persisted value
      const fallback = Math.min(1.5, Math.max(0.75, settings?.ui_zoom ?? 1.0));
      zoomPreview = fallback;
      pendingZoom = null;
      void applyZoomQueued(fallback);
      return;
    }

    // Apply final value via queue (overrides any stale preview)
    pendingZoom = null;
    void applyZoomQueued(factor);
  }

  // ── Web Server state (desktop-only) ──
  let webToken = $state<string | null>(null);
  let webStatus = $state<{
    enabled: boolean;
    running: boolean;
    port: number;
    bind: string;
    warning?: string;
  } | null>(null);
  let showWebToken = $state(false);
  let webTokenCopied = $state(false);
  let webLinkCopied = $state(false);
  let webRestarting = $state(false);
  let webRestartError = $state<string | null>(null);
  let webRestartWarning = $state<string | null>(null);
  let webPortInput = $state("9476");
  let webOriginInput = $state("");
  let webBindValue = $state("127.0.0.1");
  let webOrigins = $state<string[]>([]);
  let webOriginError = $state<string | null>(null);
  let webAdvancedOpen = $state(false);
  let webLanIp = $state<string | null>(null);
  let webTunnelUrl = $state("");
  let webTunnelError = $state<string | null>(null);
  let webTunnelLinkCopied = $state(false);
  let lanIpRequestId = $state(0);

  // ── Web Server helpers ──

  async function applyWebServerSettings() {
    webRestarting = true;
    webRestartError = null;
    webRestartWarning = null;
    webTunnelError = null;
    try {
      const portNum = parseInt(webPortInput, 10);
      if (isNaN(portNum) || portNum < 1024 || portNum > 65535) {
        throw new Error(t("settings_general_webPortInvalid"));
      }
      const result = await api.restartWebServer({
        enabled: true,
        port: portNum,
        bind: webBindValue,
        allowed_origins: webOrigins.length > 0 ? webOrigins : null,
        tunnel_url: webTunnelUrl.trim() || null,
      });
      webStatus = await api.getWebServerStatus();
      settings = await api.getUserSettings();
      onSettingsUpdated(settings);
      if (!result.config_saved) {
        webRestartWarning = t("settings_general_webSaveWarning");
      }
      dbg("settings", "webServer apply", { started: result.started, saved: result.config_saved });
      if (webStatus?.running) await refreshLanIp(webStatus.bind);
    } catch (e: unknown) {
      webRestartError = (e as Error)?.message ?? String(e);
      webStatus = await api.getWebServerStatus();
      dbgWarn("settings", "webServer apply failed", e);
    } finally {
      webRestarting = false;
    }
  }

  function addWebOrigin() {
    const trimmed = webOriginInput.trim().replace(/\/+$/, "");
    if (!trimmed) return;
    try {
      const url = new URL(trimmed);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        webOriginError = t("settings_general_webOriginInvalid");
        return;
      }
      const origin = url.origin;
      if (!webOrigins.includes(origin)) {
        webOrigins = [...webOrigins, origin];
      }
    } catch {
      webOriginError = t("settings_general_webOriginInvalid");
      return;
    }
    webOriginInput = "";
    webOriginError = null;
  }

  async function refreshLanIp(bind: string): Promise<string | null> {
    const myId = ++lanIpRequestId;
    if (bind !== "0.0.0.0" && bind !== "::" && bind !== "[::]") {
      webLanIp = null;
      return null;
    }
    try {
      const preferV6 = bind === "::" || bind === "[::]";
      const ip = await api.getLocalIp(preferV6);
      if (myId !== lanIpRequestId) return webLanIp;
      webLanIp = ip;
      return ip;
    } catch (e) {
      dbgWarn("settings", "refreshLanIp failed", e);
      if (myId !== lanIpRequestId) return webLanIp;
      webLanIp = null;
      return null;
    }
  }

  function buildLocalAccessUrl(): string | null {
    if (!webStatus?.running || !webToken) return null;
    const bind = webStatus.bind;
    const isAll = bind === "0.0.0.0" || bind === "::" || bind === "[::]";
    const rawHost = isAll ? webLanIp : bind;
    if (!rawHost) return null;
    const host = rawHost.includes(":") ? `[${rawHost}]` : rawHost;
    return `http://${host}:${webStatus.port}/login#token=${webToken}`;
  }

  function buildTunnelAccessUrl(): string | null {
    if (!webStatus?.running || !webToken) return null;
    // Use saved (applied) tunnel URL, not the draft input value
    const tunnel = settings?.web_server_tunnel_url?.trim();
    if (!tunnel) return null;
    try {
      const u = new URL(tunnel);
      // Tunnel links use ?token= (server-side auth) to survive ngrok/cloudflared
      // interstitial pages. Local links keep #token= (fragment, never sent to server).
      return `${u.origin}/login?token=${webToken}`;
    } catch {
      return null;
    }
  }

  function buildAccessUrl(): string | null {
    return buildTunnelAccessUrl() ?? buildLocalAccessUrl();
  }

  async function copyAccessLink() {
    const url = buildAccessUrl();
    if (!url) return;
    await navigator.clipboard.writeText(url);
    webLinkCopied = true;
    dbg("settings", "webLink copied");
    setTimeout(() => (webLinkCopied = false), 1500);
  }

  async function openAccessLink() {
    const url = buildAccessUrl();
    if (!url) return;
    try {
      const { open } = await import("@tauri-apps/plugin-shell");
      await open(url);
      dbg("settings", "webLink opened in browser");
    } catch (e) {
      dbgWarn("settings", "failed to open browser", e);
    }
  }

  // ── Helper to update settings and notify parent ──
  async function updateSetting(patch: Partial<UserSettings>) {
    settings = await api.updateUserSettings(patch);
    onSettingsUpdated(settings);
  }

  onMount(async () => {
    settings = initialSettings;
    // Load web server status + token (desktop only)
    if (getTransport().isDesktop()) {
      Promise.all([api.getWebServerStatus(), api.getWebServerToken()])
        .then(async ([status, token]) => {
          webStatus = status;
          webToken = token;
          // Initialize form fields from settings
          webPortInput = String(settings?.web_server_port ?? 9476);
          webBindValue = settings?.web_server_bind ?? "127.0.0.1";
          webOrigins = [...(settings?.web_server_allowed_origins ?? [])];
          webTunnelUrl = settings?.web_server_tunnel_url ?? "";
          dbg("settings", "webServer loaded", {
            enabled: status?.enabled,
            hasToken: !!token,
            tunnel: webTunnelUrl,
          });
          if (status?.running) await refreshLanIp(status.bind);
        })
        .catch((e) => {
          dbgWarn("settings", "webServer load failed", e);
        });
    }
  });
</script>

<div class="space-y-6">
  <!-- Language Card -->
  <Card class="p-6 space-y-4">
    <h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
      {t("settings_general_language")}
    </h2>
    <div class="flex items-center justify-between">
      <div>
        <p class="text-sm font-medium">{t("settings_general_displayLanguage")}</p>
        <p class="text-xs text-muted-foreground">
          {t("settings_general_displayLanguageDesc")}
        </p>
      </div>
      <div class="flex rounded-full border border-border bg-muted/40 p-0.5 gap-0.5">
        {#each LOCALE_REGISTRY as entry (entry.code)}
          <button
            type="button"
            class="rounded-full px-3.5 py-1.5 text-xs font-medium transition-all duration-150 select-none
              {currentLocale() === entry.code
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground hover:bg-accent/60'}"
            onclick={() => switchLocale(entry.code)}
          >
            {entry.nativeName}{#if (entry.status as string) === "beta"}<span
                class="ml-1 text-[10px] opacity-60">(Beta)</span
              >{/if}
          </button>
        {/each}
      </div>
    </div>
  </Card>

  <!-- Display Card -->
  <Card class="p-6 space-y-4">
    <div class="flex items-center justify-between">
      <h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
        {t("settings_general_display")}
      </h2>
      {#if displaySaved}
        <span class="text-xs text-emerald-500 flex items-center gap-1 animate-fade-in">
          <svg
            class="h-3 w-3"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg
          >
          {t("settings_general_saved")}
        </span>
      {/if}
    </div>
    <div class="flex items-center justify-between gap-4">
      <div>
        <p class="text-sm font-medium">{t("settings_general_uiZoom")}</p>
        <p class="text-xs text-muted-foreground">{t("settings_general_uiZoomDesc")}</p>
      </div>
      <div class="flex items-center gap-3">
        <input
          type="range"
          min="0.75"
          max="1.5"
          step="0.05"
          value={zoomPreview}
          class="w-28 accent-primary"
          oninput={(e) => previewZoom(parseFloat((e.target as HTMLInputElement).value))}
          onchange={(e) => commitZoom(parseFloat((e.target as HTMLInputElement).value))}
        />
        <span class="text-xs text-muted-foreground w-10 text-right">
          {Math.round(zoomPreview * 100)}%
        </span>
      </div>
    </div>
  </Card>

  <!-- Web Server Card (desktop only) -->
  {#if getTransport().isDesktop()}
    <Card class="p-6 space-y-4">
      <h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
        {t("settings_general_webServer")}
      </h2>

      <!-- Enabled toggle -->
      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm font-medium">{t("settings_general_webEnabled")}</p>
          <p class="text-xs text-muted-foreground">
            {t("settings_general_webEnabledDesc")}
          </p>
        </div>
        <button
          class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors {webStatus?.enabled
            ? 'bg-primary'
            : 'bg-muted'}"
          disabled={webRestarting}
          onclick={async () => {
            const newEnabled = !webStatus?.enabled;
            webRestarting = true;
            webRestartError = null;
            webRestartWarning = null;
            try {
              if (newEnabled) {
                const portNum = parseInt(webPortInput, 10);
                if (isNaN(portNum) || portNum < 1024 || portNum > 65535) {
                  throw new Error(t("settings_general_webPortInvalid"));
                }
                const result = await api.restartWebServer({
                  enabled: true,
                  port: portNum,
                  bind: webBindValue,
                  allowed_origins: webOrigins.length > 0 ? webOrigins : null,
                  tunnel_url: webTunnelUrl.trim() || null,
                });
                if (!result.config_saved) {
                  webRestartWarning = t("settings_general_webSaveWarning");
                }
              } else {
                await api.restartWebServer({
                  enabled: false,
                  port: 0,
                  bind: "",
                  allowed_origins: null,
                  tunnel_url: null,
                });
              }
              webStatus = await api.getWebServerStatus();
              settings = await api.getUserSettings();
              onSettingsUpdated(settings);
              dbg("settings", "webServer toggled", { enabled: newEnabled });
              if (webStatus?.running) await refreshLanIp(webStatus.bind);
            } catch (e) {
              webRestartError = (e as Error)?.message ?? String(e);
              webStatus = await api.getWebServerStatus();
              dbgWarn("settings", "webServer toggle failed", e);
            } finally {
              webRestarting = false;
            }
          }}
        >
          <span
            class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform {webStatus?.enabled
              ? 'translate-x-6'
              : 'translate-x-1'}"
          ></span>
        </button>
      </div>

      <!-- Config area (show when enabled OR running) -->
      {#if webStatus?.enabled || webStatus?.running}
        <!-- Startup warning banner -->
        {#if webStatus?.warning}
          <div class="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2">
            <p class="text-xs text-amber-400 whitespace-pre-line">
              {t("settings_general_webStartupWarning", { warning: webStatus.warning })}
            </p>
          </div>
        {/if}

        <!-- Access link + token (only when running) -->
        {#if webStatus?.running && webToken}
          {@const isAllInterfaces =
            webStatus.bind === "0.0.0.0" || webStatus.bind === "::" || webStatus.bind === "[::]"}
          {@const rawHost = isAllInterfaces ? webLanIp : webStatus.bind}
          {@const displayHost = rawHost ? (rawHost.includes(":") ? `[${rawHost}]` : rawHost) : null}
          {@const tunnelUrl = buildTunnelAccessUrl()}
          {@const localUrl = buildLocalAccessUrl()}
          <div class="space-y-2">
            {#if tunnelUrl}
              <!-- Tunnel link (primary) -->
              <div class="flex items-center gap-2">
                <span class="text-xs text-muted-foreground shrink-0"
                  >{t("settings_general_webTunnelLink")}</span
                >
                <code
                  class="flex-1 rounded-md border bg-muted/50 px-3 py-1.5 font-mono text-xs overflow-hidden text-ellipsis whitespace-nowrap"
                  >{tunnelUrl.replace(/[?#]token=.*$/, "?token=...")}</code
                >
                <button
                  class="rounded-md border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent transition-colors shrink-0"
                  onclick={async () => {
                    await navigator.clipboard.writeText(tunnelUrl);
                    webTunnelLinkCopied = true;
                    dbg("settings", "tunnelLink copied");
                    setTimeout(() => (webTunnelLinkCopied = false), 1500);
                  }}
                >
                  {webTunnelLinkCopied
                    ? t("settings_general_webCopied")
                    : t("settings_general_webCopyLink")}
                </button>
                <button
                  class="rounded-md border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent transition-colors shrink-0"
                  onclick={async () => {
                    try {
                      const { open } = await import("@tauri-apps/plugin-shell");
                      await open(tunnelUrl);
                      dbg("settings", "tunnelLink opened in browser");
                    } catch (e) {
                      dbgWarn("settings", "failed to open browser", e);
                    }
                  }}
                >
                  {t("settings_general_webOpenBrowser")}
                </button>
              </div>
              <!-- Local link (secondary, muted) -->
              {#if displayHost && localUrl}
                <div class="flex items-center gap-2">
                  <span class="text-xs text-muted-foreground shrink-0"
                    >{t("settings_general_webLocalLink")}</span
                  >
                  <code
                    class="flex-1 rounded-md border bg-muted/30 px-3 py-1.5 font-mono text-xs text-muted-foreground overflow-hidden text-ellipsis whitespace-nowrap"
                    >{localUrl.replace(/#token=.*$/, "#token=...")}</code
                  >
                  <button
                    class="rounded-md border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent transition-colors shrink-0"
                    onclick={async () => {
                      if (localUrl) {
                        await navigator.clipboard.writeText(localUrl);
                        webLinkCopied = true;
                        dbg("settings", "localLink copied");
                        setTimeout(() => (webLinkCopied = false), 1500);
                      }
                    }}
                  >
                    {webLinkCopied
                      ? t("settings_general_webCopied")
                      : t("settings_general_webCopyLink")}
                  </button>
                </div>
              {/if}
            {:else if displayHost}
              <div class="flex items-center gap-2">
                <code
                  class="flex-1 rounded-md border bg-muted/50 px-3 py-1.5 font-mono text-xs overflow-hidden text-ellipsis whitespace-nowrap"
                  >{`http://${displayHost}:${webStatus.port}/login#token=...`}</code
                >
                <button
                  class="rounded-md border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent transition-colors shrink-0"
                  onclick={copyAccessLink}
                >
                  {webLinkCopied
                    ? t("settings_general_webCopied")
                    : t("settings_general_webCopyLink")}
                </button>
                <button
                  class="rounded-md border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent transition-colors shrink-0"
                  onclick={openAccessLink}
                >
                  {t("settings_general_webOpenBrowser")}
                </button>
              </div>
            {:else if isAllInterfaces}
              <p class="text-xs text-amber-400">
                {t("settings_general_webLanIpFailed")}
              </p>
            {/if}
            <!-- Token reveal + regenerate -->
            <div class="flex items-center gap-3 text-xs text-muted-foreground">
              {#if showWebToken}
                <code class="font-mono text-[11px] select-all">{webToken}</code>
                <button
                  class="hover:text-foreground transition-colors shrink-0"
                  onclick={() => (showWebToken = false)}
                >
                  {t("settings_general_hide")}
                </button>
                <button
                  class="hover:text-foreground transition-colors shrink-0"
                  onclick={async () => {
                    if (webToken) {
                      await navigator.clipboard.writeText(webToken);
                      webTokenCopied = true;
                      dbg("settings", "webToken copied");
                      setTimeout(() => (webTokenCopied = false), 1500);
                    }
                  }}
                >
                  {webTokenCopied ? t("settings_general_webCopied") : t("settings_general_webCopy")}
                </button>
              {:else}
                <button
                  class="hover:text-foreground transition-colors"
                  onclick={() => (showWebToken = true)}
                >
                  {t("settings_general_webShowToken")}
                </button>
              {/if}
              <span class="text-border">|</span>
              <button
                class="text-amber-400/70 hover:text-amber-400 transition-colors"
                onclick={async () => {
                  try {
                    const newToken = await api.regenerateWebServerToken();
                    webToken = newToken;
                    showWebToken = false;
                    webTokenCopied = false;
                    webLinkCopied = false;
                    dbg("settings", "webToken regenerated");
                  } catch (e) {
                    dbgWarn("settings", "webToken regenerate failed", e);
                  }
                }}
              >
                {t("settings_general_webRegenerate")}
              </button>
              <span class="text-muted-foreground">--</span>
              <span class="text-muted-foreground">{t("settings_general_webRegenerateDesc")}</span>
            </div>
          </div>
        {/if}

        <!-- HTTP Tunnel -->
        <div>
          <p class="text-sm font-medium mb-1.5">{t("settings_general_webTunnel")}</p>
          <input
            type="text"
            class="w-full rounded-md border bg-background px-3 py-1.5 text-sm"
            placeholder={t("settings_general_webTunnelPlaceholder")}
            bind:value={webTunnelUrl}
            onblur={() => {
              const v = webTunnelUrl.trim();
              if (v) {
                try {
                  const u = new URL(v);
                  if (u.protocol !== "http:" && u.protocol !== "https:") {
                    webTunnelError = t("settings_general_webTunnelInvalid");
                  } else {
                    webTunnelError = null;
                  }
                } catch {
                  webTunnelError = t("settings_general_webTunnelInvalid");
                }
              } else {
                webTunnelError = null;
              }
            }}
          />
          {#if webTunnelError}
            <p class="text-xs text-red-400 mt-1">{webTunnelError}</p>
          {:else}
            <p class="text-xs text-muted-foreground mt-1">
              {t("settings_general_webTunnelDesc")}
            </p>
          {/if}
        </div>

        <!-- Access + Port -- side by side -->
        <div class="grid grid-cols-[1fr_auto] gap-4 items-start">
          <div>
            <p class="text-sm font-medium mb-1.5">{t("settings_general_webAccess")}</p>
            <div class="flex gap-2">
              <button
                class="flex-1 rounded-md border px-3 py-2 text-[13px] transition-colors {webBindValue ===
                '127.0.0.1'
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-accent'}"
                onclick={() => (webBindValue = "127.0.0.1")}
              >
                {t("settings_general_webAccessLocal")}
              </button>
              <button
                class="flex-1 rounded-md border px-3 py-2 text-[13px] transition-colors {webBindValue ===
                '0.0.0.0'
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-accent'}"
                onclick={() => (webBindValue = "0.0.0.0")}
              >
                {t("settings_general_webAccessLan")}
              </button>
            </div>
            <p class="text-xs text-muted-foreground mt-1">
              {t("settings_general_webAccessDesc")}
            </p>
          </div>
          <div>
            <p class="text-sm font-medium mb-1.5">{t("settings_general_webPort")}</p>
            <input
              type="number"
              class="w-24 rounded-md border bg-background px-3 py-1.5 text-sm"
              bind:value={webPortInput}
              min="1024"
              max="65535"
              onblur={() => {
                const n = parseInt(webPortInput, 10);
                if (isNaN(n) || n < 1024 || n > 65535) {
                  webRestartError = t("settings_general_webPortInvalid");
                } else {
                  if (webRestartError === t("settings_general_webPortInvalid")) {
                    webRestartError = null;
                  }
                }
              }}
            />
          </div>
        </div>

        <!-- Advanced (collapsible) -->
        <div>
          <button
            class="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            onclick={() => (webAdvancedOpen = !webAdvancedOpen)}
          >
            <svg
              class="h-3 w-3 transition-transform {webAdvancedOpen ? 'rotate-90' : ''}"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"><path d="m9 18 6-6-6-6" /></svg
            >
            {t("settings_general_webAdvanced")}
          </button>

          {#if webAdvancedOpen}
            <div class="mt-3 space-y-2">
              <p class="text-sm font-medium">{t("settings_general_webAllowedOrigins")}</p>
              {#if webOrigins.length > 0}
                <div class="flex flex-wrap gap-1.5">
                  {#each webOrigins as origin, i}
                    <span
                      class="inline-flex items-center gap-1 rounded-full border bg-muted/50 px-2.5 py-0.5 text-xs"
                    >
                      {origin}
                      <button
                        class="text-muted-foreground hover:text-foreground"
                        onclick={() => {
                          webOrigins = webOrigins.filter((_, idx) => idx !== i);
                        }}
                      >
                        <svg
                          class="h-3 w-3"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"><path d="M18 6L6 18M6 6l12 12" /></svg
                        >
                      </button>
                    </span>
                  {/each}
                </div>
              {/if}
              <div class="flex gap-2">
                <input
                  type="text"
                  class="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm"
                  placeholder={t("settings_general_webAllowedOriginsPlaceholder")}
                  bind:value={webOriginInput}
                  onkeydown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addWebOrigin();
                    }
                  }}
                />
                <button
                  class="rounded-md border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent transition-colors shrink-0"
                  onclick={addWebOrigin}
                >
                  {t("settings_general_webAddOrigin")}
                </button>
              </div>
              {#if webOriginError}
                <p class="text-xs text-red-400">{webOriginError}</p>
              {/if}
              <p class="text-xs text-muted-foreground">
                {t("settings_general_webAllowedOriginsDesc")}
              </p>
            </div>
          {/if}
        </div>

        <!-- Apply + feedback -->
        <div class="space-y-2 pt-2 border-t border-border">
          {#if webRestartError}
            <p class="text-xs text-red-400">
              {t("settings_general_webRestartFailed", { error: webRestartError })}
            </p>
          {/if}
          {#if webRestartWarning}
            <p class="text-xs text-amber-400">{webRestartWarning}</p>
          {/if}
          <button
            class="rounded-md border border-primary px-4 py-2 text-sm font-medium text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
            disabled={webRestarting}
            onclick={applyWebServerSettings}
          >
            {#if webRestarting}
              <span class="inline-flex items-center gap-2">
                <span
                  class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent"
                ></span>
                {t("settings_general_webApplying")}
              </span>
            {:else}
              {t("settings_general_webApply")}
            {/if}
          </button>
        </div>
      {:else}
        <p class="text-sm text-muted-foreground">
          {t("settings_general_webDisabled")}
        </p>
      {/if}
    </Card>
  {/if}

  <!-- Session Mode Card -->
  <Card class="p-6 space-y-4">
    <h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
      {t("settings_sessionMode")}
    </h2>

    <div class="space-y-2">
      <div>
        <p class="text-sm font-medium">{t("settings_defaultSessionMode")}</p>
        <p class="text-xs text-muted-foreground mt-0.5">
          {t("settings_defaultSessionModeDesc")}
        </p>
      </div>
      <!-- Capsule toggle group -- full width, equal columns -->
      <div class="grid grid-cols-3 rounded-lg border border-border bg-muted/40 p-0.5 gap-0.5">
        <button
          type="button"
          class="rounded-md px-2 py-1.5 text-xs font-medium transition-all duration-150 select-none whitespace-nowrap text-center
            {(settings?.default_session_mode ?? 'worktree') === 'single'
            ? 'bg-background text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground'}"
          onclick={async () => {
            const prev = settings;
            if (settings) settings = { ...settings, default_session_mode: "single" };
            try {
              settings = await api.updateUserSettings({
                default_session_mode: "single",
              } as Partial<UserSettings>);
              onSettingsUpdated(settings);
            } catch {
              settings = prev;
            }
          }}
        >
          {t("settings_sessionModeSingle")}
        </button>
        <button
          type="button"
          class="rounded-md px-2 py-1.5 text-xs font-medium transition-all duration-150 select-none whitespace-nowrap text-center
            {(settings?.default_session_mode ?? 'worktree') === 'worktree'
            ? 'bg-background text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground'}"
          onclick={async () => {
            const prev = settings;
            if (settings) settings = { ...settings, default_session_mode: "worktree" };
            try {
              settings = await api.updateUserSettings({
                default_session_mode: "worktree",
              } as Partial<UserSettings>);
              onSettingsUpdated(settings);
            } catch {
              settings = prev;
            }
          }}
        >
          {t("settings_sessionModeWorktree")}
        </button>
        <button
          type="button"
          class="rounded-md px-2 py-1.5 text-xs font-medium transition-all duration-150 select-none whitespace-nowrap text-center
            {(settings?.default_session_mode ?? 'worktree') === 'ask_on_new_branch'
            ? 'bg-background text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground'}"
          onclick={async () => {
            const prev = settings;
            if (settings) settings = { ...settings, default_session_mode: "ask_on_new_branch" };
            try {
              settings = await api.updateUserSettings({
                default_session_mode: "ask_on_new_branch",
              } as Partial<UserSettings>);
              onSettingsUpdated(settings);
            } catch {
              settings = prev;
            }
          }}
        >
          {t("settings_sessionModeAsk")}
        </button>
      </div>
    </div>

    {#if (settings?.default_session_mode ?? "worktree") === "worktree"}
      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm font-medium">{t("settings_autoCommit")}</p>
          <p class="text-xs text-muted-foreground">{t("settings_autoCommitDesc")}</p>
        </div>
        <button
          class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors {settings?.auto_commit_on_complete
            ? 'bg-primary'
            : 'bg-muted'}"
          onclick={async () => {
            settings = await api.updateUserSettings({
              auto_commit_on_complete: !settings?.auto_commit_on_complete,
            } as Partial<UserSettings>);
            onSettingsUpdated(settings);
          }}
        >
          <span
            class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform {settings?.auto_commit_on_complete
              ? 'translate-x-6'
              : 'translate-x-1'}"
          ></span>
        </button>
      </div>

      {#if settings?.auto_commit_on_complete}
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium">{t("settings_autoPR")}</p>
            <p class="text-xs text-muted-foreground">{t("settings_autoPRDesc")}</p>
          </div>
          <button
            class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors {settings?.auto_pr_on_complete
              ? 'bg-primary'
              : 'bg-muted'}"
            onclick={async () => {
              settings = await api.updateUserSettings({
                auto_pr_on_complete: !settings?.auto_pr_on_complete,
              } as Partial<UserSettings>);
              onSettingsUpdated(settings);
            }}
          >
            <span
              class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform {settings?.auto_pr_on_complete
                ? 'translate-x-6'
                : 'translate-x-1'}"
            ></span>
          </button>
        </div>
      {/if}

      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm font-medium">{t("settings_autoCleanupWorktree")}</p>
          <p class="text-xs text-muted-foreground">
            {t("settings_autoCleanupWorktreeDesc")}
          </p>
        </div>
        <button
          class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors {settings?.auto_cleanup_worktree !==
          false
            ? 'bg-primary'
            : 'bg-muted'}"
          onclick={async () => {
            settings = await api.updateUserSettings({
              auto_cleanup_worktree: settings?.auto_cleanup_worktree === false,
            } as Partial<UserSettings>);
            onSettingsUpdated(settings);
          }}
        >
          <span
            class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform {settings?.auto_cleanup_worktree !==
            false
              ? 'translate-x-6'
              : 'translate-x-1'}"
          ></span>
        </button>
      </div>
    {/if}
  </Card>

  <!-- Chat Display Card -->
  <Card class="p-6 space-y-4">
    <h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
      {t("settings_chatDisplay") || "对话显示"}
    </h2>
    <SettingsToggle
      checked={settings?.show_token_usage_report !== false}
      onchange={async (v) => {
        settings = await api.updateUserSettings({
          show_token_usage_report: v,
        } as Partial<UserSettings>);
        onSettingsUpdated(settings);
      }}
      label={t("settings_showTokenReport") || "显示Token用量报告"}
      description={t("settings_showTokenReportDesc") ||
        "每次问答结束后在对话底部显示输入/输出/缓存Token统计"}
    />
  </Card>
</div>
