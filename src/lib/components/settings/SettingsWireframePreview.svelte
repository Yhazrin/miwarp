<script lang="ts">
  /**
   * Minimal wireframe previews for settings option cards.
   * Keeps the same visual language as the session-island alignment picker.
   */
  export type SettingsWireframeVariant =
    | "session-island-center"
    | "session-island-right"
    | "theme-mode-light"
    | "theme-mode-dark"
    | "theme-mode-system"
    | "theme-accent"
    | "visual-perf-auto"
    | "visual-perf-quality"
    | "visual-perf-balanced"
    | "visual-perf-performance"
    | "window-material-header"
    | "window-material-sidebar"
    | "icon-rail-on"
    | "icon-rail-off"
    | "bg-sizing-cover"
    | "bg-sizing-fill"
    | "bg-sizing-fit"
    | "bg-sizing-stretch"
    | "bg-sizing-tile";

  let {
    variant,
    accentColor,
    class: className = "",
  }: {
    variant: SettingsWireframeVariant;
    /** Theme picker accent swatch color. */
    accentColor?: string;
    class?: string;
  } = $props();
</script>

<div
  class="settings-wireframe-preview rounded-md border border-border/35 bg-muted/25 p-2 {className}"
  aria-hidden="true"
>
  <div class="relative h-10 overflow-hidden rounded-sm bg-background/60">
    {#if variant === "session-island-center" || variant === "session-island-right"}
      <span
        class="absolute top-1.5 h-2 rounded-full bg-primary/70 {variant === 'session-island-center'
          ? 'left-1/2 w-10 -translate-x-1/2'
          : 'right-1.5 w-8'}"
      ></span>
    {:else if variant === "theme-mode-light"}
      <div class="absolute inset-0 bg-[hsl(0_0%_98%)]"></div>
      <span class="absolute left-1.5 top-1.5 h-1.5 w-6 rounded-sm bg-[hsl(220_10%_75%)]"></span>
      <span class="absolute bottom-1.5 left-1.5 right-1.5 h-2 rounded-sm bg-[hsl(220_10%_88%)]"
      ></span>
      <span
        class="absolute right-1 top-1 h-2 w-2 rounded-full bg-amber-400/80 ring-1 ring-amber-500/30"
      ></span>
    {:else if variant === "theme-mode-dark"}
      <div class="absolute inset-0 bg-[hsl(220_12%_14%)]"></div>
      <span class="absolute left-1.5 top-1.5 h-1.5 w-6 rounded-sm bg-[hsl(220_8%_28%)]"></span>
      <span class="absolute bottom-1.5 left-1.5 right-1.5 h-2 rounded-sm bg-[hsl(220_8%_22%)]"
      ></span>
      <span class="absolute right-1 top-1 h-2 w-2 rounded-full bg-indigo-300/70"></span>
    {:else if variant === "theme-mode-system"}
      <div
        class="absolute inset-0 bg-gradient-to-br from-[hsl(0_0%_98%)] from-50% to-[hsl(220_12%_14%)] to-50%"
      ></div>
      <span class="absolute left-1.5 top-1.5 h-1.5 w-5 rounded-sm bg-[hsl(220_10%_72%)]"></span>
      <span class="absolute right-1.5 top-1.5 h-1.5 w-5 rounded-sm bg-[hsl(220_8%_30%)]"></span>
      <span
        class="absolute bottom-1.5 left-1/2 h-2 w-8 -translate-x-1/2 rounded-sm bg-[hsl(220_8%_40%)]/60"
      ></span>
    {:else if variant === "theme-accent"}
      <span class="absolute bottom-0 left-0 top-0 w-2 bg-muted-foreground/15"></span>
      <span class="absolute left-3 top-1.5 h-1 w-8 rounded-sm bg-muted-foreground/20"></span>
      <span class="absolute left-3 top-3.5 h-1 w-6 rounded-sm bg-muted-foreground/12"></span>
      <span
        class="absolute bottom-1.5 right-1.5 h-2.5 w-5 rounded-full"
        style:background-color={accentColor ?? "hsl(var(--primary))"}
      ></span>
    {:else if variant === "visual-perf-auto"}
      <span class="absolute inset-1 rounded-sm border border-dashed border-primary/35"></span>
      <span class="absolute left-2 top-2 h-2 w-2 rounded-full bg-primary/45 blur-[1px]"></span>
      <span class="absolute bottom-2 right-2 h-1.5 w-6 rounded-sm bg-muted-foreground/25"></span>
    {:else if variant === "visual-perf-quality"}
      <span
        class="absolute inset-0 bg-gradient-to-tr from-primary/15 via-transparent to-violet-500/20"
      ></span>
      <span
        class="absolute left-1.5 top-1.5 h-5 w-3 rounded-sm bg-background/40 backdrop-blur-[2px]"
      ></span>
      <span class="absolute bottom-1.5 right-1.5 h-2 w-7 rounded-full bg-primary/35 blur-[0.5px]"
      ></span>
    {:else if variant === "visual-perf-balanced"}
      <span class="absolute left-1.5 top-1.5 h-5 w-3 rounded-sm bg-muted-foreground/18"></span>
      <span class="absolute bottom-1.5 left-1.5 right-1.5 h-2 rounded-sm bg-muted-foreground/14"
      ></span>
      <span class="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-primary/40"></span>
    {:else if variant === "visual-perf-performance"}
      <span class="absolute left-1.5 top-1.5 h-5 w-3 rounded-sm bg-muted-foreground/22"></span>
      <span class="absolute bottom-1.5 left-1.5 right-1.5 h-2 rounded-sm bg-muted-foreground/18"
      ></span>
      <span class="absolute right-1.5 top-1.5 h-2 w-2 rounded-sm bg-muted-foreground/28"></span>
    {:else if variant === "window-material-header"}
      <span class="absolute bottom-0 left-0 top-0 w-3 bg-muted-foreground/12"></span>
      <span class="absolute left-0 right-0 top-0 h-3 bg-primary/25 backdrop-blur-[1px]"></span>
      <span class="absolute bottom-1.5 left-4 right-1.5 h-2 rounded-sm bg-muted-foreground/14"
      ></span>
    {:else if variant === "window-material-sidebar"}
      <span class="absolute bottom-0 left-0 top-0 w-3 bg-primary/22 backdrop-blur-[1px]"></span>
      <span class="absolute bottom-1.5 left-4 right-1.5 h-2 rounded-sm bg-muted-foreground/14"
      ></span>
      <span class="absolute left-1 top-4 h-1 w-1 rounded-full bg-muted-foreground/30"></span>
      <span class="absolute left-1 top-6 h-1 w-1 rounded-full bg-muted-foreground/22"></span>
    {:else if variant === "icon-rail-on"}
      <span class="absolute bottom-0 left-0 top-0 w-2.5 bg-muted-foreground/16"></span>
      <span class="absolute left-0.5 top-1.5 h-1 w-1 rounded-[2px] bg-primary/70"></span>
      <span class="absolute left-0.5 top-3.5 h-1 w-1 rounded-[2px] bg-muted-foreground/35"></span>
      <span class="absolute left-0.5 top-5.5 h-1 w-1 rounded-[2px] bg-muted-foreground/35"></span>
      <span class="absolute bottom-1.5 left-3.5 right-1.5 h-2 rounded-sm bg-muted-foreground/14"
      ></span>
    {:else if variant === "icon-rail-off"}
      <span class="absolute bottom-1.5 left-1.5 right-1.5 h-2 rounded-sm bg-muted-foreground/14"
      ></span>
      <span class="absolute left-1.5 top-1.5 h-1 w-10 rounded-sm bg-muted-foreground/20"></span>
      <span class="absolute left-1.5 top-3.5 h-1 w-7 rounded-sm bg-muted-foreground/12"></span>
    {:else if variant === "bg-sizing-cover"}
      <span
        class="absolute -inset-1 bg-primary/35"
        style="background-image: radial-gradient(circle at 30% 40%, hsl(var(--primary)/0.5), transparent 55%);"
      ></span>
      <span class="absolute inset-0 ring-1 ring-inset ring-border/40"></span>
    {:else if variant === "bg-sizing-fill"}
      <span class="absolute inset-0 bg-primary/30"></span>
    {:else if variant === "bg-sizing-fit"}
      <span class="absolute inset-0 bg-muted-foreground/10"></span>
      <span
        class="absolute left-1/2 top-1/2 h-6 w-8 -translate-x-1/2 -translate-y-1/2 rounded-sm bg-primary/40"
      ></span>
    {:else if variant === "bg-sizing-stretch"}
      <span class="absolute inset-0 bg-muted-foreground/10"></span>
      <span class="absolute inset-x-1 top-2 bottom-2 rounded-sm bg-primary/35"></span>
    {:else if variant === "bg-sizing-tile"}
      <div class="absolute inset-0 grid grid-cols-3 grid-rows-2 gap-px bg-border/30 p-px">
        {#each Array(6) as _, i (i)}
          <span class="bg-primary/25 {i % 2 === 0 ? 'opacity-100' : 'opacity-60'}"></span>
        {/each}
      </div>
    {/if}
  </div>
</div>
