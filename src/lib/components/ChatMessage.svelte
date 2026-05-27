<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
  import { fmtTime, fmtDateTime } from "$lib/i18n/format";
  import MarkdownContent from "./MarkdownContent.svelte";
  import FileAttachment from "./FileAttachment.svelte";
  import { IMAGE_TYPES } from "$lib/utils/file-types";
  import type { ChatMessage, Attachment, MediaArtifact } from "$lib/types";
  import AgentIdentity from "./AgentIdentity.svelte";
  import type { ProcessVisibility } from "$lib/utils/process-visibility";
  import { shouldShowRawDebug } from "$lib/utils/process-visibility";
  import { resolveArtifactsFromText } from "$lib/media-resolver";
  import ImageArtifactCard from "./media/ImageArtifactCard.svelte";
  import VideoArtifactCard from "./media/VideoArtifactCard.svelte";
  import AudioArtifactCard from "./media/AudioArtifactCard.svelte";
  import HtmlArtifactCard from "./media/HtmlArtifactCard.svelte";
  import FileArtifactCard from "./media/FileArtifactCard.svelte";

  let {
    message,
    attachments,
    thinkingText,
    onRewind,
    agent,
    platformId,
    model,
    animated = false,
    processVisibility = "developer" as ProcessVisibility,
    debugRunId = "",
    debugSessionId = "",
  }: {
    message: ChatMessage;
    attachments?: Attachment[];
    thinkingText?: string;
    onRewind?: () => void;
    agent?: string;
    platformId?: string;
    model?: string;
    animated?: boolean;
    processVisibility?: ProcessVisibility;
    debugRunId?: string;
    debugSessionId?: string;
  } = $props();

  function isImage(att: Attachment): boolean {
    return (IMAGE_TYPES as readonly string[]).includes(att.type);
  }

  const isUser = $derived(message.role === "user");

  let hovered = $state(false);
  let copied = $state(false);
  let collapsed = $state(true);
  let thinkingCollapsed = $state(true);

  const lineCount = $derived(countNewlines(message.content) + 1);
  function countNewlines(s: string): number {
    let count = 0;
    for (let i = 0; i < s.length; i++) {
      if (s.charCodeAt(i) === 10) count++;
    }
    return count;
  }
  const isLong = $derived(isUser && lineCount > 10);

  // Artifact resolution for assistant messages
  let artifacts = $state<MediaArtifact[]>([]);

  $effect(() => {
    if (!isUser && message.content && message.content.length < 50000) {
      resolveArtifactsFromText(message.content)
        .then((results) => {
          artifacts = Array.from(results.values()).filter(Boolean) as MediaArtifact[];
        })
        .catch(() => {
          artifacts = [];
        });
    } else {
      artifacts = [];
    }
  });

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
                  class="h-3.5 w-3.5 text-[hsl(var(--miwarp-status-success))]"
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
            <div
              class="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-muted-foreground"
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
                  class="h-3.5 w-3.5 text-[hsl(var(--miwarp-status-success))]"
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
            {#if thinkingText && processVisibility !== "output"}
              {#if thinkingCollapsed}
                <button
                  class="mb-2 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] text-[hsl(var(--miwarp-text-secondary))] opacity-70 hover:opacity-100 transition-opacity"
                  onclick={() => (thinkingCollapsed = false)}
                  title={t("common_expand")}
                >
                  <svg
                    class="h-2.5 w-2.5 shrink-0"
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
                  <span class="thinking-shimmer">{t("chat_thoughtProcess")}</span>
                </button>
              {:else}
                <div
                  class="mb-2 max-h-28 overflow-hidden rounded-lg border border-[hsl(var(--miwarp-accent-primary)/0.18)] bg-[hsl(var(--miwarp-bg-deep)/0.6)]"
                >
                  <div
                    class="flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] text-[hsl(var(--miwarp-text-secondary))]"
                  >
                    <svg
                      class="h-2.5 w-2.5 shrink-0 opacity-70"
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
                    <span class="font-medium thinking-shimmer">{t("chat_thoughtProcess")}</span>
                    <button
                      class="ml-auto opacity-50 hover:opacity-100 transition-opacity"
                      onclick={() => (thinkingCollapsed = true)}
                      title={t("common_collapse")}
                    >
                      <svg
                        class="h-2.5 w-2.5"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <path d="m18 15-6-6-6 6" />
                      </svg>
                    </button>
                  </div>
                  <div
                    class="border-t border-[hsl(var(--miwarp-accent-primary)/0.12)] px-2.5 py-2 text-[11px] leading-relaxed text-[hsl(var(--miwarp-text-secondary))] overflow-y-auto overscroll-y-contain max-h-[calc(7rem-2.25rem)]"
                  >
                    <pre
                      class="whitespace-pre-wrap break-words font-mono">{thinkingText.trimEnd()}</pre>
                  </div>
                </div>
              {/if}
            {/if}
            <div class="prose-chat">
              <MarkdownContent text={message.content} />
            </div>
            {#if artifacts.length > 0}
              <div class="mt-3 flex flex-wrap gap-3">
                {#each artifacts as artifact (artifact.id)}
                  {#if artifact.kind === "image"}
                    <ImageArtifactCard {artifact} />
                  {:else if artifact.kind === "video"}
                    <VideoArtifactCard {artifact} />
                  {:else if artifact.kind === "audio"}
                    <AudioArtifactCard {artifact} />
                  {:else if artifact.kind === "html"}
                    <HtmlArtifactCard {artifact} />
                  {:else}
                    <FileArtifactCard {artifact} />
                  {/if}
                {/each}
              </div>
            {/if}
            {#if shouldShowRawDebug(processVisibility) && (!!debugRunId || !!debugSessionId)}
              <div class="mt-2 font-mono text-[10px] text-muted-foreground/50 space-y-0.5">
                {#if debugRunId}<div>run_id {debugRunId}</div>{/if}
                {#if debugSessionId}<div>session_id {debugSessionId}</div>{/if}
              </div>
            {/if}
          {/if}
        </div>
      </div>
    </div>
  </div>
</div>
