// ── Plugin types ──

export interface PluginAuthor {
  name: string;
  email?: string;
}

export interface PluginComponents {
  skills: string[];
  commands: string[];
  agents: string[];
  hooks: boolean;
  mcp_servers: string[];
  lsp_servers: string[];
}

export interface MarketplacePlugin {
  name: string;
  description: string;
  version?: string;
  author?: PluginAuthor;
  category?: string;
  homepage?: string;
  source?: unknown;
  tags: string[];
  strict?: boolean;
  lsp_servers?: unknown;
  marketplace_name?: string;
  install_count?: number;
  components: PluginComponents;
}

export interface MarketplaceInfo {
  name: string;
  source: unknown;
  install_location: string;
  last_updated?: string;
  plugin_count: number;
}

export interface StandaloneSkill {
  name: string;
  description: string;
  path: string;
  scope?: string;
}

export interface InstalledPlugin {
  name: string;
  description: string;
  version?: string;
  scope?: string;
  enabled?: boolean;
  marketplace?: string;
  pluginId?: string;
  /** Project directory this plugin was installed in (project/local scope only). */
  projectPath?: string;
  [key: string]: unknown;
}

export interface PluginOperationResult {
  success: boolean;
  message: string;
}

export interface CommunitySkillResult {
  id: string;
  name: string;
  skill_id: string;
  installs: number;
  source: string;
}

export interface CommunitySkillDetail {
  id: string;
  name: string;
  description: string;
  installs: number;
  source: string;
  content: string | null;
  raw_url: string | null;
  skills_sh_url: string | null;
  github_url: string | null;
}

export interface ProviderHealth {
  available: boolean;
  reason: string | null;
}

// ── Auto-context tracking ──

export interface ContextSnapshot {
  runId: string;
  turnIndex: number;
  ts: string;
  data: import("$lib/utils/context-parser").ContextData;
}

// ── MCP Registry types ──

export interface McpRegistrySearchResult {
  servers: McpRegistryServer[];
  nextCursor: string | null;
  count: number;
}

export interface McpRegistryServer {
  name: string;
  description: string;
  title?: string;
  version: string;
  packages: McpRegistryPackage[];
  remotes: McpRegistryRemote[];
  repository?: McpRegistryRepository;
}

export interface McpRegistryPackage {
  registryType: string;
  identifier: string;
  version?: string;
  environmentVariables: McpRegistryEnvVar[];
}

export interface McpRegistryRemote {
  type: string;
  url: string;
  headers: McpRegistryHeader[];
}

export interface McpRegistryEnvVar {
  name: string;
  description?: string;
  isRequired?: boolean;
  isSecret?: boolean;
}

export interface McpRegistryHeader {
  name: string;
  description?: string;
  value?: string;
  isRequired?: boolean;
  isSecret?: boolean;
}

export interface McpRegistryRepository {
  url?: string;
  source?: string;
}

export interface ConfiguredMcpServer {
  name: string;
  server_type: string;
  scope: string;
  command?: string;
  args: string[];
  url?: string;
  env_keys: string[];
  header_keys: string[];
}
