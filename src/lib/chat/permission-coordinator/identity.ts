/**
 * Identity helpers for {@link PermissionCoordinator}.
 *
 * A request's identity is the tuple `(runId, requestId)`. The captured
 * `toolName` is preserved for breadcrumb / display but is not used for
 * dedupe — the CLI guarantees requestIds are unique per run.
 */
import type { PermissionBehavior, PermissionDecision } from "./types";
import type { PermissionSuggestion } from "$lib/types";

/**
 * Convert a `PermissionDecision` into the wire `behavior` string plus
 * the optional `updatedPermissions` payload that the CLI Zod schema
 * requires.
 *
 * Deny stops use `behavior: "deny"` and rely on the command-side
 * `interrupt: true` flag to stop the agent — that conversion happens
 * in the IPC layer, not here, so the coordinator remains transport
 * agnostic.
 */
interface DecisionWire {
  behavior: PermissionBehavior;
  updatedPermissions?: PermissionSuggestion[];
}

function decisionToWire(decision: PermissionDecision): DecisionWire {
  switch (decision.kind) {
    case "allow-once":
      return { behavior: "allow" };
    case "allow-with-rules":
      return {
        behavior: "allow",
        updatedPermissions: decision.rules,
      };
    case "allow-set-mode":
      return {
        behavior: "allow",
        updatedPermissions: decision.rules,
      };
    case "deny":
      return { behavior: "deny" };
    case "deny-stop":
      return { behavior: "deny" };
  }
}

/** Whether a decision is a "deny" (vs. allow). Used by attention clear. */
export function isDenyDecision(decision: PermissionDecision): boolean {
  return decision.kind === "deny" || decision.kind === "deny-stop";
}

/** Whether a decision stops the agent in addition to denying. */
function isInterruptDecision(decision: PermissionDecision): boolean {
  return decision.kind === "deny-stop";
}

/**
 * Whether the decision's `updatedPermissions` carry a setMode suggestion.
 * Used to drive `pendingPermissionModeOverride` on the store.
 */
function hasSetMode(decision: PermissionDecision): PermissionSuggestion | null {
  if (decision.kind !== "allow-with-rules" && decision.kind !== "allow-set-mode") return null;
  return decision.rules.find((p) => p?.type === "setMode" && !!p.mode) ?? null;
}

/**
 * Build the effective generation for a respond call. Caller-supplied
 * value wins; otherwise the coordinator's current generation is used
 * (the conservative choice — never let a stale caller override).
 */
export function resolveGeneration(provided: number | undefined, current: number): number {
  return provided ?? current;
}
