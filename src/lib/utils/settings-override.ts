/**
 * Settings Override System
 * 
 * Implements multi-level settings override like Claude Code:
 * - System defaults (hardcoded)
 * - User settings (~/.miwarp/settings.json)
 * - Project settings (<project>/.miwarp/settings.json)
 * - Runtime overrides (environment variables, CLI args)
 * 
 * Settings are resolved in order of priority (highest first):
 * 1. Environment variables
 * 2. Runtime overrides
 * 3. Project-level settings
 * 4. User-level settings
 * 5. System defaults
 */
import { dbg, dbgWarn } from "./debug";

// Settings source priority
export type SettingsSource = 
  | "system"      // Hardcoded defaults
  | "user"         // ~/.miwarp/settings.json
  | "project"      // <project>/.miwarp/settings.json
  | "runtime"      // Runtime overrides (e.g., from CLI)
  | "environment"; // Environment variables

export interface SettingsOverride<T> {
  value: T;
  source: SettingsSource;
  override?: boolean; // Whether this overrides lower-priority sources
}

// Base settings interface
export interface BaseSettings {
  // Session settings
  defaultAgent?: "claude" | "codex";
  autoFork?: boolean;
  maxHistory?: number;
  
  // UI settings
  theme?: "light" | "dark" | "system";
  language?: string;
  fontSize?: number;
  
  // Behavior settings
  permissionMode?: "auto" | "ask" | "bypass";
  autoApproveTools?: string[];
  timeoutMinutes?: number;
  
  // MCP settings
  autoConnectMcp?: boolean;
  mcpTimeout?: number;
  
  // Model settings
  defaultModel?: string;
  defaultProvider?: string;
  temperature?: number;
}

// Project settings that can override user settings
export interface ProjectSettings extends BaseSettings {
  projectPath?: string; // Resolved project path
  projectName?: string; // Project name for display
  
  // Project-specific overrides
  customCommands?: Record<string, string>;
  autoAttach?: boolean; // Auto-attach to this project on startup
  priority?: number; // Project priority (higher = more prominent in sidebar)
  
  // Environment overrides for this project
  envVars?: Record<string, string>;
  
  // Team settings
  teamId?: string;
  defaultBranch?: string;
}

// Settings override configuration
export interface SettingsOverrideConfig {
  source: SettingsSource;
  field: string;
  priority: number; // 0 = lowest, 100 = highest
  metadata?: Record<string, unknown>;
}

// Resolver for multi-level settings
export class SettingsResolver<T extends BaseSettings> {
  private sources: Map<SettingsSource, Partial<T>> = new Map();
  private overrides: Map<SettingsSource, Set<string>> = new Map();
  
  constructor(private defaults: T) {
    // Initialize with system defaults
    this.sources.set("system", { ...defaults });
  }
  
  /**
   * Set settings for a specific source level.
   */
  setSettings(source: SettingsSource, settings: Partial<T>, isOverride = false): void {
    this.sources.set(source, settings);
    
    if (isOverride) {
      if (!this.overrides.has(source)) {
        this.overrides.set(source, new Set());
      }
      // Mark all fields as overrides
      for (const key of Object.keys(settings)) {
        this.overrides.get(source)!.add(key);
      }
    }
    
    dbg("settings-resolver", `Set ${source} settings`, {
      fieldCount: Object.keys(settings).length,
      isOverride,
    });
  }
  
  /**
   * Remove settings from a specific source.
   */
  removeSettings(source: SettingsSource): void {
    this.sources.delete(source);
    this.overrides.delete(source);
    dbg("settings-resolver", `Removed ${source} settings`);
  }
  
  /**
   * Get the resolved settings with proper override precedence.
   */
  resolve(): T {
    const result = { ...this.defaults };
    
    // Apply in order of priority (system -> user -> project -> runtime -> env)
    const priorityOrder: SettingsSource[] = [
      "system",
      "user", 
      "project",
      "runtime",
      "environment",
    ];
    
    for (const source of priorityOrder) {
      const sourceSettings = this.sources.get(source);
      if (sourceSettings) {
        Object.assign(result, sourceSettings);
      }
    }
    
    return result;
  }
  
