/**
 * Plugin Store - Svelte 5 state management for plugin marketplace
 *
 * Manages plugin states, marketplace data, and operations.
 */
import {
  pluginMarketplaceService,
  type PluginFilters,
  type PluginState,
  type InstallConfig,
  type McpConnector,
  type ProgressCallback,
} from "$lib/services/plugin-marketplace";
import type {
  MarketplacePlugin,
  InstalledPlugin,
  MarketplaceInfo,
  CommunitySkillResult,
  CommunitySkillDetail,
  ProviderHealth,
} from "$lib/types";

// ── Plugin Section Types ──

export type PluginSection = "skills" | "mcp" | "hooks" | "plugins" | "agents";
export type PluginSource = "discover" | "installed" | "marketplace";
export type InstallScope = "user" | "project" | "local";

// ── Plugin State Interface ──

export interface PluginStoreState {
  // Data
  marketplacePlugins: MarketplacePlugin[];
  installedPlugins: InstalledPlugin[];
  marketplaces: MarketplaceInfo[];

  // Community skills
  communityResults: CommunitySkillResult[];
  communityPopular: CommunitySkillResult[];
  communityDetail: CommunitySkillDetail | null;
  communityHealth: ProviderHealth | null;

  // UI state
  loading: boolean;
  loadError: boolean;
  loadWarnings: string[];
  operationLoading: string | null;

  // Filters
  searchQuery: string;
  selectedCategory: string | null;
  installScope: InstallScope;

  // Community search
  communityQuery: string;
  communitySearching: boolean;
  communityDetailLoading: boolean;

  // MCP state
  mcpConnectors: McpConnector[];

  // Toast
  toastMessage: string | null;
  toastType: "success" | "error";

  // Registry
  registriesOpen: boolean;
}

// ── Store Implementation ──

