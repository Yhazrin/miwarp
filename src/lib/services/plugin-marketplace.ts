/**
 * Plugin Marketplace Service
 *
 * Handles all plugin marketplace operations including:
 * - Plugin discovery and search
 * - Installation/uninstallation workflows
 * - Marketplace API integration
 * - Plugin state management
 */
import { dbg, dbgWarn } from "$lib/utils/debug";
import {
  listMarketplacePlugins,
  listInstalledPlugins,
  installPlugin,
  uninstallPlugin,
  enablePlugin,
  disablePlugin,
  updatePlugin,
  addMarketplace,
  removeMarketplace,
  updateMarketplace,
  listMarketplaces,
  searchCommunitySkills,
  checkCommunityHealth,
  getCommunitySkillDetail,
  installCommunitySkill,
  type MarketplacePlugin,
  type InstalledPlugin,
  type MarketplaceInfo,
  type CommunitySkillResult,
  type CommunitySkillDetail,
  type ProviderHealth,
  type PluginOperationResult,
} from "$lib/api";

// Filter options for plugin search
export interface PluginFilters {
  category?: string;
  tags?: string[];
  source?: string;
  scope?: "user" | "project" | "local";
  searchQuery?: string;
}

// Plugin with additional runtime state
export interface PluginState extends MarketplacePlugin {
  isInstalled: boolean;
  installedVersion?: string;
  enabled?: boolean;
  installScope?: "user" | "project" | "local";
}

// Plugin installer configuration
export interface InstallConfig {
  pluginName: string;
  scope: "user" | "project" | "local";
  projectCwd?: string;
  autoEnable?: boolean;
}

// MCP connector info
export interface McpConnector {
  name: string;
  transport: string;
  url?: string;
  envVars?: Record<string, string>;
  headers?: Record<string, string>;
}

// Installation progress callback
export type ProgressCallback = (stage: string, progress: number, message?: string) => void;

export class PluginMarketplaceService {
  private static instance: PluginMarketplaceService;

  private constructor() {}

  static getInstance(): PluginMarketplaceService {
    if (!PluginMarketplaceService.instance) {
      PluginMarketplaceService.instance = new PluginMarketplaceService();
    }
    return PluginMarketplaceService.instance;
  }

  /**
   * Fetch all available marketplace plugins
   */
  async fetchMarketplacePlugins(): Promise<MarketplacePlugin[]> {
    try {
      const plugins = await listMarketplacePlugins();
      dbg("plugin-marketplace", "fetchMarketplacePlugins", { count: plugins.length });
      return plugins;
    } catch (e) {
      dbgWarn("plugin-marketplace", "fetchMarketplacePlugins error", e);
      return [];
    }
  }

  /**
   * Fetch all installed plugins
   */
  async fetchInstalledPlugins(): Promise<InstalledPlugin[]> {
    try {
      const plugins = await listInstalledPlugins();
      dbg("plugin-marketplace", "fetchInstalledPlugins", { count: plugins.length });
      return plugins;
    } catch (e) {
      dbgWarn("plugin-marketplace", "fetchInstalledPlugins error", e);
      return [];
    }
  }

  /**
   * Fetch all configured marketplaces
   */
  async fetchMarketplaces(): Promise<MarketplaceInfo[]> {
    try {
      const marketplaces = await listMarketplaces();
      dbg("plugin-marketplace", "fetchMarketplaces", { count: marketplaces.length });
      return marketplaces;
    } catch (e) {
      dbgWarn("plugin-marketplace", "fetchMarketplaces error", e);
      return [];
    }
  }

