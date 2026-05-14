<script lang="ts">
  import { onMount } from "svelte";
  import { getTransport } from "$lib/transport";
  import { dbg, dbgWarn } from "$lib/utils/debug";
  import { t } from "$lib/i18n/index.svelte";

  const WEBVIEW_LABEL = "chat-preview-pane";
  const PREVIEW_URL_KEY = "ocv:preview-url";
  const DEFAULT_URL = "http://localhost:3000";

  let {
    active = false,
    requestedUrl = $bindable(null as string | null),
  }: {
    active?: boolean;
    requestedUrl?: string | null;
  } = $props();

  type TauriWebview = import("@tauri-apps/api/webview").Webview;

  let shellRoot: HTMLDivElement | undefined = $state();
  let viewportEl: HTMLDivElement | undefined = $state();
  let desktopAvailable = $state(false);
  let currentUrl = $state(loadStoredUrl());
  let urlInput = $state(loadStoredUrl());
  let lastError = $state("");
  let creating = $state(false);
  let syncing = false;
  let resizeObserver: ResizeObserver | null = null;
  let webviewApi: typeof import("@tauri-apps/api/webview") | null = null;
  let windowApi: typeof import("@tauri-apps/api/window") | null = null;
  let dpiApi: typeof import("@tauri-apps/api/dpi") | null = null;
  let webview: TauriWebview | null = null;

  function loadStoredUrl(): string {
    if (typeof window === "undefined") return DEFAULT_URL;
    return window.localStorage.getItem(PREVIEW_URL_KEY) ?? DEFAULT_URL;
  }

  function normalizeUrl(raw: string): string | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const withScheme = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|::1)(:\d+)?(\/|$)/i.test(trimmed)
        ? `http://${trimmed}`
        : `https://${trimmed}`;
    try {
      const parsed = new URL(withScheme);
      if (!["http:", "https:"].includes(parsed.protocol)) return null;
      return parsed.toString();
    } catch {
      return null;
    }
  }

  function persistUrl(url: string) {
    currentUrl = url;
    urlInput = url;
    if (typeof window !== "undefined") {
      window.localStorage.setItem(PREVIEW_URL_KEY, url);
    }
  }

  async function ensureApis() {
    if (webviewApi && windowApi && dpiApi) return;
    [webviewApi, windowApi, dpiApi] = await Promise.all([
      import("@tauri-apps/api/webview"),
      import("@tauri-apps/api/window"),
      import("@tauri-apps/api/dpi"),
    ]);
  }

  async function waitForCreate(instance: TauriWebview): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      void instance.once("tauri://created", () => {
        if (settled) return;
        settled = true;
        resolve();
      });
      void instance.once("tauri://error", (event) => {
        if (settled) return;
        settled = true;
        reject(event.payload);
      });
    });
  }

  async function getExistingWebview(): Promise<TauriWebview | null> {
    await ensureApis();
    return webviewApi!.Webview.getByLabel(WEBVIEW_LABEL);
  }

  async function closeWebview() {
    const existing = webview ?? (await getExistingWebview());
    if (!existing) return;
    try {
      await existing.close();
    } catch (error) {
      dbgWarn("preview-pane", "close failed", error);
    } finally {
      webview = null;
    }
  }

  async function syncBounds() {
    if (!active || !webview || !viewportEl) return;
    if (syncing) return;
    syncing = true;
    try {
      await ensureApis();
      const rect = viewportEl.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      const x = Math.round(rect.left);
      const y = Math.round(rect.top);
      await Promise.all([
        webview.setPosition(new dpiApi!.LogicalPosition(x, y)),
        webview.setSize(new dpiApi!.LogicalSize(width, height)),
      ]);
    } catch (error) {
      dbgWarn("preview-pane", "sync bounds failed", error);
    } finally {
      syncing = false;
    }
  }

  async function ensureWebview(url = currentUrl) {
    if (!desktopAvailable || !viewportEl) return;
    const normalized = normalizeUrl(url);
    if (!normalized) {
      lastError = t("preview_invalidUrl");
      return;
    }
    creating = true;
    lastError = "";
    try {
      await ensureApis();
      const existing = await webviewApi!.Webview.getByLabel(WEBVIEW_LABEL);
      if (existing && normalized !== currentUrl) {
        try {
          await existing.close();
        } catch (error) {
          dbgWarn("preview-pane", "replace existing webview failed", error);
        }
        webview = null;
      } else if (existing) {
        webview = existing;
      }
      if (!webview) {
        const currentWindow = windowApi!.getCurrentWindow();
        const instance = new webviewApi!.Webview(currentWindow, WEBVIEW_LABEL, {
          url: normalized,
          x: 0,
          y: 0,
          width: 16,
          height: 16,
          focus: false,
          zoomHotkeysEnabled: true,
          devtools: import.meta.env.DEV,
        });
        await waitForCreate(instance);
        webview = instance;
      }
      persistUrl(normalized);
      await syncBounds();
      await webview.show();
      await webview.setFocus().catch(() => {});
      dbg("preview-pane", "webview ready", { url: normalized });
    } catch (error) {
      lastError = t("preview_openFailed");
      dbgWarn("preview-pane", "ensure webview failed", error);
    } finally {
      creating = false;
    }
  }

  async function hideWebview() {
    if (!webview) return;
    try {
      await webview.hide();
    } catch (error) {
      dbgWarn("preview-pane", "hide failed", error);
    }
  }

  async function handleGo() {
    const normalized = normalizeUrl(urlInput);
    if (!normalized) {
      lastError = t("preview_invalidUrl");
      return;
    }
    await closeWebview();
    await ensureWebview(normalized);
  }

  async function handleResetSession() {
    if (!desktopAvailable) return;
    try {
      const existing = webview ?? (await getExistingWebview());
      if (existing) {
        await existing.clearAllBrowsingData();
      }
      await closeWebview();
      await ensureWebview(currentUrl);
      lastError = "";
    } catch (error) {
      lastError = t("preview_resetFailed");
      dbgWarn("preview-pane", "clear browsing data failed", error);
    }
  }

  $effect(() => {
    if (requestedUrl) {
      urlInput = requestedUrl;
      if (active) {
        void handleGo();
      }
      requestedUrl = null;
    }
  });

  $effect(() => {
    if (!desktopAvailable) return;
    if (active) {
      void ensureWebview(currentUrl);
    } else {
      void hideWebview();
    }
  });

  onMount(() => {
    desktopAvailable = getTransport().isDesktop();
    if (!desktopAvailable) return;

    const scheduleSync = () => {
      if (!active) return;
      requestAnimationFrame(() => {
        void syncBounds();
      });
    };

    resizeObserver = new ResizeObserver(scheduleSync);
    if (shellRoot) resizeObserver.observe(shellRoot);
    if (viewportEl) resizeObserver.observe(viewportEl);
    window.addEventListener("resize", scheduleSync);
    window.addEventListener("scroll", scheduleSync, true);

    return () => {
      resizeObserver?.disconnect();
      resizeObserver = null;
      window.removeEventListener("resize", scheduleSync);
      window.removeEventListener("scroll", scheduleSync, true);
      void closeWebview();
    };
  });
