/**
 * Grouped prop interfaces for ChatInputDock.
 *
 * These VMs reduce the component's interface surface from ~35 individual
 * props to 4 semantic groups. Template code is unchanged — the component
 * destructures each VM at the top level.
 */
import type {
  AgentSettings,
  AuthOverview,
  CliModelInfo,
  CliCommand,
  AgentDefinitionSummary,
} from "$lib/types";
import type { ProcessVisibility } from "$lib/utils/process-visibility";
import type { ConversationInsightHandle } from "$lib/conversation-insight/use-conversation-insight.svelte";

// ── Prompt input configuration ──

export interface InputVm {
  processVisibility: ProcessVisibility;
  agentSettings: AgentSettings | null;
  effectiveModels: CliModelInfo[];
  folderCwdOverride: string;
  welcomeVisible: boolean;
  skillItems: Array<{ name: string; description: string }>;
  preloadedAgents: AgentDefinitionSummary[];
  teamHintVisible: boolean;
  userHistory: string[];
  projectCommands: CliCommand[];
  authOverview: AuthOverview | null;
  localProxyStatuses: Record<string, { running: boolean; needsAuth: boolean }>;
}

// ── Permission / elicitation panel ──

export interface PermissionVm {
  pendingToolPermissions: Array<{ tool: import("$lib/types").BusToolItem; requestId: string }>;
  inputBlockedByPermission: boolean;
}

// ── Side panels (BTW, insight, created files) ──

export interface SidePanelsVm {
  btwState: {
    active: boolean;
    btwId: string | null;
    question: string;
    answer: string;
    error: string | null;
    loading: boolean;
  };
  insight: ConversationInsightHandle;
  hasCreatedFiles: boolean;
  createdFiles: Array<{ path: string; name: string; tool: string; timestamp: number }>;
  setBtwState: (v: SidePanelsVm["btwState"]) => void;
}

// ── Handlers (callbacks) ──

export interface InputDockHandlers {
  sendMessage: (
    text: string,
    attachments: import("$lib/types").Attachment[],
    creationMode?: "single" | "worktree",
    folderId?: string,
  ) => Promise<void>;
  handleModelChange: (model: string) => void;
  handlePermissionModeChange: ((mode: string) => void) | undefined;
  handleVirtualCommand: (action: string, args: string) => Promise<void>;
  handleFastModeSwitch: (mode: "on" | "off") => Promise<void>;
  handlePlatformChange: (id: string) => void;
  handleAuthModeChange: (mode: string) => void;
  handleInputValueChange: (value: string) => void;
  handlePermissionRespond: (
    requestId: string,
    behavior: "allow" | "deny",
    updatedPermissions?: import("$lib/types").PermissionSuggestion[],
    updatedInput?: Record<string, unknown>,
    denyMessage?: string,
    interrupt?: boolean,
  ) => Promise<void>;
  handleElicitationRespond: (
    requestId: string,
    action: "accept" | "decline" | "cancel",
    content?: Record<string, unknown>,
  ) => Promise<void>;
  handleBtwSend: (text: string) => void;
  handleRalphCancel: () => void;
  showChatToast: (msg: string) => void;
}
