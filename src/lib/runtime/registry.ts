import type {
  ResolvedRuntime,
  RuntimeDescriptor,
  RuntimeDetectionMap,
  RuntimeLaunchSupport,
  SupportedRuntimeId,
} from "./types";

export const SUPPORTED_RUNTIME_IDS = [
  "claude",
  "codex",
  "mimo",
  "gemini",
  "aider",
  "opencode",
  "qwen-code",
  "custom",
] as const satisfies readonly SupportedRuntimeId[];

export const STARTABLE_RUNTIME_IDS = [
  "claude",
  "codex",
  "mimo",
] as const satisfies readonly SupportedRuntimeId[];

const RUNTIME_DESCRIPTORS: Record<SupportedRuntimeId, RuntimeDescriptor> = {
  claude: {
    id: "claude",
    agent: "claude",
    nameKey: "runtime_claude_name",
    capabilitiesKey: "runtime_claude_capabilities",
    launchSupport: "startable",
    sortOrder: 10,
  },
  codex: {
    id: "codex",
    agent: "codex",
    nameKey: "runtime_codex_name",
    capabilitiesKey: "runtime_codex_capabilities",
    launchSupport: "startable",
    sortOrder: 20,
  },
  mimo: {
    id: "mimo",
    agent: "mimo",
    nameKey: "runtime_mimo_name",
    capabilitiesKey: "runtime_mimo_capabilities",
    launchSupport: "startable",
    sortOrder: 30,
  },
  gemini: {
    id: "gemini",
    agent: "gemini",
    nameKey: "runtime_gemini_name",
    capabilitiesKey: "runtime_gemini_capabilities",
    launchSupport: "coming-soon",
    sortOrder: 40,
  },
  aider: {
    id: "aider",
    agent: "aider",
    nameKey: "runtime_aider_name",
    capabilitiesKey: "runtime_aider_capabilities",
    launchSupport: "coming-soon",
    sortOrder: 50,
  },
  opencode: {
    id: "opencode",
    agent: "opencode",
    nameKey: "runtime_opencode_name",
    capabilitiesKey: "runtime_opencode_capabilities",
    launchSupport: "coming-soon",
    sortOrder: 60,
  },
  "qwen-code": {
    id: "qwen-code",
    agent: "qwen-code",
    nameKey: "runtime_qwen_name",
    capabilitiesKey: "runtime_qwen_capabilities",
    launchSupport: "coming-soon",
    sortOrder: 70,
  },
  custom: {
    id: "custom",
    agent: "custom",
    nameKey: "runtime_custom_name",
    capabilitiesKey: "runtime_custom_capabilities",
    launchSupport: "coming-soon",
    sortOrder: 80,
  },
};

export function isSupportedRuntimeId(value: string): value is SupportedRuntimeId {
  return (SUPPORTED_RUNTIME_IDS as readonly string[]).includes(value);
}

export function getRuntimeDescriptor(id: SupportedRuntimeId): RuntimeDescriptor {
  return RUNTIME_DESCRIPTORS[id];
}

export function listRuntimeDescriptors(): RuntimeDescriptor[] {
  return SUPPORTED_RUNTIME_IDS.map((id) => RUNTIME_DESCRIPTORS[id]).sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );
}

export function isStartableRuntime(id: SupportedRuntimeId): boolean {
  return getRuntimeDescriptor(id).launchSupport === "startable";
}

export function getRuntimeLaunchSupport(id: SupportedRuntimeId): RuntimeLaunchSupport {
  return getRuntimeDescriptor(id).launchSupport;
}

/** Map welcome picker id → session store agent string. */
export function runtimeIdToAgent(id: SupportedRuntimeId): string {
  return getRuntimeDescriptor(id).agent;
}

/** Resolve a session agent string back to a registry id when possible. */
export function agentToRuntimeId(agent: string): SupportedRuntimeId | null {
  const normalized = agent.trim().toLowerCase();
  for (const id of SUPPORTED_RUNTIME_IDS) {
    const descriptor = RUNTIME_DESCRIPTORS[id];
    if (descriptor.agent === normalized || id === normalized) return id;
    if (id === "mimo" && normalized === "mimocode") return "mimo";
  }
  return null;
}

/** Stream-json session_actor path (Claude + MiMo). Codex uses pipe_exec. */
export function usesStreamSession(agent: string): boolean {
  const id = agentToRuntimeId(agent);
  if (!id) return agent === "claude" || agent === "mimo";
  return id === "claude" || id === "mimo";
}

function resolveStatus(
  descriptor: RuntimeDescriptor,
  detection?: RuntimeDetectionMap[SupportedRuntimeId],
): Pick<ResolvedRuntime, "available" | "selectable" | "status" | "statusKey"> {
  if (descriptor.launchSupport === "coming-soon") {
    return {
      available: false,
      selectable: false,
      status: "coming-soon",
      statusKey: "runtime_status_coming_soon",
    };
  }

  const available = detection?.available ?? false;
  return {
    available,
    selectable: available,
    status: available ? "available" : "unavailable",
    statusKey: available ? "runtime_status_available" : "runtime_status_unavailable",
  };
}

/** Merge static descriptors with API detection snapshots. */
export function mergeRuntimeAvailability(detection: RuntimeDetectionMap = {}): ResolvedRuntime[] {
  return listRuntimeDescriptors().map((descriptor) => {
    const snap = detection[descriptor.id];
    const status = resolveStatus(descriptor, snap);
    return {
      ...descriptor,
      ...status,
      binary: snap?.binary,
      version: snap?.version ?? null,
    };
  });
}

const DEFAULT_RUNTIME_ID: SupportedRuntimeId = "claude";

/** Keep selection on a startable, available runtime; otherwise pick first selectable. */
export function resolveSelectionFallback(
  selected: SupportedRuntimeId,
  resolved: ResolvedRuntime[],
): SupportedRuntimeId {
  const selectedEntry = resolved.find((r) => r.id === selected);
  if (selectedEntry?.selectable) return selected;

  const firstSelectable = resolved.find((r) => r.selectable);
  if (firstSelectable) return firstSelectable.id;

  return DEFAULT_RUNTIME_ID;
}

/** Session agent pass-through: normalize aliases and fall back to claude. */
export function normalizeSessionAgent(agent: string | null | undefined): string {
  const raw = (agent ?? "").trim().toLowerCase();
  if (!raw) return DEFAULT_RUNTIME_ID;
  const id = agentToRuntimeId(raw);
  if (!id) return raw;
  return runtimeIdToAgent(id);
}

export function isKnownSessionAgent(agent: string): boolean {
  return agentToRuntimeId(agent) !== null || agent === "mimocode";
}
