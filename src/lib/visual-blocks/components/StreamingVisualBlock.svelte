<script lang="ts">
  import { buildVisualBlockPlaceholder, mountVisualBlocks } from "$lib/visual-blocks";
  import type { VisualBlockKind, VisualBlockTone } from "$lib/visual-blocks/types";

  let {
    kind,
    source,
    lang,
    tone = "default",
    blockKey,
  }: {
    kind: VisualBlockKind;
    source: string;
    lang: string;
    tone?: VisualBlockTone;
    blockKey: string;
  } = $props();

  let container: HTMLDivElement | undefined = $state();

  $effect(() => {
    const root = container;
    if (!root) return;

    root.innerHTML = buildVisualBlockPlaceholder({ kind, source, lang });
    let unmountVisual: (() => void) | undefined;
    try {
      unmountVisual = mountVisualBlocks(root, { tone });
    } catch {
      // Keep embedded fallback code block visible.
    }

    return () => {
      unmountVisual?.();
      root.innerHTML = "";
    };
  });
</script>

<div
  bind:this={container}
  class="streaming-visual-block my-2"
  data-streaming-visual-key={blockKey}
></div>
