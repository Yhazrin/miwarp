<script lang="ts">
  /**
   * MiTabs — Bits UI Tabs wrapper with MiWarp surface tokens.
   *
   * Usage:
   *   <MiTabs bind:value tabs={[{ value: "a", label: "Tab A" }, { value: "b", label: "Tab B" }]}>
   *     {#snippet content()}
   *       {#if value === "a"}...{/if}
   *       {#if value === "b"}...{/if}
   *     {/snippet}
   *   </MiTabs>
   *
   * Or with custom trigger rendering:
   *   <MiTabs bind:value>
   *     {#snippet triggers()}
   *       <Tabs.Trigger value="a">Custom A</Tabs.Trigger>
   *     {/snippet}
   *     {#snippet content()}...{/snippet}
   *   </MiTabs>
   *
   * RULE: only src/lib/ui/* may import bits-ui.
   */
  import { Tabs } from "bits-ui";

  type TabDef = { value: string; label: string; disabled?: boolean };

  let {
    value = $bindable(""),
    tabs,
    orientation = "horizontal" as "horizontal" | "vertical",
    loop = false,
    activationMode = "automatic" as "automatic" | "manual",
    listClass = "",
    triggerClass = "",
    contentClass = "",
    onValueChange,
    triggers,
    content,
  }: {
    value?: string;
    tabs?: TabDef[];
    orientation?: "horizontal" | "vertical";
    loop?: boolean;
    activationMode?: "automatic" | "manual";
    listClass?: string;
    triggerClass?: string;
    contentClass?: string;
    onValueChange?: (value: string) => void;
    triggers?: import("svelte").Snippet;
    content?: import("svelte").Snippet;
  } = $props();

  let defaultListClass = $derived(
    `inline-flex items-center gap-0.5 rounded-lg bg-muted/40 p-0.5 ${listClass}`.trim(),
  );

  let defaultTriggerClass = $derived(
    `rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors
     hover:text-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm
     ${triggerClass}`.trim(),
  );

  function handleValueChange(next: string) {
    value = next;
    onValueChange?.(next);
  }
</script>

<Tabs.Root
  bind:value
  {orientation}
  {loop}
  {activationMode}
  onValueChange={handleValueChange}
>
  <Tabs.List class={defaultListClass}>
    {#if triggers}
      {@render triggers()}
    {:else if tabs}
      {#each tabs as tab (tab.value)}
        <Tabs.Trigger
          value={tab.value}
          disabled={tab.disabled}
          class={defaultTriggerClass}
        >
          {tab.label}
        </Tabs.Trigger>
      {/each}
    {/if}
  </Tabs.List>
  {#if content}
    <div class={contentClass}>
      {@render content()}
    </div>
  {/if}
</Tabs.Root>
