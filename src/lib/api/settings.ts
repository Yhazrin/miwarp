// settings API functions
// Auto-generated from api.ts

import { getTransport } from "../transport";
import { dbg, dbgWarn, redactSensitive } from "../utils/debug";
import { CMD, type CmdName } from "../tauri-commands";

function invoke<T>(cmd: CmdName | string, args?: Record<string, unknown>): Promise<T> {
  return getTransport().invoke<T>(cmd, args);
}
import type {
  UserSettings,
  AgentSettings,
  CliCheckResult,
  ProjectInitStatus,
  CliDistTags,
  UsageOverview,
  CliInfo,
  ChangelogEntry,
  SshKeyInfo,
  DiagnosticsReport,
  BackendCapabilities,
  ProjectMetadata,
  ProjectGitStatus,
  ProjectNotes,
} from "../types";
import type {} from "../runtime-control-plane/types";
import type {} from "../types/task";
import type {} from "../types/run-journal";
import type {} from "../types/attention-queue";

export async function getBackendCapabilities(): Promise<BackendCapabilities> {
  return invoke<BackendCapabilities>(CMD.get_backend_capabilities);
}

export async function getUserSettings(): Promise<UserSettings> {
  dbg("api", "getUserSettings");
  return invoke<UserSettings>(CMD.get_user_settings);
}

export function notifyUserSettingsChanged(settings: UserSettings): void {
  if (typeof window === "undefined") return;
  void import("$lib/chat/chat-bootstrap-cache").then(({ refreshChatBootstrapSettings }) => {
    refreshChatBootstrapSettings(settings);
  });
  window.dispatchEvent(new CustomEvent(USER_SETTINGS_CHANGED_EVENT, { detail: settings }));
}

export async function updateUserSettings(patch: Partial<UserSettings>): Promise<UserSettings> {
  dbg("api", "updateUserSettings");
  const settings = await invoke<UserSettings>(CMD.update_user_settings, { patch });
  notifyUserSettingsChanged(settings);
  return settings;
}

export async function resetUserSettings(): Promise<UserSettings> {
  dbg("api", "resetUserSettings");
  const settings = await invoke<UserSettings>(CMD.reset_user_settings);
  notifyUserSettingsChanged(settings);
  return settings;
}

export async function resetPersonalProfile(): Promise<UserSettings> {
  dbg("api", "resetPersonalProfile");
  const settings = await invoke<UserSettings>(CMD.reset_personal_profile);
  notifyUserSettingsChanged(settings);
  return settings;
}

export async function getAgentSettings(agent: string): Promise<AgentSettings> {
  dbg("api", "getAgentSettings", agent);
  return invoke<AgentSettings>(CMD.get_agent_settings, { agent });
}

export async function updateAgentSettings(
  agent: string,
  patch: Partial<AgentSettings>,
): Promise<AgentSettings> {
  dbg("api", "updateAgentSettings", agent);
  const result = await invoke<AgentSettings>(CMD.update_agent_settings, { agent, patch });
  // Sync sidebar resume-gate cache with updated settings
  import("$lib/stores/agent-settings-cache.svelte").then((m) => m.refreshAgentSettingsCache(agent));
  return result;
}

export async function detectMimoRuntime(): Promise<{
  available: boolean;
  binary: string;
  version: string | null;
}> {
  dbg("api", "detectMimoRuntime");
  const [available, binary, version] = await invoke<[boolean, string, string | null]>(
    CMD.detect_mimo_runtime,
  );
  return { available, binary, version };
}

export async function sendFeishuNotification(
  title: string,
  body: string,
  status?: string,
  link?: string,
): Promise<void> {
  dbg("api", "sendFeishuNotification", { title, status });
  return invoke<void>(CMD.send_feishu_notification, { title, body, status, link });
}

export async function getUsageOverview(
  days?: number,
  projectId?: string | null,
  tz?: string | null,
): Promise<UsageOverview> {
  dbg("api", "getUsageOverview", { days, projectId, tz });
  return invoke<UsageOverview>(CMD.get_usage_overview, {
    days: days ?? null,
    projectId: projectId ?? null,
    tz: tz ?? null,
  });
}