  /**
   * Get the source of a specific setting.
   */
  getSource(field: string): SettingsSource | null {
    const priorityOrder: SettingsSource[] = [
      "environment",
      "runtime", 
      "project",
      "user",
      "system",
    ];
    
    for (const source of priorityOrder) {
      const sourceSettings = this.sources.get(source);
      if (sourceSettings && field in sourceSettings) {
        return source;
      }
    }
    
    return null;
  }
  
  /**
   * Get all settings with their sources.
   */
  resolveWithSources(): Record<keyof T, SettingsOverride<unknown>> {
    const result: Record<string, SettingsOverride<unknown>> = {};
    const priorityOrder: SettingsSource[] = [
      "system",
      "user",
      "project", 
      "runtime",
      "environment",
    ];
    
    for (const key of Object.keys(this.defaults)) {
      let value: unknown = this.defaults[key as keyof T];
      let source: SettingsSource = "system";
      
      for (const src of priorityOrder) {
        const srcSettings = this.sources.get(src);
        if (srcSettings && key in srcSettings) {
          value = srcSettings[key as keyof typeof srcSettings];
          source = src;
          break;
        }
      }
      
      result[key as string] = {
        value,
        source,
        override: this.overrides.get(source)?.has(key) ?? false,
      };
    }
    
    return result as Record<keyof T, SettingsOverride<unknown>>;
  }
  
  /**
   * Create a diff showing which sources override which values.
   */
  getDiff(): Record<string, { current: unknown; previous: unknown; source: SettingsSource }> {
    const diff: Record<string, { current: unknown; previous: unknown; source: SettingsSource }> = {};
    const resolved = this.resolve();
    const systemDefaults = this.sources.get("system") || {};
    
    for (const key of Object.keys(resolved)) {
      const value = resolved[key as keyof T];
      const defaultValue = systemDefaults[key as keyof typeof systemDefaults];
      
      if (value !== defaultValue) {
        diff[key as string] = {
          current: value,
          previous: defaultValue,
          source: this.getSource(key) || "system",
        };
      }
    }
    
    return diff;
  }
}

/**
 * Project settings manager
 */
export class ProjectSettingsManager {
  private resolvers: Map<string, SettingsResolver<ProjectSettings>> = new Map();
  private activeProject: string | null = null;
  
  constructor(private userDefaults: ProjectSettings) {}
  
  /**
   * Load project settings from a path.
   */
  loadProjectSettings(projectPath: string, projectSettings: Partial<ProjectSettings>): void {
    const resolver = new SettingsResolver<ProjectSettings>(this.userDefaults);
    resolver.setSettings("user", this.userDefaults);
    resolver.setSettings("project", projectSettings, true);
    
    this.resolvers.set(projectPath, resolver);
    dbg("project-settings", `Loaded settings for project: ${projectPath}`);
  }
  
  /**
   * Get resolved settings for a project.
   */
  getProjectSettings(projectPath: string): ProjectSettings | null {
    const resolver = this.resolvers.get(projectPath);
    return resolver ? resolver.resolve() : null;
  }
  
  /**
   * Set active project.
   */
  setActiveProject(projectPath: string | null): void {
    this.activeProject = projectPath;
    dbg("project-settings", `Active project: ${projectPath}`);
  }
  
  /**
   * Get active project's settings.
   */
  getActiveProjectSettings(): ProjectSettings | null {
    if (!this.activeProject) return null;
    return this.getProjectSettings(this.activeProject);
  }
  
  /**
   * Update settings for a specific project.
   */
  updateProjectSettings(projectPath: string, updates: Partial<ProjectSettings>): void {
    const resolver = this.resolvers.get(projectPath);
    if (resolver) {
      resolver.setSettings("project", updates, true);
    }
  }
  
