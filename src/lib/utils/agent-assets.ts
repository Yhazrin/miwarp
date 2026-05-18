/**
 * Agent identity assets — mascot GIFs and CLI icons from CodeIsland (MIT).
 * Maps agent kind to display name, mascot, and icon paths.
 */

import { APP_LOGO_LIGHT_URL, staticAsset } from "$lib/utils/brand-assets";

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
    mascot: staticAsset("/vendor/codeisland/mascots/claude.gif"),
    icon: staticAsset("/vendor/codeisland/cli-icons/claude.png"),
    fallback: APP_LOGO_LIGHT_URL,
  },
  codex: {
    kind: "codex",
    displayName: "Codex",
    mascot: staticAsset("/vendor/codeisland/mascots/codex.gif"),
    icon: staticAsset("/vendor/codeisland/cli-icons/codex.png"),
    fallback: APP_LOGO_LIGHT_URL,
  },
  gemini: {
    kind: "gemini",
    displayName: "Gemini",
    mascot: staticAsset("/vendor/codeisland/mascots/gemini.gif"),
    icon: staticAsset("/vendor/codeisland/cli-icons/gemini.png"),
    fallback: APP_LOGO_LIGHT_URL,
  },
  cursor: {
    kind: "cursor",
    displayName: "Cursor",
    mascot: staticAsset("/vendor/codeisland/mascots/cursor.gif"),
    icon: staticAsset("/vendor/codeisland/cli-icons/cursor.png"),
    fallback: APP_LOGO_LIGHT_URL,
  },
  trae: {
    kind: "trae",
    displayName: "Trae",
    icon: staticAsset("/vendor/codeisland/cli-icons/trae.png"),
    fallback: APP_LOGO_LIGHT_URL,
  },
  traecli: {
    kind: "traecli",
    displayName: "Trae CLI",
    icon: staticAsset("/vendor/codeisland/cli-icons/trae.png"),
    fallback: APP_LOGO_LIGHT_URL,
  },
  qoder: {
    kind: "qoder",
    displayName: "Qoder",
    mascot: staticAsset("/vendor/codeisland/mascots/qoder.gif"),
    icon: staticAsset("/vendor/codeisland/cli-icons/qoder.png"),
    fallback: APP_LOGO_LIGHT_URL,
  },
  copilot: {
    kind: "copilot",
    displayName: "Copilot",
    icon: staticAsset("/vendor/codeisland/cli-icons/copilot.png"),
    fallback: APP_LOGO_LIGHT_URL,
  },
  factory: {
    kind: "factory",
    displayName: "Factory",
    mascot: staticAsset("/vendor/codeisland/mascots/factory.gif"),
    icon: staticAsset("/vendor/codeisland/cli-icons/factory.png"),
    fallback: APP_LOGO_LIGHT_URL,
  },
  codebuddy: {
    kind: "codebuddy",
    displayName: "CodeBuddy",
    mascot: staticAsset("/vendor/codeisland/mascots/codebuddy.gif"),
    icon: staticAsset("/vendor/codeisland/cli-icons/codebuddy.png"),
    fallback: APP_LOGO_LIGHT_URL,
  },
  kimi: {
    kind: "kimi",
    displayName: "Kimi",
    icon: staticAsset("/vendor/codeisland/cli-icons/kimi.png"),
    fallback: APP_LOGO_LIGHT_URL,
  },
  opencode: {
    kind: "opencode",
    displayName: "OpenCode",
    mascot: staticAsset("/vendor/codeisland/mascots/opencode.gif"),
    icon: staticAsset("/vendor/codeisland/cli-icons/opencode.png"),
    fallback: APP_LOGO_LIGHT_URL,
  },
  cline: {
    kind: "cline",
    displayName: "Cline",
    mascot: staticAsset("/vendor/codeisland/mascots/cline.gif"),
    icon: staticAsset("/vendor/codeisland/cli-icons/cline.png"),
    fallback: APP_LOGO_LIGHT_URL,
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
      fallback: APP_LOGO_LIGHT_URL,
    }
  );
}