</script>

<div bind:this={shellRoot} class="flex h-full min-h-0 flex-col gap-2 bg-transparent p-2">
  <div class="rounded-2xl border border-border/40 bg-background/40 px-3 py-2 backdrop-blur-xl">
    <div class="mb-2 flex items-center gap-2">
      <span class="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary"
        >{t("preview_nativeBadge")}</span
      >
      <span class="text-[10px] text-muted-foreground">{t("preview_cookieHint")}</span>
    </div>
    <div class="flex items-center gap-2">
      <input
        type="text"
        bind:value={urlInput}
        placeholder="http://localhost:3000"
        class="min-w-0 flex-1 rounded-xl border border-border/50 bg-background/40 px-3 py-1.5 text-xs text-foreground outline-none transition-colors focus:border-primary/50"
        onkeydown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void handleGo();
          }
        }}
      />
      <button
        class="rounded-xl border border-border/50 bg-background/30 px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent/20 disabled:opacity-50"
        onclick={handleGo}
        disabled={creating}
      >
        {creating ? t("preview_loading") : t("preview_go")}
      </button>
      <button
        class="rounded-xl border border-border/50 bg-background/30 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent/20 hover:text-foreground"
        onclick={() => void handleResetSession()}
        title={t("preview_resetSession")}
      >
        {t("preview_resetShort")}
      </button>
    </div>
    {#if lastError}
      <p class="mt-2 text-[11px] text-destructive">{lastError}</p>
    {/if}
  </div>

  {#if !desktopAvailable}
    <div
      class="flex flex-1 items-center justify-center rounded-2xl border border-border/30 bg-background/30 px-6 text-center text-sm text-muted-foreground backdrop-blur-xl"
    >
      {t("preview_desktopOnly")}
    </div>
  {:else}
    <div
      class="relative min-h-0 flex-1 overflow-hidden rounded-2xl border border-border/30 bg-background/20 backdrop-blur-xl"
    >
      <div bind:this={viewportEl} class="absolute inset-1 rounded-xl"></div>
      {#if !active}
        <div
          class="absolute inset-0 flex items-center justify-center rounded-2xl bg-background/70 text-sm text-muted-foreground"
        >
          {t("preview_switchHint")}
        </div>
      {/if}
    </div>
  {/if}
</div>
