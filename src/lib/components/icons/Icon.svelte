<script lang="ts">
  import { iconMap, getIcon, type IconName } from "./icon-map";

  interface Props {
    /** Icon name from icon-map.ts */
    name: IconName;
    /** Icon size in pixels (default: 18) */
    size?: number;
    /** Stroke width (default: 1.8 for UI icons) */
    strokeWidth?: number;
    /** Variant: "ui" | "supplement" | "empty" (default: "ui") */
    variant?: "ui" | "supplement" | "empty";
    /** Additional CSS classes */
    class?: string;
    /** Accessibility label (creates aria-label on wrapper) */
    ariaLabel?: string;
    /** Custom color */
    color?: string;
    /** Absolute fill (for Phosphor icons, default: false) */
    absoluteFill?: boolean;
    /** Weight for Phosphor icons (default: "regular") */
    weight?: "thin" | "light" | "regular" | "bold" | "fill" | "duotone";
  }

  let {
    name,
    size = 18,
    strokeWidth,
    variant,
    class: className = "",
    ariaLabel,
    color,
    absoluteFill = false,
    weight,
  }: Props = $props();

  // Get icon entry from map
  const entry = $derived(getIcon(name));

  // Resolve effective variant (use prop if provided, otherwise from entry)
  const effectiveVariant = $derived(variant ?? entry?.variant ?? "ui");

  // Resolve stroke width based on variant
  const effectiveStrokeWidth = $derived(() => {
    if (strokeWidth !== undefined) return strokeWidth;
    if (effectiveVariant === "empty") return 1.5;
    return 1.8;
  });

  // Resolve icon component
  const IconComponent = $derived(entry?.component);

  // For Phosphor icons, determine weight
  const phosphorWeight = $derived(() => {
    if (weight) return weight;
    if (effectiveVariant === "empty") return "regular";
    return "regular";
  });

  // Determine if this is a Phosphor icon (need special handling)
  const isPhosphor = $derived(effectiveVariant === "empty" || name.startsWith("empty"));
</script>

{#if IconComponent}
  {#if isPhosphor}
    <IconComponent
      {size}
      weight={phosphorWeight()}
      {color}
      {className}
      aria-hidden={ariaLabel ? undefined : true}
      aria-label={ariaLabel}
    />
  {:else}
    <IconComponent
      {size}
      strokeWidth={effectiveStrokeWidth()}
      {color}
      class={className}
      aria-hidden={ariaLabel ? undefined : true}
      aria-label={ariaLabel}
    />
  {/if}
{:else}
  <span class="inline-block w-[{size}px] h-[{size}px] {className}" aria-hidden="true"></span>
{/if}
