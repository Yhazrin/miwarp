<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
  import { fmtTime, fmtDateTime } from "$lib/i18n/format";
  import MarkdownContent from "./MarkdownContent.svelte";
  import FileAttachment from "./FileAttachment.svelte";
  import { IMAGE_TYPES } from "$lib/utils/file-types";
  import type { ChatMessage, Attachment } from "$lib/types";
  import AgentIdentity from "./AgentIdentity.svelte";

  let {
    message,
    attachments,
    thinkingText,
    onRewind,
    onDispatchToTeam,
    agent,
    platformId,
    model,
    animated = false,
  }: {
    message: ChatMessage;
    attachments?: Attachment[];
    thinkingText?: string;
    onRewind?: () => void;
    onDispatchToTeam?: () => void;
    agent?: string;
    platformId?: string;
    model?: string;
    animated?: boolean;
  } = $props();

  function isImage(att: Attachment): boolean {
    return (IMAGE_TYPES as readonly string[]).includes(att.type);
  }

  const isUser = $derived(message.role === "user");

  let hovered = $state(false);
  let copied = $state(false);
  let collapsed = $state(true);
  let thinkingCollapsed = $state(true);

  const lineCount = $derived(message.content.split("\n").length);
  const isLong = $derived(isUser && lineCount > 10);

  function formatTime(ts: string): string {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return "";
    const now = new Date();
    const isToday =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    return isToday ? fmtTime(d) : fmtDateTime(d);
  }

  function formatFullTime(ts: string): string {
    return fmtDateTime(ts);
  }

  async function copyContent() {
    try {
      await navigator.clipboard.writeText(message.content);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      // Silently fail
    }
  }
</script>

<div
  class="w-full {animated ? 'motion-slide-up' : ''}"
  role="group"
  onmouseenter={() => (hovered = true)}
  onmouseleave={() => (hovered = false)}
