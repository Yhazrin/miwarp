import type { AgentSettings, UserSettings } from "$lib/types";

export interface ChatBootstrapSnapshot {
  settings: UserSettings;
  agentSettings: AgentSettings | null;
}

let snapshot: ChatBootstrapSnapshot | null = null;

/** Snapshot chat page settings before leaving for /settings. */
export function snapshotChatBootstrap(
  settings: UserSettings,
  agentSettings: AgentSettings | null,
): void {
  snapshot = { settings, agentSettings };
}

/** One-shot restore after returning from settings; clears the snapshot. */
export function consumeChatBootstrap(): ChatBootstrapSnapshot | null {
  const s = snapshot;
  snapshot = null;
  return s;
}
