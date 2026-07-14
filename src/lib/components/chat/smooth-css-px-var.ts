/**
 * Smoothly write a pixel CSS custom property onto an element.
 * Coalesces rapid updates (ResizeObserver) onto one rAF and only commits
 * when the rounded target actually changes.
 */
export function createSmoothCssPxVar(opts: {
  getEl: () => HTMLElement | null | undefined;
  varName: `--${string}`;
  /** Extra derived writes each time the primary value commits. */
  onCommit?: (px: number, el: HTMLElement) => void;
}): {
  setTarget: (px: number) => void;
  /** Apply immediately without waiting for the next frame (mount / unmount). */
  setImmediate: (px: number) => void;
  destroy: () => void;
} {
  let raf = 0;
  let pending: number | null = null;
  let lastWritten: number | null = null;

  function commit(px: number) {
    const el = opts.getEl();
    if (!el) return;
    const rounded = Math.round(px);
    if (lastWritten === rounded) return;
    lastWritten = rounded;
    el.style.setProperty(opts.varName, `${rounded}px`);
    opts.onCommit?.(rounded, el);
  }

  function setImmediate(px: number) {
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    pending = null;
    commit(px);
  }

  function setTarget(px: number) {
    pending = px;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (pending === null) return;
      const next = pending;
      pending = null;
      commit(next);
    });
  }

  function destroy() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    pending = null;
  }

  return { setTarget, setImmediate, destroy };
}
