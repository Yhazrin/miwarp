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

export type { CapabilityFlag, RuntimeCapabilities } from "./capabilities";
export { CAPABILITY_FLAG_NAMES } from "./capabilities";

export type { CliCapabilities, SemVer } from "./cli-capabilities";
export {
  getCliCapabilities,
  cliSupports,
  parseSemVer,
  compareSemVer,
  versionAtLeast,
  describeCapabilities,
} from "./cli-capabilities";
