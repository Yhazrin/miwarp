<script lang="ts">
  /**
   * Embedded App shell — Phase 3 WebView entry point.
   *
   * Loaded inside Tauri WebView windows spawned by the WebViewRuntime so
   * the user can host arbitrary web content with a persistent local data
   * store. The actual data store + IPC bridge ships in a follow-up; this
   * scaffold only verifies the launch path renders.
   */
  import { onMount } from "svelte";

  let ready = $state(false);
  let sessionId = $state("");
  let profileId = $state("");

  onMount(() => {
    const params = new URLSearchParams(window.location.search);
    sessionId = params.get("sessionId") ?? "";
    profileId = params.get("profileId") ?? "";
    ready = true;
  });
</script>

<div class="flex h-full items-center justify-center bg-background text-foreground">
  <div class="max-w-md text-center">
    <h1 class="mb-2 text-lg font-semibold">Embedded App</h1>
    {#if ready}
      <p class="text-sm text-muted-foreground">
        WebView Runtime session <span class="font-mono">{sessionId || "(none)"}</span>
      </p>
      {#if profileId}
        <p class="mt-1 text-xs text-muted-foreground">
          Profile: <span class="font-mono">{profileId}</span>
        </p>
      {/if}
      <p class="mt-4 text-xs text-muted-foreground">
        Phase 3 scaffold — local data store + IPC bridge ship next.
      </p>
    {:else}
      <p class="text-sm text-muted-foreground">Loading…</p>
    {/if}
  </div>
</div>