export async function getGlobalUsageOverview(days?: number): Promise<UsageOverview> {
  dbg("api", "getGlobalUsageOverview", { days });
  return invoke<UsageOverview>(CMD.get_global_usage_overview, { days: days ?? null });
}

export async function clearUsageCache(): Promise<void> {
  dbg("api", "clearUsageCache");
  return invoke<void>(CMD.clear_usage_cache);
}

export async function getHeatmapDaily(
  scope: "app" | "global",
): Promise<import("../types").DailyAggregate[]> {
  dbg("api", "getHeatmapDaily", { scope });
  return invoke<import("../types").DailyAggregate[]>(CMD.get_heatmap_daily, { scope });
}

export async function checkAgentCli(agent: string): Promise<CliCheckResult> {
  dbg("api", "checkAgentCli", agent);
  return invoke<CliCheckResult>(CMD.check_agent_cli, { agent });
}

export async function checkProjectInit(cwd: string): Promise<ProjectInitStatus> {
  dbg("api", "checkProjectInit", cwd);
  return invoke<ProjectInitStatus>(CMD.check_project_init, { cwd });
}

export async function listProjectMetadata(cwd: string): Promise<ProjectMetadata> {
  dbg("api", "listProjectMetadata", cwd);
  return invoke<ProjectMetadata>(CMD.list_project_metadata, { cwd });
}

export async function listProjectGitStatus(cwd: string): Promise<ProjectGitStatus> {
  dbg("api", "listProjectGitStatus", cwd);
  return invoke<ProjectGitStatus>(CMD.list_project_git_status, { cwd });
}

export async function readProjectNotes(cwd: string): Promise<ProjectNotes> {
  dbg("api", "readProjectNotes", cwd);
  return invoke<ProjectNotes>(CMD.read_project_notes, { cwd });
}

export async function writeProjectNotes(cwd: string, content: string): Promise<void> {
  dbg("api", "writeProjectNotes", { cwd, contentLen: content.length });
  return invoke<void>(CMD.write_project_notes, { cwd, content });
}

export async function getCliDistTags(): Promise<CliDistTags> {
  dbg("api", "getCliDistTags");
  return invoke<CliDistTags>(CMD.get_cli_dist_tags);
}

export interface UpdateCliResult {
  success: boolean;
  stdout: string;
  stderr: string;
}

export async function updateClaudeCli(): Promise<UpdateCliResult> {
  dbg("api", "updateClaudeCli");
  return invoke<UpdateCliResult>(CMD.update_claude_cli);
}

export async function updateCodexCli(): Promise<UpdateCliResult> {
  dbg("api", "updateCodexCli");
  return invoke<UpdateCliResult>(CMD.update_codex_cli);
}

export async function updateMimoCli(): Promise<UpdateCliResult> {
  dbg("api", "updateMimoCli");
  return invoke<UpdateCliResult>(CMD.update_mimo_cli);
}

export async function updateCcswitch(): Promise<UpdateCliResult> {
  dbg("api", "updateCcswitch");
  return invoke<UpdateCliResult>(CMD.update_ccswitch);
}

export async function runCliUpdate(toolId: string): Promise<UpdateCliResult> {
  dbg("api", "runCliUpdate", toolId);
  return invoke<UpdateCliResult>(CMD.run_cli_update, { toolId });
}

export async function checkCliBinary(name: string): Promise<CliCheckResult> {
  dbg("api", "checkCliBinary", name);
  return invoke<CliCheckResult>(CMD.check_cli_binary, { name });
}

export interface DetectCliToolResult {
  tool_id: string;
  found: boolean;
  version: string | null;
  install_method: string; // "npm" | "brew_cask" | "dmg" | "deb" | "rpm" | "appimage" | "msi" | "unknown"
  install_path: string | null;
}

export async function detectCliTool(toolId: string): Promise<DetectCliToolResult> {
  dbg("api", "detectCliTool", toolId);
  return invoke<DetectCliToolResult>(CMD.detect_cli_tool, { toolId });
}

