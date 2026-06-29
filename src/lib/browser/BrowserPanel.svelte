<script lang="ts">
  /**
   * BrowserPanel - 浏览器面板组件
   *
   * 提供地址栏、控制按钮、浏览器视图区域
   */
  import { browserRuntime } from "./browser-runtime-store.svelte";
  import Icon from "$lib/components/Icon.svelte";

  let url = $state("");

  async function handleNavigate() {
    if (!browserRuntime.currentSession) return;
    const tabs = browserRuntime.currentSession.tabs;
    if (tabs.length > 0) {
      await browserRuntime.navigate(tabs[0].targetId, url);
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      handleNavigate();
    }
  }
</script>

<div class="flex h-full flex-col">
  <!-- 工具栏 -->
  <div class="flex items-center gap-2 border-b p-2">
    <button
      type="button"
      class="rounded p-1 hover:bg-accent"
      title={"Back"}
      onclick={() => browserRuntime.perform({ type: "GoBack" })}
    >
      <Icon name="arrow-left" size="sm" />
    </button>
    <button
      type="button"
      class="rounded p-1 hover:bg-accent"
      title={"Forward"}
      onclick={() => browserRuntime.perform({ type: "GoForward" })}
    >
      <Icon name="arrow-right" size="sm" />
    </button>
    <button
      type="button"
      class="rounded p-1 hover:bg-accent"
      title={"Refresh"}
      onclick={() => browserRuntime.perform({ type: "Refresh" })}
    >
      <Icon name="refresh-cw" size="sm" />
    </button>
    <input
      type="text"
      bind:value={url}
      placeholder={"Enter URL..."}
      class="flex-1 rounded border px-3 py-1.5 text-sm"
      onkeydown={handleKeydown}
    />
    <button
      type="button"
      class="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90"
      onclick={handleNavigate}
    >
      {"Go"}
    </button>
  </div>

  <!-- 浏览器视图区域 -->
  <div class="flex-1 relative bg-muted/20">
    {#if browserRuntime.currentObservation?.screenshot}
      <img
        src="data:image/webp;base64,{browserRuntime.currentObservation.screenshot}"
        alt="Browser screenshot"
        class="h-full w-full object-contain"
      />
    {:else if browserRuntime.isLoading}
      <div class="flex h-full items-center justify-center">
        <div class="text-muted-foreground">{"Loading..."}</div>
      </div>
    {:else if browserRuntime.currentSession}
      <div class="flex h-full items-center justify-center">
        <div class="text-center">
          <Icon name="globe" size="lg" class="mx-auto mb-2 text-muted-foreground" />
          <p class="text-muted-foreground">{"Browser ready"}</p>
        </div>
      </div>
    {:else}
      <div class="flex h-full items-center justify-center">
        <div class="text-center">
          <Icon name="monitor" size="lg" class="mx-auto mb-2 text-muted-foreground" />
          <p class="text-muted-foreground">{"No active browser session"}</p>
        </div>
      </div>
    {/if}
  </div>

  <!-- 状态栏 -->
  {#if browserRuntime.error}
    <div class="border-t bg-destructive/10 p-2 text-sm text-destructive">
      {browserRuntime.error}
    </div>
  {/if}
</div>
