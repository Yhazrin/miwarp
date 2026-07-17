<script lang="ts">
  /**
   * BrowserPanel - 浏览器面板组件
   *
   * 提供 profile 选择、launch 按钮、地址栏、控制按钮、浏览器视图区域。
   * 与 store 解耦：所有调用都通过 `browserRuntime`。
   */
  import { browserRuntime } from "./browser-runtime-store.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import type { BrowserTabDto } from "$lib/api/browser-runtime";

  let url = $state("");
  let tabs = $state<BrowserTabDto[]>([]);
  let selectedProfileId = $state("");

  const currentSession = $derived(browserRuntime.currentSession);
  const isLoading = $derived(browserRuntime.isLoading);
  const observation = $derived(browserRuntime.currentObservation);
  const error = $derived(browserRuntime.error);

  // Auto-load profiles + existing sessions on mount.
  $effect(() => {
    void browserRuntime.loadProfiles();
    void browserRuntime.refreshSessions();
  });

  // Re-sync tab list whenever the active session changes.
  $effect(() => {
    const sessionId = browserRuntime.currentSessionId;
    if (!sessionId) {
      tabs = [];
      return;
    }
    let cancelled = false;
    void browserRuntime.listTabs(sessionId).then((result) => {
      if (!cancelled) tabs = result;
    });
    return () => {
      cancelled = true;
    };
  });

  async function handleNavigate() {
    const tabId = browserRuntime.currentTabId;
    if (!tabId) return;
    const trimmed = url.trim();
    if (!trimmed) return;
    await browserRuntime.navigate(tabId, trimmed);
    await browserRuntime.observe(tabId);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      void handleNavigate();
    }
  }

  async function handleLaunch() {
    if (!selectedProfileId) return;
    await browserRuntime.launchProfile(selectedProfileId);
    const sid = browserRuntime.currentSessionId;
    if (sid) {
      tabs = await browserRuntime.listTabs(sid);
    }
  }

  async function handleBack() {
    await browserRuntime.perform({ type: "GoBack" });
    if (browserRuntime.currentTabId) {
      await browserRuntime.observe();
    }
  }

  async function handleForward() {
    await browserRuntime.perform({ type: "GoForward" });
    if (browserRuntime.currentTabId) {
      await browserRuntime.observe();
    }
  }

  async function handleRefresh() {
    await browserRuntime.perform({ type: "Refresh" });
    if (browserRuntime.currentTabId) {
      await browserRuntime.observe();
    }
  }

  async function handleClose() {
    await browserRuntime.closeSession();
    tabs = [];
  }

  async function handleCreateProfile() {
    const name = window.prompt("Profile name", "default")?.trim();
    if (!name) return;
    try {
      await browserRuntime.createProfile(name, "chrome");
      await browserRuntime.loadProfiles();
    } catch {
      // store already records error
    }
  }
</script>

<div class="flex h-full flex-col">
  <!-- Profile / launch row -->
  {#if !currentSession}
    <div class="flex items-center gap-2 border-b p-2">
      <select
        bind:value={selectedProfileId}
        class="flex-1 rounded border bg-background px-2 py-1 text-sm"
      >
        <option value="" disabled>Select a profile…</option>
        {#each browserRuntime.profiles as profile (profile.id)}
          <option value={profile.id}>{profile.name} · {profile.engine}</option>
        {/each}
      </select>
      <button
        type="button"
        class="rounded border px-3 py-1 text-sm hover:bg-accent"
        onclick={handleCreateProfile}
      >
        New profile
      </button>
      <button
        type="button"
        disabled={!selectedProfileId || isLoading}
        class="rounded bg-primary px-3 py-1 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        onclick={handleLaunch}
      >
        Launch
      </button>
    </div>
  {/if}

  <!-- Toolbar -->
  {#if currentSession}
    <div class="flex items-center gap-2 border-b p-2">
      <button type="button" class="rounded p-1 hover:bg-accent" title="Back" onclick={handleBack}>
        <Icon name="arrow-left" size="sm" />
      </button>
      <button
        type="button"
        class="rounded p-1 hover:bg-accent"
        title="Forward"
        onclick={handleForward}
      >
        <Icon name="arrow-right" size="sm" />
      </button>
      <button
        type="button"
        class="rounded p-1 hover:bg-accent"
        title="Refresh"
        onclick={handleRefresh}
      >
        <Icon name="refresh-cw" size="sm" />
      </button>
      <input
        type="text"
        bind:value={url}
        placeholder={observation?.url ?? "Enter URL..."}
        class="flex-1 rounded border px-3 py-1.5 text-sm"
        onkeydown={handleKeydown}
      />
      <button
        type="button"
        class="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90"
        onclick={handleNavigate}
      >
        Go
      </button>
      <button
        type="button"
        class="rounded border px-2 py-1 text-xs hover:bg-accent"
        onclick={handleClose}
      >
        Close session
      </button>
    </div>
  {/if}

  <!-- Tab switcher -->
  {#if tabs.length > 1}
    <div class="flex items-center gap-1 border-b bg-muted/30 px-2 py-1 text-xs">
      {#each tabs as tab (tab.targetId)}
        <button
          type="button"
          class="max-w-[180px] truncate rounded px-2 py-0.5 hover:bg-accent {tab.targetId ===
          browserRuntime.currentTabId
            ? 'bg-accent'
            : ''}"
          onclick={() => browserRuntime.selectTab(tab.targetId)}
          title={tab.url}
        >
          {tab.title || tab.url || "untitled"}
        </button>
      {/each}
    </div>
  {/if}

  <!-- 浏览器视图区域 -->
  <div class="relative flex-1 bg-muted/20">
    {#if observation?.screenshot}
      <img
        src="data:image/webp;base64,{observation.screenshot}"
        alt="Browser screenshot"
        class="h-full w-full object-contain"
      />
    {:else if isLoading}
      <div class="flex h-full items-center justify-center">
        <div class="text-muted-foreground">Loading...</div>
      </div>
    {:else if currentSession}
      <div class="flex h-full items-center justify-center">
        <div class="text-center">
          <Icon name="globe" size="lg" class="mx-auto mb-2 text-muted-foreground" />
          <p class="text-muted-foreground">Click "Refresh" to capture the current page.</p>
        </div>
      </div>
    {:else}
      <div class="flex h-full items-center justify-center">
        <div class="text-center">
          <Icon name="monitor" size="lg" class="mx-auto mb-2 text-muted-foreground" />
          <p class="text-muted-foreground">No active browser session</p>
        </div>
      </div>
    {/if}
  </div>

  <!-- 状态栏 -->
  {#if error}
    <div class="border-t bg-destructive/10 p-2 text-sm text-destructive">
      {error}
    </div>
  {/if}
</div>