>
  <div class="chat-content-width py-4">
    <div class={`flex ${isUser ? "justify-end" : ""}`}>
      <div class={`w-full ${isUser ? "max-w-3xl" : ""}`}>
        <!-- Header -->
        <div class={`mb-1.5 flex items-center gap-2 ${isUser ? "justify-end" : ""}`}>
          {#if isUser}
            <span
              class="text-[10px] text-muted-foreground"
              title={formatFullTime(message.timestamp)}
            >
              {formatTime(message.timestamp)}
            </span>
            <button
              class="rounded-md p-1 text-miwarp-text-tertiary transition-all duration-150 hover:bg-miwarp-bg-hover hover:text-miwarp-text-primary {hovered ||
              copied
                ? 'opacity-100'
                : 'opacity-0'}"
              onclick={copyContent}
              title={t("chat_copyMessage")}
              data-export-exclude
            >
              {#if copied}
                <svg
                  class="h-3.5 w-3.5 text-emerald-500"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg
                >
              {:else}
                <svg
                  class="h-3.5 w-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  ><rect width="14" height="14" x="8" y="8" rx="2" /><path
                    d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"
                  /></svg
                >
              {/if}
            </button>
            {#if onRewind}
              <button
                class="rounded-md p-1 text-miwarp-text-tertiary transition-all duration-150 hover:bg-miwarp-bg-hover hover:text-miwarp-text-primary {hovered
                  ? 'opacity-100'
                  : 'opacity-0'}"
                onclick={onRewind}
                title={t("rewind_toHere")}
                data-export-exclude
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
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                  <path d="M3 3v5h5" />
                </svg>
              </button>
            {/if}
            {#if onDispatchToTeam}
              <button
                class="rounded-md p-1 text-miwarp-text-tertiary transition-all duration-150 hover:bg-miwarp-bg-hover hover:text-miwarp-text-primary {hovered
                  ? 'opacity-100'
                  : 'opacity-0'}"
                onclick={onDispatchToTeam}
                title={t("teamRun_dispatchToTeam")}
                data-export-exclude
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
              </button>
            {/if}
            <span class="text-sm font-semibold text-foreground">{t("chat_roleYou")}</span>
            <div
              class="flex h-5 w-5 items-center justify-center rounded-full accent-gradient text-white"
            >
              <svg
                class="h-3 w-3"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </div>
          {:else}
            <AgentIdentity
              {agent}
              {platformId}
              {model}
              size="md"
              {animated}
              showName={true}
              showModel={false}
            />
            {#if onRewind}
              <button
                class="ml-auto rounded-md p-1 text-miwarp-text-tertiary transition-all duration-150 hover:bg-miwarp-bg-hover hover:text-miwarp-text-primary {hovered
                  ? 'opacity-100'
                  : 'opacity-0'}"
                onclick={onRewind}
                title={t("rewind_toHere")}
                data-export-exclude
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
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                  <path d="M3 3v5h5" />
                </svg>
              </button>
            {/if}
            <button
              class="{onRewind
                ? ''
                : 'ml-auto'} rounded-md p-1 text-miwarp-text-tertiary transition-all duration-150 hover:bg-miwarp-bg-hover hover:text-miwarp-text-primary {hovered ||
              copied
                ? 'opacity-100'
                : 'opacity-0'}"
              onclick={copyContent}
              title={t("chat_copyMessage")}
              data-export-exclude
            >
              {#if copied}
                <svg
                  class="h-3.5 w-3.5 text-emerald-500"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg
                >
              {:else}
                <svg
                  class="h-3.5 w-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  ><rect width="14" height="14" x="8" y="8" rx="2" /><path
                    d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"
                  /></svg
                >
              {/if}
            </button>
            <span
              class="text-[10px] text-muted-foreground"
              title={formatFullTime(message.timestamp)}
            >
              {formatTime(message.timestamp)}
            </span>
          {/if}
        </div>
        <!-- Content -->
        <div
          class={`${isUser ? "pr-7 text-right" : "pl-7"} text-sm leading-relaxed text-foreground`}
        >
          {#if isUser}
            {#if attachments && attachments.length > 0}
              <div class={`mb-2 flex flex-wrap gap-2 ${isUser ? "justify-end" : ""}`}>
                {#each attachments as att}
                  {#if isImage(att) && att.contentBase64}
                    <img
                      src="data:{att.type};base64,{att.contentBase64}"
                      alt={att.name}
                      class="max-h-48 max-w-xs rounded-md border border-border object-contain"
                    />
                  {:else}
                    <FileAttachment name={att.name} size={att.size} mimeType={att.type} />
                  {/if}
                {/each}
              </div>
            {/if}
            {#if isLong}
              <p
                class="whitespace-pre-wrap {collapsed ? 'max-h-24 overflow-hidden' : ''}"
                style={collapsed
                  ? "mask-image: linear-gradient(to bottom, black 70%, transparent);"
                  : ""}
              >
                {message.content}
              </p>
              <button
                class="mt-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                onclick={() => (collapsed = !collapsed)}
              >
                {collapsed
                  ? t("common_showAllLines", { count: String(lineCount) })
                  : t("common_collapse")}
              </button>
            {:else}
              <p class="whitespace-pre-wrap">{message.content}</p>
            {/if}
          {:else}
            {#if thinkingText}
              <div
                class="mb-3 rounded-xl border border-[hsl(var(--miwarp-accent-primary)/0.18)] overflow-hidden"
                style="background: hsl(var(--miwarp-bg-deep) / 0.72); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);"
              >
                <button
                  class="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium text-[hsl(var(--miwarp-status-info))] hover:bg-[hsl(var(--miwarp-accent-primary)/0.06)] transition-colors"
                  onclick={() => (thinkingCollapsed = !thinkingCollapsed)}
                >
                  <svg
                    class="h-3 w-3 shrink-0 transition-transform duration-200 {thinkingCollapsed
                      ? ''
                      : 'rotate-90'}"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"><path d="m9 18 6-6-6-6" /></svg
                  >
                  <svg
                    class="h-3.5 w-3.5 shrink-0 opacity-70"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M12 2a8 8 0 0 1 8 8c0 5-8 13-8 13S4 15 4 10a8 8 0 0 1 8-8z" />
                    <circle cx="12" cy="10" r="3" />
                  </svg>
                  <span>{t("chat_thoughtProcess")}</span>
                  <span class="ml-auto text-[10px] opacity-50"
                    >{thinkingCollapsed
                      ? t("common_expand") || "展开"
                      : t("common_collapse") || "收起"}</span
                  >
                </button>
                {#if !thinkingCollapsed}
                  <div
                    class="px-3 py-2.5 text-xs text-[hsl(var(--miwarp-text-secondary))] whitespace-pre-wrap leading-relaxed"
                  >
                    {thinkingText.trimEnd()}
                  </div>
                {/if}
              </div>
            {/if}
            <div class="prose-chat">
              <MarkdownContent text={message.content} />
            </div>
          {/if}
        </div>
      </div>
    </div>
  </div>
</div>
