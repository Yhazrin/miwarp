export type SessionIslandAlignment = "center" | "right";

export const SESSION_ISLAND_ALIGNMENT_CHANGED_EVENT = "miwarp:session-island-alignment-changed";

/** Canonicalize persisted / runtime values — unknown, undefined, and invalid → center. */
export function normalizeSessionIslandAlignment(value: unknown): SessionIslandAlignment {
  if (value === "right") return "right";
  return "center";
}