function createPluginStore() {
  const state = $state<PluginStoreState>({
    // Data
    marketplacePlugins: [],
    installedPlugins: [],
    marketplaces: [],

    // Community skills
    communityResults: [],
    communityPopular: [],
    communityDetail: null,
    communityHealth: null,

    // UI state
    loading: true,
    loadError: false,
    loadWarnings: [],
    operationLoading: null,

    // Filters
    searchQuery: "",
    selectedCategory: null,
    installScope: "user",

    // Community search
    communityQuery: "",
    communitySearching: false,
    communityDetailLoading: false,

    // MCP state
    mcpConnectors: [],

    // Toast
    toastMessage: null,
    toastType: "success",

    // Registry
    registriesOpen: false,
  });

  // ── Toast Helpers ──

  let toastTimeout: ReturnType<typeof setTimeout> | null = null;

  function showToast(message: string, type: "success" | "error" = "success") {
    state.toastMessage = message;
    state.toastType = type;
    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      state.toastMessage = null;
    }, 4000);
  }

  // ── Data Loading ──

  async function loadAll(): Promise<void> {
    state.loading = true;
    const warnings: string[] = [];

    try {
      const results = await Promise.allSettled([
        pluginMarketplaceService.fetchMarketplacePlugins(),
        pluginMarketplaceService.fetchInstalledPlugins(),
        pluginMarketplaceService.fetchMarketplaces(),
      ]);

      if (results[0].status === "fulfilled") {
        state.marketplacePlugins = results[0].value;
      } else {
        warnings.push("marketplace plugins");
      }

      if (results[1].status === "fulfilled") {
        state.installedPlugins = results[1].value;
      } else {
        warnings.push("installed plugins");
      }

      if (results[2].status === "fulfilled") {
        state.marketplaces = results[2].value;
      } else {
        warnings.push("marketplaces");
      }

      state.loadWarnings = warnings;
      state.loadError = warnings.length === 3;
    } catch {
      state.loadError = true;
    } finally {
      state.loading = false;
    }
  }

  async function refreshPluginData(): Promise<void> {
    const results = await Promise.allSettled([
      pluginMarketplaceService.fetchMarketplacePlugins(),
      pluginMarketplaceService.fetchInstalledPlugins(),
    ]);

    if (results[0].status === "fulfilled") {
      state.marketplacePlugins = results[0].value;
    }
    if (results[1].status === "fulfilled") {
      state.installedPlugins = results[1].value;
    }
  }

  // ── Community Skills ──

  async function loadCommunityHealth(): Promise<void> {
    try {
      state.communityHealth = await pluginMarketplaceService.checkCommunityHealth();
    } catch (e) {
      state.communityHealth = { available: false, reason: String(e) };
    }
  }

  async function loadCommunityPopular(): Promise<void> {
    try {
      state.communityPopular = await pluginMarketplaceService.searchCommunitySkills("skill", 20);
    } catch {
      // Silently fail for popular list
    }
  }

  async function searchCommunity(query: string): Promise<void> {
    state.communityQuery = query;
    state.communitySearching = true;

    try {
      if (query.trim().length >= 2) {
        state.communityResults = await pluginMarketplaceService.searchCommunitySkills(query, 30);
      } else {
        state.communityResults = [];
      }
    } catch (e) {
      showToast(`Search failed: ${e}`, "error");
    } finally {
      state.communitySearching = false;
    }
  }

  async function loadCommunityDetail(skill: CommunitySkillResult): Promise<void> {
    state.communityDetailLoading = true;
    state.communityDetail = null;

    try {
      state.communityDetail = await pluginMarketplaceService.getCommunitySkillDetail(
        skill.source,
        skill.skill_id,
      );
    } catch {
      // Silently fail
    } finally {
      state.communityDetailLoading = false;
    }
  }

  // ── Plugin Operations ──

  async function installPlugin(
    pluginName: string,
    onProgress?: ProgressCallback,
  ): Promise<boolean> {
    state.operationLoading = pluginName;

    try {
      const config: InstallConfig = {
        pluginName,
        scope: state.installScope,
        autoEnable: true,
      };

      const result = await pluginMarketplaceService.installPlugin(config, onProgress);

      if (result.success) {
        showToast(`Installed ${pluginName}`, "success");
        await refreshPluginData();
        return true;
      } else {
        showToast(result.message, "error");
        return false;
      }
    } catch (e) {
      showToast(`Installation failed: ${e}`, "error");
      return false;
    } finally {
      state.operationLoading = null;
    }
  }

  async function uninstallPlugin(plugin: InstalledPlugin, projectCwd?: string): Promise<boolean> {
    state.operationLoading = plugin.name;

    try {
      const scope = plugin.scope || "user";
      const result = await pluginMarketplaceService.uninstallPlugin(plugin.name, scope, projectCwd);

      if (result.success) {
        showToast(`Uninstalled ${plugin.name}`, "success");
        await refreshPluginData();
        return true;
      } else {
        showToast(result.message, "error");
        return false;
      }
    } catch (e) {
      showToast(`Uninstall failed: ${e}`, "error");
      return false;
    } finally {
      state.operationLoading = null;
    }
  }

  async function togglePlugin(
    plugin: InstalledPlugin,
    enabled: boolean,
    projectCwd?: string,
  ): Promise<boolean> {
    state.operationLoading = plugin.name;

    try {
      const scope = plugin.scope || "user";
      const result = await pluginMarketplaceService.togglePlugin(
        plugin.name,
        enabled,
        scope,
        projectCwd,
      );

      if (result.success) {
        showToast(enabled ? `Enabled ${plugin.name}` : `Disabled ${plugin.name}`, "success");
        await refreshPluginData();
        return true;
      } else {
        showToast(result.message, "error");
        return false;
      }
    } catch (e) {
      showToast(`Operation failed: ${e}`, "error");
      return false;
    } finally {
      state.operationLoading = null;
    }
  }

  async function updatePlugin(plugin: InstalledPlugin, projectCwd?: string): Promise<boolean> {
    state.operationLoading = plugin.name;

    try {
      const scope = plugin.scope || "user";
      const result = await pluginMarketplaceService.updatePlugin(plugin.name, scope, projectCwd);

      if (result.success) {
        showToast(`Updated ${plugin.name}`, "success");
        await refreshPluginData();
        return true;
      } else {
        showToast(result.message, "error");
        return false;
      }
    } catch (e) {
      showToast(`Update failed: ${e}`, "error");
      return false;
    } finally {
      state.operationLoading = null;
    }
  }

  async function installCommunitySkill(
    skill: CommunitySkillResult,
    scope: "user" | "project",
    projectCwd?: string,
  ): Promise<boolean> {
    state.operationLoading = skill.id;

    try {
      const result = await pluginMarketplaceService.installCommunitySkill(
        skill.source,
        skill.skill_id,
        scope,
        projectCwd,
      );

      if (result.success) {
        showToast(`Installed ${skill.name}`, "success");
        await refreshPluginData();
        return true;
      } else {
        showToast(result.message, "error");
        return false;
      }
    } catch (e) {
      showToast(`Installation failed: ${e}`, "error");
      return false;
    } finally {
      state.operationLoading = null;
    }
  }

  // ── Marketplace Operations ──

  async function addMarketplace(source: string): Promise<boolean> {
    state.operationLoading = "__marketplace_add";

    try {
      const result = await pluginMarketplaceService.addMarketplace(source);

      if (result.success) {
        showToast("Marketplace added", "success");
        const [plugins, marketplaces] = await Promise.all([
          pluginMarketplaceService.fetchMarketplacePlugins(),
          pluginMarketplaceService.fetchMarketplaces(),
        ]);
        state.marketplacePlugins = plugins;
        state.marketplaces = marketplaces;
        return true;
      } else {
        showToast(result.message, "error");
        return false;
      }
    } catch (e) {
      showToast(`Failed to add marketplace: ${e}`, "error");
      return false;
    } finally {
      state.operationLoading = null;
    }
  }

  async function removeMarketplace(name: string): Promise<boolean> {
    state.operationLoading = `__mp_${name}`;

    try {
      const result = await pluginMarketplaceService.removeMarketplace(name);

      if (result.success) {
        showToast(`Removed ${name}`, "success");
        const [plugins, marketplaces] = await Promise.all([
          pluginMarketplaceService.fetchMarketplacePlugins(),
          pluginMarketplaceService.fetchMarketplaces(),
        ]);
        state.marketplacePlugins = plugins;
        state.marketplaces = marketplaces;
        return true;
      } else {
        showToast(result.message, "error");
        return false;
      }
    } catch (e) {
      showToast(`Failed to remove marketplace: ${e}`, "error");
      return false;
    } finally {
      state.operationLoading = null;
    }
  }

  async function updateMarketplace(name?: string): Promise<boolean> {
    state.operationLoading = name ? `__mp_${name}` : "__mp_update";

    try {
      const result = await pluginMarketplaceService.updateMarketplace(name);

      if (result.success) {
        showToast("Marketplace updated", "success");
        const [plugins, marketplaces] = await Promise.all([
          pluginMarketplaceService.fetchMarketplacePlugins(),
          pluginMarketplaceService.fetchMarketplaces(),
        ]);
        state.marketplacePlugins = plugins;
        state.marketplaces = marketplaces;
        return true;
      } else {
        showToast(result.message, "error");
        return false;
      }
    } catch (e) {
      showToast(`Failed to update marketplace: ${e}`, "error");
      return false;
    } finally {
      state.operationLoading = null;
    }
  }

  // ── Filter Helpers ──

  function getFilteredPlugins(): MarketplacePlugin[] {
    const filters: PluginFilters = {
      category: state.selectedCategory || undefined,
      searchQuery: state.searchQuery || undefined,
    };
    return pluginMarketplaceService.filterPlugins(state.marketplacePlugins, filters);
  }

  function getCategories(): string[] {
    return pluginMarketplaceService.getCategories(state.marketplacePlugins);
  }

  function getMergedPluginStates(): PluginState[] {
    return pluginMarketplaceService.mergePluginStates(
      state.marketplacePlugins,
      state.installedPlugins,
    );
  }

  function isPluginInstalled(pluginName: string): boolean {
    return state.installedPlugins.some((p) => p.name === pluginName);
  }

  function getInstalledPlugin(pluginName: string): InstalledPlugin | undefined {
    return state.installedPlugins.find((p) => p.name === pluginName);
  }

  // ── Community Display Helpers ──

  function getCommunityDisplayResults(): CommunitySkillResult[] {
    return state.communityQuery.trim().length >= 2
      ? state.communityResults
      : state.communityPopular;
  }

  function isSkillInstalled(_skillId: string, _scope: InstallScope): boolean {
    // Check against installed skills (would need to track installed skill IDs)
    return false; // Placeholder - would need integration with skills store
  }

  // ── MCP Connector Helpers ──

  function addMcpConnector(connector: McpConnector): void {
    state.mcpConnectors = [...state.mcpConnectors, connector];
  }

  function removeMcpConnector(name: string): void {
    state.mcpConnectors = state.mcpConnectors.filter((c) => c.name !== name);
  }

  function updateMcpConnector(name: string, updates: Partial<McpConnector>): void {
    state.mcpConnectors = state.mcpConnectors.map((c) =>
      c.name === name ? { ...c, ...updates } : c,
    );
  }

  // ── Scope Helpers ──

  function needsCwd(scope: string): boolean {
    return scope === "project" || scope === "local";
  }

  function resolvePluginCwd(plugin: InstalledPlugin, projectCwd: string): string | undefined {
    const scope = plugin.scope || "user";
    if (!needsCwd(scope)) return undefined;
    return plugin.projectPath || projectCwd || undefined;
  }

  return {
    // State getters
    get state() {
      return state;
    },

    // Data loading
    loadAll,
    refreshPluginData,

    // Community skills
    loadCommunityHealth,
    loadCommunityPopular,
    searchCommunity,
    loadCommunityDetail,

    // Plugin operations
    installPlugin,
    uninstallPlugin,
    togglePlugin,
    updatePlugin,
    installCommunitySkill,

    // Marketplace operations
    addMarketplace,
    removeMarketplace,
    updateMarketplace,

    // Filter helpers
    getFilteredPlugins,
    getCategories,
    getMergedPluginStates,
    isPluginInstalled,
    getInstalledPlugin,

    // Community display helpers
    getCommunityDisplayResults,
    isSkillInstalled,

    // MCP helpers
    addMcpConnector,
    removeMcpConnector,
    updateMcpConnector,

    // Scope helpers
    needsCwd,
    resolvePluginCwd,

    // Toast
    showToast,
  };
}

export const pluginStore = createPluginStore();
