<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { t } from "$lib/i18n/index.svelte";

  let {
    runId = "",
    sessionId = "",
    currentRunId = "",
    currentCwd = "/",
  }: {
    runId?: string;
    sessionId?: string;
    currentRunId?: string;
    currentCwd?: string;
  } = $props();

  let toolbarVisible = $state(false);
  let toolbarStyle = $state("");
  let selectedText = $state("");

  function handleMouseUp() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      toolbarVisible = false;
      return;
    }

    const text = selection.toString().trim();
    if (!text) {
      toolbarVisible = false;
      return;
    }

    selectedText = text;

    // Calculate position
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    toolbarStyle = `position:fixed; top:${rect.top - 44}px; left:${rect.left + rect.width / 2}px; transform:translateX(-50%); z-index:40;`;
    toolbarVisible = true;
  }

  function handleClickOutside(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target.closest(".selection-toolbar")) {
      toolbarVisible = false;
    }
  }

  async function handleSendToSession() {
    if (!selectedText) return;

    const { contextRelayStore } = await import("$lib/context-relay/context-relay-store.svelte");
    const { buildSelectionClip } = await import("$lib/context-relay/context-clip-builder");

    const clip = buildSelectionClip({
      runId: currentRunId,
      sessionId,
      text: selectedText,
    });

    contextRelayStore.openModal(clip, currentRunId, currentCwd);
    toolbarVisible = false;
  }

  async function handleCopyToClipboard() {
    try {
      await navigator.clipboard.writeText(selectedText);
    } catch {
      // Silently fail
    }
    toolbarVisible = false;
  }

  onMount(() => {
    document.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("mousedown", handleClickOutside);
  });

  onDestroy(() => {
    document.removeEventListener("mouseup", handleMouseUp);
    document.removeEventListener("mousedown", handleClickOutside);
  });
</script>

{#if toolbarVisible}
  <div
    class="selection-toolbar animate-fade-in rounded-lg border border-border/60 bg-background/80 backdrop-blur-md ring-1 ring-white/10 flex items-center gap-0.5 px-1.5 py-1"
    style={toolbarStyle}
  >
    <button
      class="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent"
      onclick={handleSendToSession}
      title={t("contextRelay_sendToSession")}
    >
      <svg
        class="h-3.5 w-3.5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
      <span>{t("contextRelay_sendToSession") || "Send"}</span>
    </button>

    <div class="h-4 w-px bg-border/50 mx-0.5"></div>

    <button
      class="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      onclick={handleCopyToClipboard}
      title={t("chat_copyMessage")}
    >
      <svg
        class="h-3.5 w-3.5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <rect width="14" height="14" x="8" y="8" rx="2" />
        <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
      </svg>
      <span>{t("common_copy") || "Copy"}</span>
    </button>
  </div>
{/if}
