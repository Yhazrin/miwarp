/**
 * User Role Store - Svelte 5 state management for user roles and onboarding
 * 
 * Implements role-based personalization inspired by Claude Code's setup flow:
 * - Collect user role on first use
 * - Recommend plugins/skills based on role
 * - Provide personalized starting experience
 */
import { dbg, dbgWarn } from "$lib/utils/debug";
import type { UserRole, Permission } from "$lib/types/user-role";
import { ROLE_PERMISSIONS, ROLE_DESCRIPTIONS, PermissionChecker } from "$lib/types/user-role";

// User role definitions for onboarding
export type UserProfession = 
  | "developer"           // Software developer
  | "data_scientist"      // Data/ML engineer
  | "devops"              // DevOps/infrastructure
  | "product_manager"     // Product manager
  | "designer"            // Designer/UX
  | "student"             // Student/learner
  | "researcher"          // Researcher
  | "entrepreneur"        // Entrepreneur/startup
  | "other";              // Other

// Onboarding experience configuration per profession
export interface OnboardingConfig {
  showWelcome: boolean;
  recommendedSkills: string[];
  recommendedPlugins: string[];
  suggestedProjects: string[];
  quickStartTemplate: string;
  uiPreferences: {
    showAdvancedFeatures: boolean;
    defaultAgent: "claude" | "codex";
    autoConnectMcp: boolean;
    theme: "light" | "dark" | "system";
  };
  skipSetupSteps: string[];
}

// Onboarding configurations for different user types
export const ONBOARDING_CONFIGS: Record<UserProfession, OnboardingConfig> = {
  developer: {
    showWelcome: true,
    recommendedSkills: ["code-review", "git-assist", "test-generation", "refactor"],
    recommendedPlugins: ["github-integration", "vscode-sync", "docker-assist"],
    suggestedProjects: ["backend-api", "frontend-app", "fullstack-app"],
    quickStartTemplate: "developer-quickstart",
    uiPreferences: {
      showAdvancedFeatures: true,
      defaultAgent: "claude",
      autoConnectMcp: true,
      theme: "system",
    },
    skipSetupSteps: [],
  },
  data_scientist: {
    showWelcome: true,
    recommendedSkills: ["data-analysis", "model-debug", "jupyter-assist", "ml-pipeline"],
    recommendedPlugins: ["jupyter-integration", "wandb-sync", "mlflow-assist"],
    suggestedProjects: ["ml-project", "data-pipeline", "analytics-dashboard"],
    quickStartTemplate: "data-science-quickstart",
    uiPreferences: {
      showAdvancedFeatures: true,
      defaultAgent: "claude",
      autoConnectMcp: false,
      theme: "system",
    },
    skipSetupSteps: [],
  },
  devops: {
    showWelcome: true,
    recommendedSkills: ["infra-review", "ci-cd-assist", "dockerfile-gen", "terraform-assist"],
    recommendedPlugins: ["aws-assist", "k8s-assist", "terraform-integration"],
    suggestedProjects: ["infra-config", "ci-pipeline", "container-setup"],
    quickStartTemplate: "devops-quickstart",
    uiPreferences: {
      showAdvancedFeatures: true,
      defaultAgent: "claude",
      autoConnectMcp: true,
      theme: "dark",
    },
    skipSetupSteps: [],
  },
  product_manager: {
    showWelcome: true,
    recommendedSkills: ["prd-review", "spec-generator", "meeting-notes", "doc-assist"],
    recommendedPlugins: ["jira-integration", "notion-sync", "slack-assist"],
    suggestedProjects: ["product-doc", "spec-template", "roadmap-planning"],
    quickStartTemplate: "pm-quickstart",
    uiPreferences: {
      showAdvancedFeatures: false,
      defaultAgent: "claude",
      autoConnectMcp: false,
      theme: "light",
    },
    skipSetupSteps: ["advanced-cli"],
  },
  designer: {
    showWelcome: true,
    recommendedSkills: ["figma-assist", "css-generation", "design-review", "accessibility-check"],
    recommendedPlugins: ["figma-sync", "css-assist", "framer-prototype"],
    suggestedProjects: ["design-system", "component-library", "landing-page"],
    quickStartTemplate: "designer-quickstart",
    uiPreferences: {
      showAdvancedFeatures: false,
      defaultAgent: "claude",
      autoConnectMcp: false,
      theme: "light",
    },
    skipSetupSteps: ["advanced-cli", "mcp-setup"],
  },
  student: {
    showWelcome: true,
    recommendedSkills: ["learning-assist", "code-explanation", "debug-help", "study-notes"],
    recommendedPlugins: ["github-student", "notion-sync"],
    suggestedProjects: ["learning-project", "assignment", "practice-exercises"],
    quickStartTemplate: "student-quickstart",
    uiPreferences: {
      showAdvancedFeatures: false,
      defaultAgent: "claude",
      autoConnectMcp: false,
      theme: "system",
    },
    skipSetupSteps: ["advanced-cli", "mcp-setup"],
  },
  researcher: {
    showWelcome: true,
    recommendedSkills: ["paper-summary", "citation-assist", "experiment-track", "latex-assist"],
    recommendedPlugins: ["zotero-sync", "arxiv-assist", "overleaf-sync"],
    suggestedProjects: ["research-notes", "paper-draft", "experiment-log"],
    quickStartTemplate: "researcher-quickstart",
    uiPreferences: {
      showAdvancedFeatures: true,
      defaultAgent: "claude",
      autoConnectMcp: false,
      theme: "system",
    },
    skipSetupSteps: [],
  },
  entrepreneur: {
    showWelcome: true,
    recommendedSkills: ["mvp-builder", "pitch-deck", "market-research", "spec-generator"],
    recommendedPlugins: ["stripe-assist", "vercel-deploy", "notion-sync"],
    suggestedProjects: ["mvp", "landing-page", "saas-app"],
    quickStartTemplate: "entrepreneur-quickstart",
    uiPreferences: {
      showAdvancedFeatures: false,
      defaultAgent: "claude",
      autoConnectMcp: false,
      theme: "system",
    },
    skipSetupSteps: ["advanced-cli"],
  },
  other: {
    showWelcome: true,
    recommendedSkills: ["general-assist"],
    recommendedPlugins: [],
    suggestedProjects: [],
    quickStartTemplate: "general-quickstart",
    uiPreferences: {
      showAdvancedFeatures: false,
      defaultAgent: "claude",
      autoConnectMcp: false,
      theme: "system",
    },
    skipSetupSteps: [],
  },
};

