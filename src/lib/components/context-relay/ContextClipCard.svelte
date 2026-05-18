<script lang="ts">
  import type { ContextClip } from "$lib/context-relay/context-clip-types";

  let {
    clip,
    compact = false,
  }: {
    clip: ContextClip;
    compact?: boolean;
  } = $props();

  const sourceTypeIcons: Record<ContextClip["sourceType"], string> = {
    assistant_message: `<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />`,
    user_message: `<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />`,
    tool_result: `<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />`,
    selection: `<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />`,
    diff: `<path d="M12 3v14" /><path d="M5 10h14" /><path d="M5 14h14" />`,
    file: `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />`,
  };

  const sourceTypeLabels: Record<ContextClip["sourceType"], string> = {
    assistant_message: "Assistant",
    user_message: "User",
    tool_result: "Tool",
    selection: "Selection",
    diff: "Diff",
    file: "File",
  };

  const preview = $derived(
    clip.content.length > 200 ? clip.content.slice(0, 200) + "..." : clip.content,
  );

  const lineCount = $derived(clip.content.split("\n").length);
</script>

<div
  class="rounded-lg border border-border/50 bg-muted/30 p-3 {compact
    ? 'max-h-32 overflow-hidden'
    : ''}"
>
  <!-- Header -->
  <div class="mb-2 flex items-center gap-2">
    <div class="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-primary/10">
      <svg
        class="h-3 w-3 text-primary"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        {@html sourceTypeIcons[clip.sourceType]}
      </svg>
    </div>
    <span class="text-xs font-medium text-muted-foreground">
      {sourceTypeLabels[clip.sourceType]}
    </span>
    {#if clip.metadata?.toolName}
      <span class="text-xs text-muted-foreground/70">
        {clip.metadata.toolName}
      </span>
    {/if}
    {#if lineCount > 1}
      <span class="ml-auto text-[10px] text-muted-foreground/50">
        {lineCount} lines
      </span>
    {/if}
  </div>

  <!-- Content preview -->
  <div class="text-xs text-foreground/80 whitespace-pre-wrap font-mono leading-relaxed">
    {preview}
  </div>

  <!-- Source info -->
  {#if clip.sourceTitle || clip.metadata?.filePath}
    <div class="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground/60">
      {#if clip.sourceTitle}
        <span class="truncate">{clip.sourceTitle}</span>
      {/if}
      {#if clip.metadata?.filePath}
        <span class="shrink-0 truncate font-mono">{clip.metadata.filePath}</span>
      {/if}
    </div>
  {/if}
</div>
