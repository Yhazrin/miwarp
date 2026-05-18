<script lang="ts">
  import { onMount } from "svelte";
  import {
    isWindowDragInteractiveTarget,
    preloadWindowDrag,
    startWindowDragFromEvent,
  } from "$lib/utils/window-drag";

  // Global top window-drag region.
  //
  // Why this exists
  // ───────────────
  // The legacy <WindowDragArea> components are placed as left/right *spacers*
  // around interactive widgets (logo, status bar, project picker…). They rely
  // on a JS mousedown handler that calls Tauri's startDragging(). That works
  // — but every spacer must avoid covering interactive elements, otherwise the
  // overlay swallows the click before the button can see it.
  //
  // This component does not rely on an overlay receiving pointer events.
  // Instead, it listens in the capture phase and asks Tauri to start dragging
  // when the mouse starts inside the top band and not on an interactive target.
  // That keeps buttons, inputs, links, menus, and contenteditable regions fully
  // usable while making the remaining top chrome reliably draggable.
  //
  // Layout
  // ──────
  // Fixed, full-width, configurable height. Default height matches the
  // standard macOS title-bar overlay (36px) so it lines up with the
  // traffic-light vertical band.

  let {
    height = 36,
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
    preloadWindowDrag();

    function onMouseDown(event: MouseEvent) {
      if (event.button !== 0 || event.defaultPrevented) return;
      if (event.clientY > height) return;
      if (event.clientX < leftInset) return;
      if (rightInset > 0 && event.clientX > window.innerWidth - rightInset) return;
      if (isWindowDragInteractiveTarget(event.target)) return;

      void startWindowDragFromEvent(event);
    }

    window.addEventListener("mousedown", onMouseDown, true);
    return () => window.removeEventListener("mousedown", onMouseDown, true);
  });
</script>

<div
  class="top-window-drag"
  data-tauri-drag-region
  aria-hidden="true"
  style="height: {height}px; left: {leftInset}px; right: {rightInset}px; z-index: {zIndex};"
></div>

<style>
  .top-window-drag {
    position: fixed;
    top: 0;
    pointer-events: none;
    -webkit-app-region: drag;
    /* Tauri/Electron also accept the unprefixed form. svelte-check warns it's
       non-standard CSS — silenced via the global rule in src/app.css where
       app-region: no-drag is already used for buttons. We omit it here on
       purpose to keep the component warning-free. */
    background: transparent;
  }
</style>
