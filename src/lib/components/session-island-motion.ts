export const SESSION_ISLAND_SPRING = {
  stiffness: 0.2,
  damping: 0.82,
  precision: 0.001,
  preserveMomentumMs: 72,
} as const;

const COLLAPSED_WIDTH = 156;
const EXPANDED_WIDTH = 424;
const COLLAPSED_RADIUS = 18;
const EXPANDED_RADIUS = 22;

export interface SessionIslandMotionFrame {
  progress: number;
  shellWidth: number;
  tier2Width: number;
  revealWidth: number;
  railGap: number;
  contextWidth: number;
  contextLabelWidth: number;
  contextLabelMargin: number;
  tier2Offset: number;
  tier2Scale: number;
  borderRadius: number;
  borderAlpha: number;
}

function lerp(from: number, to: number, progress: number): number {
  return from + (to - from) * progress;
}

/**
 * Convert the interruptible spring value into one coherent visual frame.
 *
 * Clamping is deliberate: velocity is preserved by the Spring while the
 * geometry stays inside its valid bounds, so a quick hover reversal feels
 * inertial without making the capsule visibly bounce or overshoot.
 */
export function resolveSessionIslandMotionFrame(value: number): SessionIslandMotionFrame {
  const progress = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

  return {
    progress,
    shellWidth: lerp(COLLAPSED_WIDTH, EXPANDED_WIDTH, progress),
    tier2Width: EXPANDED_WIDTH * progress,
    revealWidth: 28 * progress,
    railGap: 6 * progress,
    contextWidth: lerp(44, 120, progress),
    contextLabelWidth: 76 * progress,
    contextLabelMargin: 4 * progress,
    tier2Offset: lerp(-8, 0, progress),
    tier2Scale: lerp(0.94, 1, progress),
    borderRadius: lerp(COLLAPSED_RADIUS, EXPANDED_RADIUS, progress),
    borderAlpha: 0.2 * progress,
  };
}

function px(value: number): string {
  return `${value.toFixed(3)}px`;
}

export function sessionIslandMotionStyle(value: number): string {
  const frame = resolveSessionIslandMotionFrame(value);
  return [
    `--session-island-motion-progress:${frame.progress.toFixed(5)}`,
    `--session-island-motion-track:${frame.progress.toFixed(5)}fr`,
    `--session-island-motion-shell-width:${px(frame.shellWidth)}`,
    `--session-island-motion-tier2-width:${px(frame.tier2Width)}`,
    `--session-island-motion-reveal-width:${px(frame.revealWidth)}`,
    `--session-island-motion-gap:${px(frame.railGap)}`,
    `--session-island-motion-context-width:${px(frame.contextWidth)}`,
    `--session-island-motion-context-label-width:${px(frame.contextLabelWidth)}`,
    `--session-island-motion-context-label-margin:${px(frame.contextLabelMargin)}`,
    `--session-island-motion-tier2-offset:${px(frame.tier2Offset)}`,
    `--session-island-motion-tier2-scale:${frame.tier2Scale.toFixed(5)}`,
    `--session-island-motion-radius:${px(frame.borderRadius)}`,
    `--session-island-motion-border-alpha:${frame.borderAlpha.toFixed(5)}`,
  ].join(";");
}
