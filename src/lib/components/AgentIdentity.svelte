<script lang="ts">
  import { getAgentAsset } from "$lib/utils/agent-assets";

  let {
    agent,
    platformId,
    model,
    size = "md",
    animated = false,
    showName = true,
    showModel = false,
    class: className = "",
  }: {
    agent?: string;
    platformId?: string;
    model?: string;
    size?: "sm" | "md" | "lg";
    animated?: boolean;
    showName?: boolean;
    showModel?: boolean;
    class?: string;
  } = $props();

  const asset = $derived(getAgentAsset(agent, platformId));

  const sizeMap = { sm: 20, md: 28, lg: 40 };
  const px = $derived(sizeMap[size]);

  const imgSrc = $derived(animated && asset.mascot ? asset.mascot : (asset.icon ?? asset.fallback));

  let imgFailed = $state(false);
  const displaySrc = $derived(imgFailed ? asset.fallback : imgSrc);

  function handleError() {
    imgFailed = true;
  }

  // Reset fallback state when src changes
  $effect(() => {
    void imgSrc;
    imgFailed = false;
  });
</script>

<div class="inline-flex items-center gap-2 {className}">
  <div
    class="flex-shrink-0 overflow-hidden rounded-full bg-[hsl(var(--miwarp-accent-violet)/0.1)]"
    style="width: {px}px; height: {px}px;"
  >
    <img
      src={displaySrc}
      alt={asset.displayName}
      class="h-full w-full object-contain"
      style="image-rendering: {asset.mascot && animated ? 'auto' : 'pixelated'};"
      onerror={handleError}
    />
  </div>
  {#if showName}
    <div class="flex flex-col leading-tight">
      <span class="text-sm font-semibold text-foreground">{asset.displayName}</span>
      {#if showModel && model}
        <span class="text-[10px] text-muted-foreground">{model}</span>
      {/if}
    </div>
  {/if}
</div>
