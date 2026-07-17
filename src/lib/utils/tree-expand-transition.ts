import type { TransitionConfig } from "svelte/transition";

/** Matches `--motion-slow` in motion.css */
const TREE_EXPAND_DURATION = 280;
/** Slightly faster collapse feels snappier */
const TREE_COLLAPSE_DURATION = 220;

/**
 * CSS cubic-bezier easing (no overshoot when control-point y values stay in [0, 1]).
 * Mirrors design tokens in motion.css.
 */
function createCubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;

  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const sampleDx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;

  return (t: number) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let u = t;
    for (let i = 0; i < 8; i++) {
      const x = sampleX(u) - t;
      if (Math.abs(x) < 1e-5) break;
      const d = sampleDx(u);
      if (Math.abs(d) < 1e-6) break;
      u -= x / d;
    }
    return sampleY(u);
  };
}

/** `--ease-emphasized`: smooth deceleration on expand, no rebound */
const TREE_EXPAND_EASE = createCubicBezier(0.16, 1, 0.3, 1);
/** `--ease-standard`: ease-in for collapse */
const TREE_COLLAPSE_EASE = createCubicBezier(0.2, 0, 0, 1);

export interface TreeExpandParams {
  delay?: number;
  duration?: number;
  easing?: (t: number) => number;
  axis?: "x" | "y";
}

/**
 * Height/width collapse transition for folder trees.
 * Expand re-measures scrollHeight each frame so async children (logical sub-folders)
 * are not clipped when data arrives after the workspace row opens.
 */
function measureAxisSize(el: HTMLElement, axis: "x" | "y"): number {
  return axis === "y" ? el.scrollHeight : el.scrollWidth;
}

function treeTransitionCss(
  t: number,
  opacity: number,
  primary: "height" | "width",
  size: number,
): string {
  return [
    "overflow: hidden;",
    `opacity: ${Math.min(t * 20, 1) * opacity};`,
    `${primary}: ${Math.max(t * size, 0)}px;`,
    `min-${primary}: 0;`,
  ].join(" ");
}

export function treeExpand(
  node: Element,
  {
    delay = 0,
    duration = TREE_EXPAND_DURATION,
    easing = TREE_EXPAND_EASE,
    axis = "y",
  }: TreeExpandParams = {},
): TransitionConfig {
  const style = getComputedStyle(node);
  const opacity = +style.opacity;
  const primary = axis === "y" ? "height" : "width";
  const el = node as HTMLElement;

  return {
    delay,
    duration,
    easing,
    css: (t) => {
      const size = measureAxisSize(el, axis);
      // After intro completes, avoid leaving overflow:hidden + fixed height on the node.
      if (t >= 1) {
        return `${primary}: auto; overflow: visible; opacity: ${opacity}; min-${primary}: 0;`;
      }
      return treeTransitionCss(t, opacity, primary, size);
    },
  };
}

export function treeCollapse(
  node: Element,
  { delay = 0, axis = "y", ...rest }: Omit<TreeExpandParams, "duration" | "easing"> = {},
): TransitionConfig {
  const style = getComputedStyle(node);
  const opacity = +style.opacity;
  const primary = axis === "y" ? "height" : "width";
  const el = node as HTMLElement;
  const capturedSize = measureAxisSize(el, axis);

  return {
    delay,
    duration: TREE_COLLAPSE_DURATION,
    easing: TREE_COLLAPSE_EASE,
    ...rest,
    css: (t) => treeTransitionCss(t, opacity, primary, capturedSize),
  };
}