export async function checkSshKey(): Promise<SshKeyInfo> {
  dbg("api", "checkSshKey");
  return invoke<SshKeyInfo>(CMD.check_ssh_key);
}

export async function generateSshKey(): Promise<SshKeyInfo> {
  dbg("api", "generateSshKey");
  return invoke<SshKeyInfo>(CMD.generate_ssh_key);
}

export async function detectLocalProxy(
  proxyId: string,
  baseUrl: string,
): Promise<import("../types").LocalProxyStatus> {
  dbg("api", "detectLocalProxy", { proxyId, baseUrl });
  return invoke<import("../types").LocalProxyStatus>(CMD.detect_local_proxy, { proxyId, baseUrl });
}

export async function testApiConnectivity(
  apiKey: string,
  baseUrl: string,
  authEnvVar: string,
  model: string,
): Promise<import("../types").ApiTestResult> {
  dbg("api", "testApiConnectivity", { baseUrl, authEnvVar, model });
  return invoke<import("../types").ApiTestResult>(CMD.test_api_connectivity, {
    apiKey,
    baseUrl,
    authEnvVar,
    model,
  });
}

export async function runDiagnostics(cwd: string): Promise<DiagnosticsReport> {
  dbg("api", "runDiagnostics", { cwd });
  return invoke<DiagnosticsReport>(CMD.run_diagnostics, { cwd });
}

export async function getDataDirectory(): Promise<string> {
  return invoke<string>(CMD.get_data_directory, {});
}

export async function getCliInfo(forceRefresh?: boolean, agent?: string): Promise<CliInfo> {
  dbg("api", "getCliInfo", { forceRefresh, agent });
  try {
    const info = await invoke<CliInfo>(CMD.get_cli_info, { forceRefresh, agent });
    dbg("api", "getCliInfo →", { agent: info.agent, models: info.models.length });
    return info;
  } catch (e) {
    dbgWarn("api", "getCliInfo error", e);
    throw e;
  }
}

export interface CliPermissions {
  user: { allow: string[]; deny: string[] };
  project: { allow: string[]; deny: string[] };
  projectError?: string | null;
}

export async function getCliPermissions(cwd?: string): Promise<CliPermissions> {
  dbg("api", "getCliPermissions", { cwd });
  return invoke<CliPermissions>(CMD.get_cli_permissions, { cwd: cwd ?? null });
}

export async function updateCliPermissions(
  scope: "user" | "project",
  category: "allow" | "deny",
  rules: string[],
  cwd?: string,
): Promise<void> {
  dbg("api", "updateCliPermissions", { scope, category, count: rules.length });
  return invoke<void>(CMD.update_cli_permissions, {
    scope,
    category,
    rules,
    cwd: cwd ?? null,
  });
}

export async function getCliConfig(): Promise<Record<string, unknown>> {
  dbg("api", "getCliConfig");
  return invoke<Record<string, unknown>>("get_cli_config");
}

export async function getProjectCliConfig(cwd: string): Promise<Record<string, unknown>> {
  dbg("api", "getProjectCliConfig", { cwd });
  return invoke<Record<string, unknown>>("get_project_cli_config", { cwd });
}

export async function updateCliConfig(
  patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  dbg("api", "updateCliConfig", { patch: redactSensitive(patch) });
  return invoke<Record<string, unknown>>("update_cli_config", { patch });
}

export async function checkForUpdates(): Promise<import("../types").UpdateInfo> {
  dbg("api", "checkForUpdates");
  return invoke<import("../types").UpdateInfo>(CMD.check_for_updates);
}

export async function getChangelog(): Promise<ChangelogEntry[]> {
  dbg("api", "getChangelog");
  return invoke<ChangelogEntry[]>(CMD.get_changelog);
}

export type ReadmeOrigin = "remote" | "remote-cache" | "local-fallback";

export interface ReadmeSource {
  content: string;
  origin: ReadmeOrigin;
}

