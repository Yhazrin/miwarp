<script lang="ts">
  import type { MiwarpMindMapNode, MiwarpMindMapSpec } from "../types";

  let {
    spec,
    tone = "default",
  }: {
    spec: MiwarpMindMapSpec;
    tone?: "default" | "on-primary";
  } = $props();

  const rootNode = $derived(spec.root);
  const nodeCount = $derived(countNodes(rootNode));

  function countNodes(node: MiwarpMindMapNode): number {
    if (!node.children || node.children.length === 0) return 1;
    return 1 + node.children.reduce((acc, child) => acc + countNodes(child), 0);
  }

  const toneClass = $derived(tone === "on-primary" ? "mm-block--on-primary" : "mm-block--default");
</script>

<section class="mm-block {toneClass}" aria-label={spec.title ?? "Mind map"}>
  {#if spec.title}
    <h4 class="mm-block__title">{spec.title}</h4>
  {/if}
  <p class="mm-block__meta">{nodeCount} nodes</p>
  <ul class="mm-block__tree">
    <li class="mm-block__node mm-block__node--root">
      <span class="mm-block__label mm-block__label--root">{rootNode.label}</span>
      {#if rootNode.children && rootNode.children.length > 0}
        <ul class="mm-block__children">
          {#each rootNode.children as child (child.id)}
            {@render branch(child, 1)}
          {/each}
        </ul>
      {/if}
    </li>
  </ul>
</section>

{#snippet branch(node: MiwarpMindMapNode, depth: number)}
  <li class="mm-block__node">
    <span class="mm-block__label" data-depth={depth % 4}>{node.label}</span>
    {#if node.children && node.children.length > 0}
      <ul class="mm-block__children">
        {#each node.children as child (child.id)}
          {@render branch(child, depth + 1)}
        {/each}
      </ul>
    {/if}
  </li>
{/snippet}

<style>
  .mm-block {
    --mm-radius: 6px;
    --mm-gap: 0.5rem;
    font-size: 0.8125rem;
    line-height: 1.4;
    color: hsl(var(--foreground));
  }

  .mm-block--on-primary {
    color: hsl(var(--primary-foreground));
  }

  .mm-block__title {
    margin: 0 0 0.25rem 0;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: inherit;
  }

  .mm-block__meta {
    margin: 0 0 0.5rem 0;
    font-size: 0.6875rem;
    color: hsl(var(--muted-foreground));
  }

  .mm-block__tree,
  .mm-block__children {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .mm-block__children {
    margin-left: 1rem;
    border-left: 1px dashed hsl(var(--border) / 0.6);
    padding-left: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .mm-block__node {
    padding: 0.125rem 0;
  }

  .mm-block__label {
    display: inline-block;
    border-radius: var(--mm-radius);
    padding: 0.125rem 0.5rem;
    background: hsl(var(--muted) / 0.5);
    color: inherit;
  }

  .mm-block__label[data-depth="1"] {
    background: hsl(var(--accent) / 0.5);
  }

  .mm-block__label[data-depth="2"] {
    background: hsl(var(--muted) / 0.7);
  }

  .mm-block__label[data-depth="3"] {
    background: hsl(var(--muted) / 0.4);
  }

  .mm-block__label--root {
    font-weight: 600;
    background: hsl(var(--primary) / 0.15);
    color: hsl(var(--primary));
  }

  .mm-block--on-primary .mm-block__label--root {
    background: hsl(var(--primary-foreground) / 0.2);
    color: hsl(var(--primary-foreground));
  }
</style>
