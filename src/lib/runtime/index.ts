export type {
  ResolvedRuntime,
  RuntimeDescriptor,
  RuntimeDetection,
  RuntimeDetectionMap,
  RuntimeLaunchSupport,
  RuntimeStatus,
  SupportedRuntimeId,
} from "./types";

export {
  SUPPORTED_RUNTIME_IDS,
  STARTABLE_RUNTIME_IDS,
  agentToRuntimeId,
  getRuntimeDescriptor,
  getRuntimeLaunchSupport,
  isKnownSessionAgent,
  isStartableRuntime,
  isSupportedRuntimeId,
  listRuntimeDescriptors,
  mergeRuntimeAvailability,
  normalizeSessionAgent,
  resolveSelectionFallback,
  runtimeIdToAgent,
  usesStreamSession,
} from "./registry";

export {
  probeRuntimeAvailability,
  probeRuntimeAvailabilityFor,
  probeRuntimeAvailabilityWithStatus,
} from "./availability";
export type { RuntimeProbeOutcome } from "./availability";
