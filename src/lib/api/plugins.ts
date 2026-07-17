// plugins API functions
// Auto-generated from api.ts

import { getTransport } from "../transport";
import { dbg } from "../utils/debug";
import { CMD, type CmdName } from "../tauri-commands";

function invoke<T>(cmd: CmdName | string, args?: Record<string, unknown>): Promise<T> {
  return getTransport().invoke<T>(cmd, args);
}
import type {
  MarketplacePlugin,
  MarketplaceInfo,
  StandaloneSkill,
  InstalledPlugin,
  SkillSummary,
  PluginOperationResult,
  ConfiguredMcpServer,
  McpRegistrySearchResult,
  ProviderHealth,
  AgentDefinitionSummary,
  } from "../types";
import type {
  } from "../runtime-control-plane/types";
import type {
  } from "../types/task";
import type {
  } from "../types/run-journal";
import type {
  } from "../types/attention-queue";



export async function listMarketplaces(): Promise<MarketplaceInfo[]> {
  dbg("api", "listMarketplaces");
  return invoke<MarketplaceInfo[]>(CMD.list_marketplaces);
}

export async function listMarketplacePlugins(): Promise<MarketplacePlugin[]> {
  dbg("api", "listMarketplacePlugins");
  return invoke<MarketplacePlugin[]>(CMD.list_marketplace_plugins);
}

export async function listProjectCommands(cwd?: string): Promise<import("../types").CliCommand[]> {
  dbg("api", "listProjectCommands", { cwd });
  return invoke<import("../types").CliCommand[]>(CMD.list_project_commands, { cwd: cwd ?? null });
}

export async function listStandaloneSkills(cwd?: string): Promise<StandaloneSkill[]> {
  dbg("api", "listStandaloneSkills", { cwd });
  return invoke<StandaloneSkill[]>(CMD.list_standalone_skills, { cwd: cwd ?? null });
}

export async function getSkillSummary(cwd?: string): Promise<SkillSummary> {
  dbg("api", "getSkillSummary", { cwd });
  return invoke<SkillSummary>(CMD.get_skill_summary, { cwd: cwd ?? null });
}

export async function getSkillContent(path: string, cwd?: string): Promise<string> {
  dbg("api", "getSkillContent", path);
  return invoke<string>(CMD.get_skill_content, { path, cwd: cwd ?? "" });
}

export async function createSkill(
  name: string,
  description: string,
  content: string,
  scope: string,
  cwd?: string,
): Promise<StandaloneSkill> {
  dbg("api", "createSkill", { name, scope, cwd });
  return invoke<StandaloneSkill>(CMD.create_skill, {
    name,
    description,
    content,
    scope,
    cwd: cwd ?? null,
  });
}

export async function updateSkill(path: string, content: string, cwd?: string): Promise<void> {
  dbg("api", "updateSkill", { path, cwd });
  return invoke<void>(CMD.update_skill, { path, content, cwd: cwd ?? null });
}

export async function deleteSkill(path: string, cwd?: string): Promise<void> {
  dbg("api", "deleteSkill", { path, cwd });
  return invoke<void>(CMD.delete_skill, { path, cwd: cwd ?? null });
}

export async function listInstalledPlugins(): Promise<InstalledPlugin[]> {
  dbg("api", "listInstalledPlugins");
  return invoke<InstalledPlugin[]>(CMD.list_installed_plugins);
}

export async function installPlugin(
  name: string,
  scope: string,
  cwd?: string,
): Promise<PluginOperationResult> {
  dbg("api", "installPlugin", { name, scope, cwd });
  return invoke<PluginOperationResult>(CMD.install_plugin, { name, scope, cwd });
}

export async function uninstallPlugin(
  name: string,
  scope: string,
  cwd?: string,
): Promise<PluginOperationResult> {
  dbg("api", "uninstallPlugin", { name, scope, cwd });
  return invoke<PluginOperationResult>(CMD.uninstall_plugin, { name, scope, cwd });
}

export async function enablePlugin(
  name: string,
  scope: string,
  cwd?: string,
): Promise<PluginOperationResult> {
  dbg("api", "enablePlugin", { name, scope, cwd });
  return invoke<PluginOperationResult>(CMD.enable_plugin, { name, scope, cwd });
}

export async function disablePlugin(
  name: string,
  scope: string,
  cwd?: string,
): Promise<PluginOperationResult> {
  dbg("api", "disablePlugin", { name, scope, cwd });
  return invoke<PluginOperationResult>(CMD.disable_plugin, { name, scope, cwd });
}

export async function updatePlugin(
  name: string,
  scope: string,
  cwd?: string,
): Promise<PluginOperationResult> {
  dbg("api", "updatePlugin", { name, scope, cwd });
  return invoke<PluginOperationResult>(CMD.update_plugin, { name, scope, cwd });
}

export async function addMarketplace(source: string): Promise<PluginOperationResult> {
  dbg("api", "addMarketplace", { source });
  return invoke<PluginOperationResult>(CMD.add_marketplace, { source });
}

