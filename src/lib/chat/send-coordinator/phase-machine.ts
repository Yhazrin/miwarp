/**
 * Transport phase + generation state machine for {@link SendCoordinator}.
 *
 * The coordinator tracks two pieces of transport state: the current
 * `phase` (connected / reconnecting / recovering / disposed) and the
 * monotonically-increasing `generation`. Each method here is a pure
 * state transition that returns the new generation and the cancellation
 * count it produced. The caller owns the phase/generation fields and is
 * responsible for emitting the {@link TransportPhaseEvent}.
 */
import { cancelAllQueued, cancelStaleGenerations } from "./transitions";
import type { TransitionContext } from "./transitions";
import type { TransportPhase } from "./types";

export interface PhaseMachineState {
  /** Current transport phase. Read + written through these accessors. */
  getPhase: () => TransportPhase;
  setPhase: (phase: TransportPhase) => void;
  /** Current connection generation. Read + written through these accessors. */
  getGeneration: () => number;
  setGeneration: (gen: number) => void;
  /** Live transition context for cancel operations. */
  context: TransitionContext;
}

export interface SetTransportPhaseOptions {
  /** Caller may pass an authoritative generation to bump to. */
  generation?: number;
  /** If `true` and the new phase is `connected`, drain the queue afterwards. */
  reconcile?: boolean;
}

export interface SetTransportPhaseResult {
  /** New generation after the transition. */
  generation: number;
  /** Whether the transport phase actually changed. */
  phaseChanged: boolean;
  /** Number of records cancelled as a side effect. */
  cancelled: number;
  /** Generation used to drive the cancel pass (may exceed `generation` when phase left connected). */
  staleGeneration: number;
}

/**
 * Apply a new transport phase. When the phase leaves `connected` the
 * bounded queue is drained with `transport_unavailable` (retryable) so
 * the UI does not silently lose buffered messages. A generation bump
 * cancels every record whose captured generation is older.
 */
export function applyTransportPhase(
  state: PhaseMachineState,
  phase: TransportPhase,
  options: SetTransportPhaseOptions = {},
): SetTransportPhaseResult {
  const previousPhase = state.getPhase();
  const previousGeneration = state.getGeneration();
  let cancelled = 0;
  let phaseChanged = false;
  let staleGeneration = previousGeneration;

  if (phase !== previousPhase) {
    phaseChanged = true;
    if (phase !== "connected" && previousPhase === "connected") {
      cancelled = cancelAllQueued(
        state.context,
        {
          code: "transport_unavailable",
          message: `transport entered ${phase}; queued submits drained as failed`,
          retryable: true,
        },
        "phase-leave",
      );
    }
    state.setPhase(phase);
  }

  if (typeof options.generation === "number" && options.generation > previousGeneration) {
    cancelled += cancelStaleGenerations(state.context, options.generation);
    state.setGeneration(options.generation);
    staleGeneration = options.generation;
  } else if (phaseChanged && phase !== "connected") {
    cancelled += cancelStaleGenerations(state.context, previousGeneration + 1);
    state.setGeneration(previousGeneration + 1);
    staleGeneration = previousGeneration + 1;
  }

  return {
    generation: state.getGeneration(),
    phaseChanged,
    cancelled,
    staleGeneration,
  };
}

/**
 * Advance the generation without changing the phase. The single-flight
 * reconnect-storm invariant: at most one drain per generation. Calling
 * this twice with the same value is a no-op.
 */
export function bumpGeneration(
  state: PhaseMachineState,
  nextGeneration?: number,
): { generation: number; cancelled: number } {
  const previousGeneration = state.getGeneration();
  const target = nextGeneration ?? previousGeneration + 1;
  if (target <= previousGeneration) {
    return { generation: previousGeneration, cancelled: 0 };
  }
  const cancelled = cancelStaleGenerations(state.context, target);
  state.setGeneration(target);
  return { generation: target, cancelled };
}