// User profile interface
export interface UserProfile {
  id: string;
  email?: string;
  name?: string;
  profession?: UserProfession;
  role: UserRole;
  createdAt: string;
  lastActiveAt: string;
  preferences: {
    theme?: "light" | "dark" | "system";
    language?: string;
    agent?: "claude" | "codex";
  };
  onboarding: {
    completed: boolean;
    completedAt?: string;
    skippedSteps: string[];
  };
  stats: {
    totalSessions: number;
    totalTokens: number;
    activeDays: number;
  };
}

// State interface
export interface UserRoleState {
  profile: UserProfile | null;
  permissionChecker: PermissionChecker | null;
  isOnboarding: boolean;
  onboardingStep: number;
}

// Default user profile
const createDefaultProfile = (): UserProfile => ({
  id: crypto.randomUUID(),
  role: "developer", // Default role
  createdAt: new Date().toISOString(),
  lastActiveAt: new Date().toISOString(),
  preferences: {
    theme: "system",
    language: "en",
    agent: "claude",
  },
  onboarding: {
    completed: false,
    skippedSteps: [],
  },
  stats: {
    totalSessions: 0,
    totalTokens: 0,
    activeDays: 0,
  },
});

// Create the store
function createUserRoleStore() {
  const state = $state<UserRoleState>({
    profile: null,
    permissionChecker: null,
    isOnboarding: false,
    onboardingStep: 0,
  });

  // Derived state
  const hasProfile = $derived(state.profile !== null);
  const onboardingConfig = $derived(
    state.profile?.profession 
      ? ONBOARDING_CONFIGS[state.profile.profession]
      : ONBOARDING_CONFIGS.other
  );
  const canManageUsers = $derived(
    state.permissionChecker?.hasPermission("user:manage") ?? false
  );
  const isAdmin = $derived(
    state.profile?.role === "owner" || state.profile?.role === "admin"
  );

  // Actions
  function createProfile(profession?: UserProfession): UserProfile {
    const profile = createDefaultProfile();
    if (profession) {
      profile.profession = profession;
      
      // Apply onboarding config
      const config = ONBOARDING_CONFIGS[profession];
      profile.preferences.theme = config.uiPreferences.theme;
      profile.preferences.agent = config.uiPreferences.defaultAgent;
    }
    
    state.profile = profile;
    state.permissionChecker = new PermissionChecker(profile.role);
    
    dbg("user-role-store", "Created profile", { profession, role: profile.role });
    return profile;
  }

  function updateProfile(updates: Partial<UserProfile>): void {
    if (!state.profile) return;
    
    state.profile = {
      ...state.profile,
      ...updates,
      lastActiveAt: new Date().toISOString(),
    };
    
    dbg("user-role-store", "Updated profile", updates);
  }

  function setProfession(profession: UserProfession): void {
    if (!state.profile) return;
    
    const config = ONBOARDING_CONFIGS[profession];
    
    state.profile.profession = profession;
    state.profile.preferences = {
      ...state.profile.preferences,
      ...config.uiPreferences,
    };
    
    dbg("user-role-store", "Set profession", profession);
  }

  function completeOnboarding(skippedSteps: string[] = []): void {
    if (!state.profile) return;
    
    state.profile.onboarding = {
      completed: true,
      completedAt: new Date().toISOString(),
      skippedSteps,
    };
    
    state.isOnboarding = false;
    state.onboardingStep = 0;
    
    dbg("user-role-store", "Onboarding completed");
  }

  function startOnboarding(): void {
    state.isOnboarding = true;
    state.onboardingStep = 0;
    dbg("user-role-store", "Started onboarding");
  }

  function nextOnboardingStep(): void {
    state.onboardingStep++;
  }

  function skipOnboardingStep(step: string): void {
    if (!state.profile) return;
    
    state.profile.onboarding.skippedSteps.push(step);
    state.onboardingStep++;
    
    dbg("user-role-store", "Skipped step", step);
  }

  function setRole(role: UserRole): void {
    if (!state.profile) return;
    
    state.profile.role = role;
    state.permissionChecker = new PermissionChecker(role);
    
    dbg("user-role-store", "Changed role to", role);
  }

  function updateStats(updates: Partial<UserProfile["stats"]>): void {
    if (!state.profile) return;
    
    state.profile.stats = {
      ...state.profile.stats,
      ...updates,
    };
  }

  function incrementSession(): void {
    if (!state.profile) return;
    state.profile.stats.totalSessions++;
  }

  function updateLastActive(): void {
    if (!state.profile) return;
    state.profile.lastActiveAt = new Date().toISOString();
  }

  // Permission helpers
  function hasPermission(permission: Permission): boolean {
    return state.permissionChecker?.hasPermission(permission) ?? false;
  }

  function hasAllPermissions(permissions: Permission[]): boolean {
    return state.permissionChecker?.hasAllPermissions(permissions) ?? false;
  }

  // Load profile from storage
  function loadProfile(profile: UserProfile): void {
    state.profile = profile;
    state.permissionChecker = new PermissionChecker(profile.role);
    state.isOnboarding = !profile.onboarding.completed;
    
    dbg("user-role-store", "Loaded profile", profile.id);
  }

  // Clear profile (logout)
  function clearProfile(): void {
    state.profile = null;
    state.permissionChecker = null;
    state.isOnboarding = false;
    state.onboardingStep = 0;
    
    dbg("user-role-store", "Cleared profile");
  }

  return {
    // State accessors
    get profile() { return state.profile; },
    get isOnboarding() { return state.isOnboarding; },
    get onboardingStep() { return state.onboardingStep; },
    
    // Derived state
    get hasProfile() { return hasProfile; },
    get onboardingConfig() { return onboardingConfig; },
    get canManageUsers() { return canManageUsers; },
    get isAdmin() { return isAdmin; },
    
    // Actions
    createProfile,
    updateProfile,
    setProfession,
    completeOnboarding,
    startOnboarding,
    nextOnboardingStep,
    skipOnboardingStep,
    setRole,
    updateStats,
    incrementSession,
    updateLastActive,
    
    // Permission helpers
    hasPermission,
    hasAllPermissions,
    
    // Persistence
    loadProfile,
    clearProfile,
  };
}

// Export singleton instance
export const userRoleStore = createUserRoleStore();

// Export profession descriptions for UI
export const PROFESSION_DESCRIPTIONS: Record<UserProfession, string> = {
  developer: "Software development, coding, and engineering",
  data_scientist: "Data analysis, machine learning, and research",
  devops: "Infrastructure, CI/CD, and cloud operations",
  product_manager: "Product planning, specs, and coordination",
  designer: "UI/UX design, prototypes, and design systems",
  student: "Learning programming and computer science",
  researcher: "Academic research and paper writing",
  entrepreneur: "Building MVPs and startups",
  other: "General purpose use",
};

// Export role display info
export const ROLE_DISPLAY_INFO: Record<UserRole, { label: string; description: string; color: string }> = {
  owner: { label: "Owner", description: "Full access to all features", color: "purple" },
  admin: { label: "Admin", description: "Can manage team and settings", color: "blue" },
  developer: { label: "Developer", description: "Can execute skills and workflows", color: "green" },
  viewer: { label: "Viewer", description: "Read-only access", color: "gray" },
  guest: { label: "Guest", description: "Limited read-only access", color: "gray" },
};
