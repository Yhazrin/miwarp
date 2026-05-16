/**
 * Setup Wizard Service
 *
 * Implements guided onboarding flow based on Cowork setup-cowork pattern.
 * Step-by-step workflow with explicit transitions and widget-based UI.
 */
import { dbg, dbgWarn } from "$lib/utils/debug";
import type { WidgetSpec } from "$lib/services/skill-executor";

// ── Types ──

export type SetupStepId = "role" | "plugin" | "try-skill" | "connectors" | "wrap";

export interface SetupStep {
  id: SetupStepId;
  titleKey: string;
  descriptionKey: string;
  action?: string;
  command?: string;
  skills?: { name: string; desc: string }[];
  widget?: WidgetSpec;
}

export interface SetupState {
  currentStep: SetupStepId;
  selectedRole?: string;
  installedPlugin?: string;
  connectedTools: string[];
  completedSteps: SetupStepId[];
}

export interface SetupResult {
  success: boolean;
  message: string;
  data?: Partial<SetupState>;
}

// ── Setup Wizard ──

export class SetupWizardService {
  private state: SetupState = {
    currentStep: "role",
    connectedTools: [],
    completedSteps: [],
  };

  // Step definitions matching Cowork setup-cowork pattern
  private steps: SetupStep[] = [
    {
      id: "role",
      titleKey: "setup_roleTitle",
      descriptionKey: "setup_roleDesc",
    },
    {
      id: "plugin",
      titleKey: "setup_pluginTitle",
      descriptionKey: "setup_pluginTitle",
      skills: [
        { name: "/schedule", desc: "setup_skillScheduleDesc" },
        { name: "/consolidate-memory", desc: "setup_skillMemoryDesc" },
        { name: "/init", desc: "setup_skillInitDesc" },
      ],
    },
    {
      id: "try-skill",
      titleKey: "setup_trySkillTitle",
      descriptionKey: "setup_trySkillDesc",
      skills: [
        { name: "/schedule", desc: "setup_scheduleDesc" },
        { name: "/consolidate-memory", desc: "setup_consolidateDesc" },
        { name: "/review", desc: "setup_reviewDesc" },
      ],
    },
    {
      id: "connectors",
      titleKey: "setup_connectorsTitle",
      descriptionKey: "setup_connectorsDesc",
      command: "/connect",
    },
    {
      id: "wrap",
      titleKey: "setup_wrapTitle",
      descriptionKey: "setup_wrapDesc",
    },
  ];

  // Role options
  private roles = [
    { id: "developer", name: "Developer", icon: "💻" },
    { id: "designer", name: "Designer", icon: "🎨" },
    { id: "product", name: "Product Manager", icon: "📦" },
    { id: "researcher", name: "Researcher", icon: "🔬" },
    { id: "writer", name: "Writer", icon: "✍️" },
    { id: "general", name: "General Productivity", icon: "⚡" },
  ];

  /**
   * Get current step
   */
  getCurrentStep(): SetupStep | undefined {
    return this.steps.find((s) => s.id === this.state.currentStep);
  }

  /**
   * Get all steps with status
   */
  getStepsWithStatus(): Array<SetupStep & { status: "completed" | "active" | "pending" }> {
    return this.steps.map((step) => {
      if (this.state.completedSteps.includes(step.id)) {
        return { ...step, status: "completed" as const };
      }
      if (step.id === this.state.currentStep) {
        return { ...step, status: "active" as const };
      }
      return { ...step, status: "pending" as const };
    });
  }

  /**
   * Get role options
   */
  getRoles(): { id: string; name: string; icon: string }[] {
    return this.roles;
  }

  /**
   * Get recommended plugin for role
   */
  getRecommendedPlugin(roleId: string): { id: string; name: string; description: string } | null {
    const pluginMap: Record<string, { id: string; name: string; description: string }> = {
      developer: {
        id: "engineering",
        name: "Engineering",
        description: "Dev tools, code review, testing workflows",
      },
      designer: {
        id: "design",
        name: "Design",
        description: "Design handoff, asset management, feedback",
      },
      product: {
        id: "product",
        name: "Product",
        description: "Roadmap tracking, user research, specs",
      },
      researcher: {
        id: "research",
        name: "Research",
        description: "Literature review, note organization, citation",
      },
      writer: {
        id: "writing",
        name: "Writing",
        description: "Content drafting, editing, publishing",
      },
      general: {
        id: "productivity",
        name: "Productivity",
        description: "Email, calendar, notes, reminders",
      },
    };

    return pluginMap[roleId] || pluginMap.general;
  }

  /**
   * Proceed to next step
   */
  nextStep(): SetupResult {
    const currentIndex = this.steps.findIndex((s) => s.id === this.state.currentStep);

    if (currentIndex === -1 || currentIndex === this.steps.length - 1) {
      return { success: false, message: "Already at final step" };
    }

    this.state.completedSteps.push(this.state.currentStep);
    this.state.currentStep = this.steps[currentIndex + 1].id;

    dbg("setup-wizard", "nextStep", { newStep: this.state.currentStep });

    return {
      success: true,
      message: `Proceeding to: ${this.state.currentStep}`,
      data: { currentStep: this.state.currentStep },
    };
  }

