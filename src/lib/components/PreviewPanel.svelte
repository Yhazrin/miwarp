<script lang="ts">
  import { onMount, tick } from "svelte";
  import { getTransport } from "$lib/transport";
  import { dbg, dbgWarn } from "$lib/utils/debug";
  import { t } from "$lib/i18n/index.svelte";

  const WEBVIEW_LABEL = "chat-preview-pane";
  const PREVIEW_URL_KEY = "ocv:preview-url";
  const QUICK_PORTS = [
    { label: ":3000", url: "http://localhost:3000" },
    { label: ":5173", url: "http://localhost:5173" },
    { label: ":4173", url: "http://localhost:4173" },
    { label: ":8080", url: "http://localhost:8080" },
    { label: ":1420", url: "http://localhost:1420" },
  ];

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
  let currentUrl = $state("");
  let urlInput = $state(loadStoredUrl());
  let lastError = $state("");
  let creating = $state(false);
  let hasLoaded = $state(false);
  let syncing = false;
  let resizeObserver: ResizeObserver | null = null;
  let webviewApi: typeof import("@tauri-apps/api/webview") | null = null;
  let windowApi: typeof import("@tauri-apps/api/window") | null = null;
  let dpiApi: typeof import("@tauri-apps/api/dpi") | null = null;
  let webview: TauriWebview | null = null;

  function loadStoredUrl(): string {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem(PREVIEW_URL_KEY) ?? "";
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

  async function waitForStableViewportRect(): Promise<DOMRect> {
    for (let i = 0; i < 12; i++) {
      await tick();
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const rect = viewportEl?.getBoundingClientRect();
      if (rect && rect.width >= 20 && rect.height >= 20) {
        return rect;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("Preview viewport is not ready or has zero size");
  }

  async function waitForCreate(instance: TauriWebview): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error("Webview creation timed out"));
        }
      }, 10000);

      void instance.once("tauri://created", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve();
      });
      void instance.once("tauri://error", (event) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
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

  async function syncBounds(options: { force?: boolean } = {}) {
    const { force = false } = options;
    if (!force && !active) return;
    if (!webview || !viewportEl) return;
    if (syncing) return;

    syncing = true;
    try {
      await ensureApis();
      const rect = viewportEl.getBoundingClientRect();
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);
      if (width < 20 || height < 20) {
        throw new Error(`Invalid preview bounds: ${width}x${height}`);
      }
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

  async function ensureWebview(url: string) {
    if (!desktopAvailable) return;
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
        const rect = await waitForStableViewportRect();
        const currentWindow = windowApi!.getCurrentWindow();
        const instance = new webviewApi!.Webview(currentWindow, WEBVIEW_LABEL, {
          url: normalized,
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          focus: false,
          zoomHotkeysEnabled: true,
          devtools: import.meta.env.DEV,
          userAgent:
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        });
        await waitForCreate(instance);
        webview = instance;
      }
      persistUrl(normalized);
      hasLoaded = true;
      await syncBounds({ force: true });
      await webview.show();
      dbg("preview-pane", "webview ready", { url: normalized });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastError = `${t("preview_openFailed")}: ${message}`;
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

  function handleQuickPort(url: string) {
    urlInput = url;
    void handleGo();
  }

  async function handleResetSession() {
    if (!desktopAvailable) return;
    try {
      const existing = webview ?? (await getExistingWebview());
      if (existing) {
        if (typeof existing.clearAllBrowsingData === "function") {
          await existing.clearAllBrowsingData();
        }
      }
      await closeWebview();
      if (currentUrl) {
        await ensureWebview(currentUrl);
      }
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

  // Only show/hide an already-created webview; do NOT auto-create on activation
  $effect(() => {
    if (!desktopAvailable) return;
    if (active && webview) {
      requestAnimationFrame(() => {
        void syncBounds({ force: true }).then(() => webview?.show());
      });
    } else if (!active && webview) {
      void hideWebview();
    }
  });

  $effect(() => {
    if (!desktopAvailable || !viewportEl) return;

    const observer = new ResizeObserver(() => {
      if (webview) {
        requestAnimationFrame(() => {
          void syncBounds({ force: true });
        });
      }
    });

    observer.observe(viewportEl);

    return () => observer.disconnect();
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
    <!-- URL bar -->
    <div class="flex items-center gap-2">
      <!-- Globe icon -->
      <svg
        class="h-3.5 w-3.5 shrink-0 text-muted-foreground/60"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" />
        <path
          d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"
        />
      </svg>
      <input
        type="text"
        bind:value={urlInput}
        placeholder="输入网址或 localhost:3000"
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
        {creating ? "..." : "前往"}
      </button>
      {#if hasLoaded}
        <button
          class="rounded-xl border border-border/50 bg-background/30 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent/20 hover:text-foreground"
          onclick={() => void handleResetSession()}
          title={t("preview_resetSession")}
        >
          重置
        </button>
      {/if}
    </div>
    {#if lastError}
      <p class="mt-1.5 text-[11px] text-destructive">{lastError}</p>
    {/if}
    <!-- Native webview hint -->
    <div class="mt-1.5 flex items-center gap-2">
      <span class="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary"
        >原生预览</span
      >
      <span class="text-[10px] text-muted-foreground/60">支持任意网址 · 保持 Cookie 和登录状态</span
      >
    </div>
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

      {#if !hasLoaded}
        <div
          class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 rounded-2xl bg-background/70 px-6 backdrop-blur-xl"
        >
          <div class="text-center">
            <svg
              class="mx-auto mb-3 h-10 w-10 text-muted-foreground/30"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
            <p class="text-sm text-muted-foreground">{t("preview_emptyTitle")}</p>
            <p class="mt-1 text-xs text-muted-foreground/70">{t("preview_emptyHint")}</p>
          </div>
          <div class="flex flex-wrap items-center justify-center gap-2">
            <span class="text-[10px] text-muted-foreground/50">本地端口：</span>
            {#each QUICK_PORTS as qp}
              <button
                class="rounded-lg border border-border/50 bg-background/40 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:bg-accent/20 hover:text-foreground font-mono"
                onclick={() => handleQuickPort(qp.url)}
              >
                {qp.label}
              </button>
            {/each}
          </div>
        </div>
      {/if}

      {#if hasLoaded && !active}
        <div
          class="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-background/70 text-sm text-muted-foreground"
        >
          {t("preview_switchHint")}
        </div>
      {/if}
    </div>
  {/if}
</div>
