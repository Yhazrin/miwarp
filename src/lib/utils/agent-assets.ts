/**
 * Agent identity assets — mascot GIFs and CLI icons from CodeIsland (MIT).
 * Maps agent kind to display name, mascot, and icon paths.
 */

export type AgentKind =
  | "claude"
  | "codex"
  | "gemini"
  | "cursor"
  | "trae"
  | "traecli"
  | "qoder"
  | "copilot"
  | "factory"
  | "codebuddy"
  | "kimi"
  | "opencode"
  | "cline"
  | "team"
  | "system"
  | "unknown";

export interface AgentAsset {
  kind: AgentKind;
  displayName: string;
  mascot?: string;
  icon?: string;
  fallback: string;
}

export const AGENT_ASSETS: Record<string, AgentAsset> = {
  claude: {
    kind: "claude",
    displayName: "Claude",
    mascot: "/vendor/codeisland/mascots/claude.gif",
    icon: "/vendor/codeisland/cli-icons/claude.png",
    fallback: "/light.png",
  },
  codex: {
    kind: "codex",
    displayName: "Codex",
    mascot: "/vendor/codeisland/mascots/codex.gif",
    icon: "/vendor/codeisland/cli-icons/codex.png",
    fallback: "/light.png",
  },
  gemini: {
    kind: "gemini",
    displayName: "Gemini",
    mascot: "/vendor/codeisland/mascots/gemini.gif",
    icon: "/vendor/codeisland/cli-icons/gemini.png",
    fallback: "/light.png",
  },
  cursor: {
    kind: "cursor",
    displayName: "Cursor",
    mascot: "/vendor/codeisland/mascots/cursor.gif",
    icon: "/vendor/codeisland/cli-icons/cursor.png",
    fallback: "/light.png",
  },
  trae: {
    kind: "trae",
    displayName: "Trae",
    icon: "/vendor/codeisland/cli-icons/trae.png",
    fallback: "/light.png",
  },
  traecli: {
    kind: "traecli",
    displayName: "Trae CLI",
    icon: "/vendor/codeisland/cli-icons/trae.png",
    fallback: "/light.png",
  },
  qoder: {
    kind: "qoder",
    displayName: "Qoder",
    mascot: "/vendor/codeisland/mascots/qoder.gif",
    icon: "/vendor/codeisland/cli-icons/qoder.png",
    fallback: "/light.png",
  },
  copilot: {
    kind: "copilot",
    displayName: "Copilot",
    icon: "/vendor/codeisland/cli-icons/copilot.png",
    fallback: "/light.png",
  },
  factory: {
    kind: "factory",
    displayName: "Factory",
    mascot: "/vendor/codeisland/mascots/factory.gif",
    icon: "/vendor/codeisland/cli-icons/factory.png",
    fallback: "/light.png",
  },
  codebuddy: {
    kind: "codebuddy",
    displayName: "CodeBuddy",
    mascot: "/vendor/codeisland/mascots/codebuddy.gif",
    icon: "/vendor/codeisland/cli-icons/codebuddy.png",
    fallback: "/light.png",
  },
  kimi: {
    kind: "kimi",
    displayName: "Kimi",
    icon: "/vendor/codeisland/cli-icons/kimi.png",
    fallback: "/light.png",
  },
  opencode: {
    kind: "opencode",
    displayName: "OpenCode",
    mascot: "/vendor/codeisland/mascots/opencode.gif",
    icon: "/vendor/codeisland/cli-icons/opencode.png",
    fallback: "/light.png",
  },
  cline: {
    kind: "cline",
    displayName: "Cline",
    mascot: "/vendor/codeisland/mascots/cline.gif",
    icon: "/vendor/codeisland/cli-icons/cline.png",
    fallback: "/light.png",
  },
};

/**
 * Normalize an agent name or platform ID to a known AgentKind key.
 */
export function normalizeAgentKind(agent?: string | null, platformId?: string | null): string {
  const raw = (platformId || agent || "").toLowerCase();

  if (raw.includes("claude") || raw.includes("anthropic")) return "claude";
  if (raw.includes("codex") || raw.includes("openai")) return "codex";
  if (raw.includes("gemini") || raw.includes("google")) return "gemini";
  if (raw.includes("cursor")) return "cursor";
  if (raw.includes("traecli")) return "traecli";
  if (raw.includes("trae")) return "trae";
  if (raw.includes("qoder")) return "qoder";
  if (raw.includes("copilot")) return "copilot";
  if (raw.includes("factory")) return "factory";
  if (raw.includes("codebuddy")) return "codebuddy";
  if (raw.includes("kimi")) return "kimi";
  if (raw.includes("opencode")) return "opencode";
  if (raw.includes("cline")) return "cline";

  return "unknown";
}

/**
 * Get the full AgentAsset for a given agent/platform, with fallback.
 */
export function getAgentAsset(agent?: string | null, platformId?: string | null): AgentAsset {
  const key = normalizeAgentKind(agent, platformId);
  return (
    AGENT_ASSETS[key] ?? {
      kind: "unknown" as AgentKind,
      displayName: agent || platformId || "Agent",
      fallback: "/light.png",
    }
  );
}