  /**
   * Skip current step
   */
  skipStep(): SetupResult {
    return this.nextStep();
  }

  /**
   * Jump to specific step
   */
  jumpToStep(stepId: SetupStepId): SetupResult {
    const targetStep = this.steps.find((s) => s.id === stepId);

    if (!targetStep) {
      return { success: false, message: `Unknown step: ${stepId}` };
    }

    this.state.currentStep = stepId;
    dbg("setup-wizard", "jumpToStep", { step: stepId });

    return {
      success: true,
      message: `Jumped to: ${stepId}`,
      data: { currentStep: stepId },
    };
  }

  /**
   * Select role
   */
  selectRole(roleId: string): SetupResult {
    const role = this.roles.find((r) => r.id === roleId);

    if (!role) {
      return { success: false, message: `Unknown role: ${roleId}` };
    }

    this.state.selectedRole = roleId;
    dbg("setup-wizard", "selectRole", { role: roleId });

    return {
      success: true,
      message: `Selected role: ${role.name}`,
      data: { selectedRole: roleId },
    };
  }

  /**
   * Install plugin
   */
  installPlugin(pluginId: string): SetupResult {
    this.state.installedPlugin = pluginId;
    dbg("setup-wizard", "installPlugin", { plugin: pluginId });

    return {
      success: true,
      message: `Plugin installed: ${pluginId}`,
      data: { installedPlugin: pluginId },
    };
  }

  /**
   * Connect a tool
   */
  connectTool(toolId: string): SetupResult {
    if (!this.state.connectedTools.includes(toolId)) {
      this.state.connectedTools.push(toolId);
    }
    dbg("setup-wizard", "connectTool", { tool: toolId });

    return {
      success: true,
      message: `Connected tool: ${toolId}`,
      data: { connectedTools: this.state.connectedTools },
    };
  }

  /**
   * Get progress widget data
   */
  getProgressWidget(): WidgetSpec {
    const stepsWithStatus = this.getStepsWithStatus();

    return {
      type: "progress",
      data: {
        steps: stepsWithStatus.map((s) => ({
          id: s.id,
          title: s.titleKey,
          status: s.status,
        })),
        current: this.steps.findIndex((s) => s.id === this.state.currentStep),
        total: this.steps.length,
      },
    };
  }

  /**
   * Get role picker widget data
   */
  getRolePickerWidget(): WidgetSpec {
    return {
      type: "list",
      data: {
        items: this.roles.map((r) => ({
          id: r.id,
          text: `${r.icon} ${r.name}`,
          action: "selectRole",
        })),
        multiSelect: false,
      },
    };
  }

  /**
   * Get connector suggestions widget
   */
  getConnectorSuggestionsWidget(roleId?: string): WidgetSpec {
    // Mock connector data based on role
    const connectors = this.getConnectorsForRole(roleId);

    return {
      type: "list",
      data: {
        items: connectors.map((c) => ({
          id: c.id,
          text: `${c.icon} ${c.name}`,
          description: c.description,
          action: "connect",
        })),
        multiSelect: true,
      },
    };
  }

  /**
   * Get connectors for role
   */
  private getConnectorsForRole(
    roleId?: string,
  ): { id: string; name: string; icon: string; description: string }[] {
    const allConnectors: Record<
      string,
      { id: string; name: string; icon: string; description: string }[]
    > = {
      developer: [
        { id: "github", name: "GitHub", icon: "🐙", description: "Code repositories and PRs" },
        { id: "slack", name: "Slack", icon: "💬", description: "Team communication" },
        { id: "jira", name: "Jira", icon: "📋", description: "Issue tracking" },
      ],
      general: [
        { id: "email", name: "Email", icon: "📧", description: "Gmail, Outlook integration" },
        { id: "calendar", name: "Calendar", icon: "📅", description: "Google Calendar, Outlook" },
        { id: "notes", name: "Notes", icon: "📝", description: "Notion, Evernote" },
      ],
    };

    return roleId && allConnectors[roleId] ? allConnectors[roleId] : allConnectors.general;
  }

  /**
   * Get current state
   */
  getState(): SetupState {
    return { ...this.state };
  }

  /**
   * Reset to beginning
   */
  reset(): void {
    this.state = {
      currentStep: "role",
      connectedTools: [],
      completedSteps: [],
    };
    dbg("setup-wizard", "reset");
  }

  /**
   * Check if setup is complete
   */
  isComplete(): boolean {
    return this.state.currentStep === "wrap" && this.state.completedSteps.length >= 4;
  }

  /**
   * Generate summary message
   */
  getSummary(): string {
    const parts: string[] = [];

    if (this.state.selectedRole) {
      const role = this.roles.find((r) => r.id === this.state.selectedRole);
      parts.push(`Role: ${role?.name || this.state.selectedRole}`);
    }

    if (this.state.installedPlugin) {
      parts.push(`Plugin: ${this.state.installedPlugin}`);
    }

    if (this.state.connectedTools.length > 0) {
      parts.push(`Tools: ${this.state.connectedTools.length} connected`);
    }

    return parts.join(" | ");
  }
}

// Create singleton instance
export const setupWizardService = new SetupWizardService();