  /**
   * Filter plugins based on search criteria
   */
  filterPlugins(plugins: MarketplacePlugin[], filters: PluginFilters): MarketplacePlugin[] {
    return plugins.filter((plugin) => {
      // Category filter
      if (filters.category && plugin.category !== filters.category) {
        return false;
      }

      // Tags filter
      if (filters.tags && filters.tags.length > 0) {
        const hasMatchingTag = filters.tags.some((tag) =>
          plugin.tags.some((t) => t.toLowerCase().includes(tag.toLowerCase())),
        );
        if (!hasMatchingTag) return false;
      }

      // Source filter
      if (filters.source && plugin.marketplace_name !== filters.source) {
        return false;
      }

      // Search query
      if (filters.searchQuery) {
        const query = filters.searchQuery.toLowerCase();
        const matchesName = plugin.name.toLowerCase().includes(query);
        const matchesDesc = plugin.description.toLowerCase().includes(query);
        const matchesTags = plugin.tags.some((t) => t.toLowerCase().includes(query));
        const matchesCategory = plugin.category?.toLowerCase().includes(query);
        if (!matchesName && !matchesDesc && !matchesTags && !matchesCategory) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Get plugin categories from all plugins
   */
  getCategories(plugins: MarketplacePlugin[]): string[] {
    const categories = new Set<string>();
    plugins.forEach((plugin) => {
      if (plugin.category) {
        categories.add(plugin.category);
      }
    });
    return Array.from(categories).sort();
  }

  /**
   * Install a plugin with optional progress callback
   */
  async installPlugin(
    config: InstallConfig,
    onProgress?: ProgressCallback,
  ): Promise<PluginOperationResult> {
    const { pluginName, scope, projectCwd, autoEnable = true } = config;

    try {
      onProgress?.("validating", 10, `Validating plugin: ${pluginName}`);

      onProgress?.("downloading", 30, "Downloading plugin package...");
      const cwd = scope === "project" || scope === "local" ? projectCwd : undefined;

      onProgress?.("installing", 60, "Installing plugin files...");
      const result = await installPlugin(pluginName, scope, cwd);

      if (!result.success) {
        onProgress?.("error", 100, result.message);
        return result;
      }

      onProgress?.("enabling", 90, "Enabling plugin...");

      // Auto-enable if configured
      if (autoEnable) {
        await enablePlugin(pluginName, scope, cwd);
      }

      onProgress?.("complete", 100, "Installation complete");
      dbg("plugin-marketplace", "installPlugin success", { pluginName, scope });

      return result;
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      dbgWarn("plugin-marketplace", "installPlugin error", errorMsg);
      onProgress?.("error", 100, errorMsg);
      return { success: false, message: errorMsg };
    }
  }

  /**
   * Uninstall a plugin
   */
  async uninstallPlugin(
    pluginName: string,
    scope: string,
    projectCwd?: string,
  ): Promise<PluginOperationResult> {
    try {
      const cwd = scope === "project" || scope === "local" ? projectCwd : undefined;
      const result = await uninstallPlugin(pluginName, scope, cwd);
      dbg("plugin-marketplace", "uninstallPlugin", { pluginName, result: result.success });
      return result;
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      dbgWarn("plugin-marketplace", "uninstallPlugin error", errorMsg);
      return { success: false, message: errorMsg };
    }
  }

  /**
   * Toggle plugin enabled state
   */
  async togglePlugin(
    pluginName: string,
    enabled: boolean,
    scope: string,
    projectCwd?: string,
  ): Promise<PluginOperationResult> {
    try {
      const cwd = scope === "project" || scope === "local" ? projectCwd : undefined;
      const result = enabled
        ? await enablePlugin(pluginName, scope, cwd)
        : await disablePlugin(pluginName, scope, cwd);
      dbg("plugin-marketplace", "togglePlugin", { pluginName, enabled, result: result.success });
      return result;
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      dbgWarn("plugin-marketplace", "togglePlugin error", errorMsg);
      return { success: false, message: errorMsg };
    }
  }

  /**
   * Update a plugin to latest version
   */
  async updatePlugin(
    pluginName: string,
    scope: string,
    projectCwd?: string,
  ): Promise<PluginOperationResult> {
    try {
      const cwd = scope === "project" || scope === "local" ? projectCwd : undefined;
      const result = await updatePlugin(pluginName, scope, cwd);
      dbg("plugin-marketplace", "updatePlugin", { pluginName, result: result.success });
      return result;
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      dbgWarn("plugin-marketplace", "updatePlugin error", errorMsg);
      return { success: false, message: errorMsg };
    }
  }

  /**
   * Add a new marketplace source
   */
  async addMarketplace(source: string): Promise<PluginOperationResult> {
    try {
      const result = await addMarketplace(source);
      dbg("plugin-marketplace", "addMarketplace", { source, result: result.success });
      return result;
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      dbgWarn("plugin-marketplace", "addMarketplace error", errorMsg);
      return { success: false, message: errorMsg };
    }
  }

  /**
   * Remove a marketplace
   */
  async removeMarketplace(name: string): Promise<PluginOperationResult> {
    try {
      const result = await removeMarketplace(name);
      dbg("plugin-marketplace", "removeMarketplace", { name, result: result.success });
      return result;
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      dbgWarn("plugin-marketplace", "removeMarketplace error", errorMsg);
      return { success: false, message: errorMsg };
    }
  }

  /**
   * Update all plugins from a marketplace
   */
  async updateMarketplace(name?: string): Promise<PluginOperationResult> {
    try {
      const result = await updateMarketplace(name);
      dbg("plugin-marketplace", "updateMarketplace", { name, result: result.success });
      return result;
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      dbgWarn("plugin-marketplace", "updateMarketplace error", errorMsg);
      return { success: false, message: errorMsg };
    }
  }

  // ── Community Skills Integration ──

  /**
   * Check community skills API health
   */
  async checkCommunityHealth(): Promise<ProviderHealth> {
    try {
      const health = await checkCommunityHealth();
      dbg("plugin-marketplace", "checkCommunityHealth", { available: health.available });
      return health;
    } catch (e) {
      dbgWarn("plugin-marketplace", "checkCommunityHealth error", e);
      return { available: false, reason: String(e) };
    }
  }

  /**
   * Search community skills
   */
  async searchCommunitySkills(query: string, limit = 30): Promise<CommunitySkillResult[]> {
    try {
      const results = await searchCommunitySkills(query, limit);
      dbg("plugin-marketplace", "searchCommunitySkills", { query, count: results.length });
      return results;
    } catch (e) {
      dbgWarn("plugin-marketplace", "searchCommunitySkills error", e);
      return [];
    }
  }

  /**
   * Get detailed information about a community skill
   */
  async getCommunitySkillDetail(
    source: string,
    skillId: string,
  ): Promise<CommunitySkillDetail | null> {
    try {
      const detail = await getCommunitySkillDetail(source, skillId);
      dbg("plugin-marketplace", "getCommunitySkillDetail", { source, skillId });
      return detail;
    } catch (e) {
      dbgWarn("plugin-marketplace", "getCommunitySkillDetail error", e);
      return null;
    }
  }

  /**
   * Install a community skill
   */
  async installCommunitySkill(
    source: string,
    skillId: string,
    scope: "user" | "project",
    projectCwd?: string,
  ): Promise<PluginOperationResult> {
    try {
      const result = await installCommunitySkill(source, skillId, scope, projectCwd);
      dbg("plugin-marketplace", "installCommunitySkill", {
        source,
        skillId,
        scope,
        result: result.success,
      });
      return result;
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      dbgWarn("plugin-marketplace", "installCommunitySkill error", errorMsg);
      return { success: false, message: errorMsg };
    }
  }

  // ── Plugin State Helpers ──

  /**
   * Merge marketplace plugins with installed state
   */
  mergePluginStates(
    marketplacePlugins: MarketplacePlugin[],
    installedPlugins: InstalledPlugin[],
  ): PluginState[] {
    const installedMap = new Map<string, InstalledPlugin>();

    // Index installed plugins by name
    installedPlugins.forEach((ip) => {
      installedMap.set(ip.name, ip);
    });

    // Merge states
    return marketplacePlugins.map((plugin) => {
      const installed = installedMap.get(plugin.name);
      return {
        ...plugin,
        isInstalled: !!installed,
        installedVersion: installed?.version,
        enabled: installed?.enabled,
        installScope: installed?.scope as "user" | "project" | "local" | undefined,
      };
    });
  }

  /**
   * Get install counts grouped by category
   */
  getCategoryStats(plugins: MarketplacePlugin[]): Record<string, number> {
    const stats: Record<string, number> = {};
    plugins.forEach((plugin) => {
      const category = plugin.category || "Other";
      stats[category] = (stats[category] || 0) + 1;
    });
    return stats;
  }

  /**
   * Get popular tags from all plugins
   */
  getPopularTags(plugins: MarketplacePlugin[], limit = 10): string[] {
    const tagCounts: Record<string, number> = {};

    plugins.forEach((plugin) => {
      plugin.tags.forEach((tag) => {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      });
    });

    return Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([tag]) => tag);
  }

  /**
   * Check if a plugin update is available
   */
  hasUpdateAvailable(
    marketplacePlugin: MarketplacePlugin,
    installedPlugin: InstalledPlugin,
  ): boolean {
    if (!marketplacePlugin.version || !installedPlugin.version) {
      return false;
    }

    // Simple version comparison (could be enhanced with semver parsing)
    const mpVersion = marketplacePlugin.version.replace(/[^\d.]/g, "");
    const ipVersion = installedPlugin.version.replace(/[^\d.]/g, "");

    return mpVersion !== ipVersion;
  }
}

export const pluginMarketplaceService = PluginMarketplaceService.getInstance();
