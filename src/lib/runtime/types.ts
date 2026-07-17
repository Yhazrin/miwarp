import type { MessageKey } from "$lib/i18n/types";

/** Narrow runtime id union — single source of truth for welcome picker + settings. */
export type SupportedRuntimeId =
  | "claude"
  | "codex"
  | "mimo"
  | "gemini"
  | "aider"
  | "opencode"
  | "cursor"
  | "qwen-code"
  | "custom";

/** Backend can spawn this runtime when CLI/binary is present. */
export type RuntimeLaunchSupport = "startable" | "desktop" | "coming-soon";

export interface RuntimeDescriptor {
  id: SupportedRuntimeId;
  /** Agent string passed to `startRun` / session store. */
  agent: string;
  nameKey: MessageKey;
  capabilitiesKey: MessageKey;
  launchSupport: RuntimeLaunchSupport;
  sortOrder: number;
}

/** Detection snapshot from controlled API probes (no shell in UI). */
export interface RuntimeDetection {
  available: boolean;
  binary?: string;
  version?: string | null;
}

export type RuntimeDetectionMap = Partial<Record<SupportedRuntimeId, RuntimeDetection>>;

export type RuntimeStatus = "available" | "unavailable" | "desktop" | "coming-soon";

export interface ResolvedRuntime extends RuntimeDescriptor {
  available: boolean;
  selectable: boolean;
  status: RuntimeStatus;
  statusKey: MessageKey;
  binary?: string;
  version?: string | null;
}
