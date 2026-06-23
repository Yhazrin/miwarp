<script lang="ts">
  import { extractCompletedVisualFences } from "$lib/visual-blocks/extract-completed-visual-fences";
  import type { VisualBlockTone } from "$lib/visual-blocks/types";
  import StreamingSkeleton from "$lib/components/StreamingSkeleton.svelte";
  import StreamingVisualBlock from "./StreamingVisualBlock.svelte";

  let {
    text = "",
    class: className = "",
    tone = "default",
  }: {
    text?: string;
    class?: string;
    tone?: VisualBlockTone;
  } = $props();

  const preToneClass = $derived(
    tone === "on-primary" ? "text-primary-foreground/90" : "text-foreground/90",
  );

  // MarkdownContent already coalesces token deltas to one update per animation frame.
  // Parse that stable snapshot directly so visual fences do not incur a second frame of latency.
  let segments = $derived(extractCompletedVisualFences(text));

  const showSkeleton = $derived(text.length < 100);
</script>

<div class="streaming-visual-content min-h-[3em] {className}">
  {#if showSkeleton && text.length === 0}
    <StreamingSkeleton class="mt-2" />
  {:else}
    {#each segments as segment (segment.key)}
      {#if segment.type === "text"}
        <pre
          class="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed m-0 {preToneClass}">{segment.text}</pre>
      {:else}
        <StreamingVisualBlock
          kind={segment.kind}
          source={segment.source}
          lang={segment.lang}
          {tone}
          blockKey={segment.key}
        />
      {/if}
    {/each}
    {#if showSkeleton}
      <StreamingSkeleton class="mt-2" />
    {/if}
  {/if}
</div>