export async function removeMarketplace(name: string): Promise<PluginOperationResult> {
  dbg("api", "removeMarketplace", { name });
  return invoke<PluginOperationResult>(CMD.remove_marketplace, { name });
}

export async function updateMarketplace(name?: string): Promise<PluginOperationResult> {
  dbg("api", "updateMarketplace", { name });
  return invoke<PluginOperationResult>(CMD.update_marketplace, { name: name ?? null });
}

export async function checkCommunityHealth(): Promise<import("../types").ProviderHealth> {
  dbg("api", "checkCommunityHealth");
  return invoke<import("../types").ProviderHealth>(CMD.check_community_health);
}

export async function searchCommunitySkills(
  query: string,
  limit?: number,
): Promise<import("../types").CommunitySkillResult[]> {
  dbg("api", "searchCommunitySkills", { query, limit });
  return invoke<import("../types").CommunitySkillResult[]>(CMD.search_community_skills, {
    query,
    limit: limit ?? null,
  });
}

export async function getCommunitySkillDetail(
  source: string,
  skillId: string,
): Promise<import("../types").CommunitySkillDetail> {
  dbg("api", "getCommunitySkillDetail", { source, skillId });
  return invoke<import("../types").CommunitySkillDetail>(CMD.get_community_skill_detail, {
    source,
    skillId,
  });
}

export async function installCommunitySkill(
  source: string,
  skillId: string,
  scope: string,
  cwd?: string,
): Promise<PluginOperationResult> {
  dbg("api", "installCommunitySkill", { source, skillId, scope });
  return invoke<PluginOperationResult>(CMD.install_community_skill, {
    source,
    skillId,
    scope,
    cwd: cwd ?? null,
  });
}

export async function listConfiguredMcpServers(cwd?: string): Promise<ConfiguredMcpServer[]> {
  dbg("api", "listConfiguredMcpServers", { cwd });
  return invoke<ConfiguredMcpServer[]>(CMD.list_configured_mcp_servers, { cwd: cwd ?? null });
}

export async function addMcpServer(
  name: string,
  transport: string,
  scope: string,
  cwd?: string,
  configJson?: string,
  url?: string,
  envVars?: Record<string, string>,
  headers?: Record<string, string>,
): Promise<PluginOperationResult> {
  dbg("api", "addMcpServer", { name, transport, scope });
  return invoke<PluginOperationResult>(CMD.add_mcp_server, {
    name,
    transport,
    scope,
    cwd: cwd ?? null,
    configJson: configJson ?? null,
    url: url ?? null,
    envVars: envVars ?? null,
    headers: headers ?? null,
  });
}

export async function removeMcpServer(
  name: string,
  scope: string,
  cwd?: string,
): Promise<PluginOperationResult> {
  dbg("api", "removeMcpServer", { name, scope, cwd });
  return invoke<PluginOperationResult>(CMD.remove_mcp_server, {
    name,
    scope,
    cwd: cwd ?? null,
  });
}

export async function checkMcpRegistryHealth(): Promise<ProviderHealth> {
  dbg("api", "checkMcpRegistryHealth");
  return invoke<ProviderHealth>(CMD.check_mcp_registry_health);
}

export async function searchMcpRegistry(
  query: string,
  limit?: number,
  cursor?: string,
): Promise<McpRegistrySearchResult> {
  dbg("api", "searchMcpRegistry", { query, limit, cursor });
  return invoke<McpRegistrySearchResult>(CMD.search_mcp_registry, {
    query,
    limit: limit ?? null,
    cursor: cursor ?? null,
  });
}

export async function listAgents(cwd?: string): Promise<AgentDefinitionSummary[]> {
  dbg("api", "listAgents", { cwd });
  return invoke<AgentDefinitionSummary[]>(CMD.list_agents, { cwd: cwd ?? null });
}

export async function readAgentFile(
  scope: "user" | "project",
  fileName: string,
  cwd?: string,
): Promise<string> {
  dbg("api", "readAgentFile", { scope, fileName });
  return invoke<string>(CMD.read_agent_file, {
    scope,
    fileName,
    cwd: cwd ?? null,
  });
}

export async function createAgentFile(
  scope: "user" | "project",
  fileName: string,
  content: string,
  cwd?: string,
): Promise<void> {
  dbg("api", "createAgentFile", { scope, fileName });
  return invoke<void>(CMD.create_agent_file, {
    scope,
    fileName,
    content,
    cwd: cwd ?? null,
  });
}

export async function updateAgentFile(
  scope: "user" | "project",
  fileName: string,
  content: string,
  cwd?: string,
): Promise<void> {
  dbg("api", "updateAgentFile", { scope, fileName });
  return invoke<void>(CMD.update_agent_file, {
    scope,
    fileName,
    content,
    cwd: cwd ?? null,
  });
}

export async function deleteAgentFile(
  scope: "user" | "project",
  fileName: string,
  cwd?: string,
): Promise<void> {
  dbg("api", "deleteAgentFile", { scope, fileName });
  return invoke<void>(CMD.delete_agent_file, {
    scope,
    fileName,
    cwd: cwd ?? null,
  });
}