export async function readAppReadme(locale?: string): Promise<ReadmeSource> {
  dbg("api", "readAppReadme", { locale });
  return invoke<ReadmeSource>(CMD.read_app_readme, { locale: locale ?? null });
}

export async function refreshAppReadme(locale?: string): Promise<ReadmeSource> {
  dbg("api", "refreshAppReadme", { locale });
  return invoke<ReadmeSource>(CMD.refresh_app_readme, { locale: locale ?? null });
}

export async function checkAuthStatus(): Promise<import("../types").AuthCheckResult> {
  dbg("api", "checkAuthStatus");
  return invoke<import("../types").AuthCheckResult>(CMD.check_auth_status);
}

export async function detectInstallMethods(): Promise<import("../types").InstallMethod[]> {
  dbg("api", "detectInstallMethods");
  return invoke<import("../types").InstallMethod[]>(CMD.detect_install_methods);
}

export async function runClaudeLogin(): Promise<boolean> {
  dbg("api", "runClaudeLogin");
  return invoke<boolean>(CMD.run_claude_login);
}

export async function getAuthOverview(): Promise<import("../types").AuthOverview> {
  dbg("api", "getAuthOverview");
  return invoke<import("../types").AuthOverview>(CMD.get_auth_overview);
}

export async function setCliApiKey(key: string): Promise<void> {
  dbg("api", "setCliApiKey");
  return invoke<void>(CMD.set_cli_api_key, { key });
}

export async function removeCliApiKey(): Promise<void> {
  dbg("api", "removeCliApiKey");
  return invoke<void>(CMD.remove_cli_api_key);
}

export async function getProductBootstrapStatus(): Promise<
  import("../types").ProductBootstrapStatus
> {
  dbg("api", "getProductBootstrapStatus");
  return invoke<import("../types").ProductBootstrapStatus>(CMD.get_product_bootstrap_status);
}

export async function runProductBootstrap(
  force = false,
): Promise<import("../types").ProductBootstrapRunResult> {
  dbg("api", "runProductBootstrap", { force });
  return invoke<import("../types").ProductBootstrapRunResult>(CMD.run_product_bootstrap, { force });
}

export async function captureScreenshot(): Promise<void> {
  dbg("api", "captureScreenshot");
  return invoke<void>(CMD.capture_screenshot);
}

export async function updateScreenshotHotkey(hotkey: string | null): Promise<void> {
  dbg("api", "updateScreenshotHotkey", { hotkey });
  return invoke<void>(CMD.update_screenshot_hotkey, { hotkey });
}

export async function getWebServerToken(): Promise<string | null> {
  dbg("api", "getWebServerToken");
  return invoke<string | null>(CMD.get_web_server_token);
}

export async function getWebServerStatus(): Promise<{
  enabled: boolean;
  running: boolean;
  port: number;
  bind: string;
  warning?: string;
}> {
  dbg("api", "getWebServerStatus");
  return invoke<{
    enabled: boolean;
    running: boolean;
    port: number;
    bind: string;
    warning?: string;
  }>(CMD.get_web_server_status);
}

export async function regenerateWebServerToken(): Promise<string> {
  dbg("api", "regenerateWebServerToken");
  return invoke<string>(CMD.regenerate_web_server_token);
}

export interface WebServerConfig {
  enabled: boolean;
  port: number;
  bind: string;
  allowed_origins: string[] | null;
  tunnel_url: string | null;
}

export interface RestartResult {
  started: boolean;
  config_saved: boolean;
}

export async function restartWebServer(config: WebServerConfig): Promise<RestartResult> {
  dbg("api", "restartWebServer", { enabled: config.enabled, port: config.port });
  return invoke<RestartResult>(CMD.restart_web_server, { config });
}

export async function getLocalIp(preferV6: boolean): Promise<string | null> {
  dbg("api", "getLocalIp", { preferV6 });
  return invoke<string | null>(CMD.get_local_ip, { preferV6 });
}
export const USER_SETTINGS_CHANGED_EVENT = "miwarp:user-settings-changed";