  /**
   * Get all loaded projects.
   */
  getLoadedProjects(): string[] {
    return Array.from(this.resolvers.keys());
  }
  
  /**
   * Check if a project has custom settings.
   */
  hasCustomSettings(projectPath: string): boolean {
    const resolver = this.resolvers.get(projectPath);
    if (!resolver) return false;
    
    const diff = resolver.getDiff();
    return Object.keys(diff).length > 0;
  }
  
  /**
   * Remove project settings.
   */
  removeProjectSettings(projectPath: string): void {
    this.resolvers.delete(projectPath);
    if (this.activeProject === projectPath) {
      this.activeProject = null;
    }
  }
}

/**
 * Environment variable settings extractor.
 * Extracts known settings from environment variables.
 */
export function extractEnvSettings(): Partial<BaseSettings> {
  const settings: Partial<BaseSettings> = {};
  
  // Check for known environment variables
  if (process.env.MIWARP_THEME) {
    const theme = process.env.MIWARP_THEME as "light" | "dark" | "system";
    if (["light", "dark", "system"].includes(theme)) {
      settings.theme = theme;
    }
  }
  
  if (process.env.MIWARP_LANGUAGE) {
    settings.language = process.env.MIWARP_LANGUAGE;
  }
  
  if (process.env.MIWARP_DEFAULT_AGENT) {
    const agent = process.env.MIWARP_DEFAULT_AGENT as "claude" | "codex";
    if (["claude", "codex"].includes(agent)) {
      settings.defaultAgent = agent;
    }
  }
  
  if (process.env.MIWARP_PERMISSION_MODE) {
    const mode = process.env.MIWARP_PERMISSION_MODE as "auto" | "ask" | "bypass";
    if (["auto", "ask", "bypass"].includes(mode)) {
      settings.permissionMode = mode;
    }
  }
  
  if (process.env.MIWARP_TIMEOUT_MINUTES) {
    const timeout = parseInt(process.env.MIWARP_TIMEOUT_MINUTES, 10);
    if (!isNaN(timeout) && timeout > 0) {
      settings.timeoutMinutes = timeout;
    }
  }
  
  if (process.env.MIWARP_DEFAULT_MODEL) {
    settings.defaultModel = process.env.MIWARP_DEFAULT_MODEL;
  }
  
  return settings;
}

/**
 * Create a settings override context for display purposes.
 */
export interface SettingsOverrideDisplay {
  label: string;
  value: string;
  source: SettingsSource;
  canOverride: boolean;
}

/**
 * Format settings for display in UI.
 */
export function formatSettingsForDisplay(settings: BaseSettings): SettingsOverrideDisplay[] {
  const display: SettingsOverrideDisplay[] = [];
  
  const knownFields: Record<string, { label: string; format: (v: unknown) => string }> = {
    defaultAgent: { label: "Default Agent", format: (v) => String(v) },
    theme: { label: "Theme", format: (v) => String(v) },
    language: { label: "Language", format: (v) => String(v) },
    fontSize: { label: "Font Size", format: (v) => `${v}px` },
    permissionMode: { label: "Permission Mode", format: (v) => String(v) },
    autoApproveTools: { 
      label: "Auto-approve Tools", 
      format: (v) => Array.isArray(v) ? v.join(", ") : String(v) 
    },
    timeoutMinutes: { label: "Timeout", format: (v) => `${v} min` },
    defaultModel: { label: "Default Model", format: (v) => String(v) },
  };
  
  for (const [field, config] of Object.entries(knownFields)) {
    const value = (settings as Record<string, unknown>)[field];
    if (value !== undefined) {
      display.push({
        label: config.label,
        value: config.format(value),
        source: "user", // Default assumption
        canOverride: true,
      });
    }
  }
  
  return display;
}
