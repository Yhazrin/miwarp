<script lang="ts">
  import { onMount } from "svelte";
  import { startWindowDragFromEvent } from "$lib/utils/window-drag";

  // Pass-through, CSS-only top window-drag region.
  //
  // Why this exists
  // ───────────────
  // The legacy <WindowDragArea> components are placed as left/right *spacers*
  // around interactive widgets (logo, status bar, project picker…). They rely
  // on a JS pointerdown handler that calls Tauri's startDragging(). That works
  // — but every spacer must avoid covering interactive elements, otherwise the
  // overlay swallows the click before the button can see it.
  //
  // This component instead leans on the platform's *native* drag region:
  //   -webkit-app-region: drag   →   macOS WebKit handles the drag without
  //                                  ever firing JS pointer events.
  // Combined with pointer-events: none, the bar is fully click-through:
  //   • macOS: WebKit grabs the mouse before pointer-events runs, so window
  //     drag works even though pointer-events is none. Buttons underneath
  //     stay fully clickable.
  //   • Linux/Windows: -webkit-app-region is a no-op there, so we additionally
  //     attach data-tauri-drag-region. Tauri's runtime watches for mousedown
  //     on elements with this attribute and calls startDragging(). Because
  //     pointer-events is none, mousedown reaches the *underlying* element,
  //     not this bar — meaning Linux/Win still need the legacy spacers for
  //     the empty regions. That's fine: this bar is a *bonus* safety net for
  //     macOS where the overwhelming majority of users live.
  //
  // Layout
  // ──────
  // Fixed, full-width, configurable height. Default height gives the top
  // chrome a little extra grab area without reaching into the next row.

  let {
    height = 40,
    leftInset = 0,
    rightInset = 0,
    zIndex = 1,
  }: {
    height?: number;
    leftInset?: number;
    rightInset?: number;
    zIndex?: number;
  } = $props();

  onMount(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (event.clientY > height) return;
      if (event.clientX < leftInset) return;
      if (event.clientX > window.innerWidth - rightInset) return;

      startWindowDragFromEvent(event);
    };

    window.addEventListener("pointerdown", handlePointerDown, { capture: true });
    return () => window.removeEventListener("pointerdown", handlePointerDown, { capture: true });
  });
</script>

<div
  class="fixed top-0 pointer-events-none [-webkit-app-region:drag] bg-transparent"
  data-tauri-drag-region
  aria-hidden="true"
  style="height: {height}px; left: {leftInset}px; right: {rightInset}px; z-index: {zIndex};"
></div>
