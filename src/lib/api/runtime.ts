// runtime API functions
// Auto-generated from api.ts

import { getTransport } from "../transport";
import { CMD, type CmdName } from "../tauri-commands";

function invoke<T>(cmd: CmdName | string, args?: Record<string, unknown>): Promise<T> {
  return getTransport().invoke<T>(cmd, args);
}
import type {} from "../types";
import type {
  ConfigTransactionPreview,
  ConfigTransactionResult,
  RuntimeControlPlaneList,
  RuntimeHubHealthResponse,
} from "../runtime-control-plane/types";
import type {} from "../types/task";
import type {} from "../types/run-journal";
import type {} from "../types/attention-queue";
import type {
  FleetMemberSummary,
  FleetMemberDetail,
  FleetMetrics,
  FleetSendResult,
} from "../types";

export async function runtimeHubList(force = false): Promise<RuntimeControlPlaneList> {
  return invoke<RuntimeControlPlaneList>(CMD.runtime_hub_list, { force });
}

export async function runtimeHubHealth(
  runtimeId: string,
  force = false,
): Promise<RuntimeHubHealthResponse> {
  return invoke<RuntimeHubHealthResponse>(CMD.runtime_hub_health, { runtimeId, force });
}

export async function runtimeHubDiagnose(runtimeId: string): Promise<unknown> {
  return invoke(CMD.runtime_hub_diagnose, { runtimeId });
}

export async function runtimeHubSetDefault(runtimeId: string): Promise<string> {
  return invoke<string>(CMD.runtime_hub_set_default, { runtimeId });
}

export async function runtimeHubPreviewConfig(
  runtimeId: string,
  patch: Record<string, unknown>,
): Promise<ConfigTransactionPreview> {
  return invoke<ConfigTransactionPreview>(CMD.runtime_hub_preview_config, { runtimeId, patch });
}

export async function runtimeHubApplyConfig(
  runtimeId: string,
  patch: Record<string, unknown>,
): Promise<ConfigTransactionResult> {
  return invoke<ConfigTransactionResult>(CMD.runtime_hub_apply_config, { runtimeId, patch });
}

export async function runtimeHubStartConfigWatch(runtimeId: string): Promise<number> {
  return invoke<number>(CMD.runtime_hub_start_config_watch, { runtimeId });
}

export async function runtimeHubStopConfigWatch(runtimeId: string): Promise<boolean> {
  return invoke<boolean>(CMD.runtime_hub_stop_config_watch, { runtimeId });
}

export interface ListFleetOptions {
  /**
   * Surface auto-archived members (older than 24h, not running). The desktop
   * UI hides these by default; the option is exposed for power users and
   * MCP/REST callers that want full visibility.
   */
  includeArchived?: boolean;
}

export async function listFleet(opts: ListFleetOptions = {}): Promise<FleetMemberSummary[]> {
  return invoke<FleetMemberSummary[]>(CMD.fleet_list, {
    includeArchived: opts.includeArchived ?? false,
  });
}

export async function getFleetMember(id: string): Promise<FleetMemberDetail> {
  return invoke<FleetMemberDetail>(CMD.fleet_get_member, { id });
}

export interface GetFleetMetricsOptions {
  includeArchived?: boolean;
}

export async function getFleetMetrics(opts: GetFleetMetricsOptions = {}): Promise<FleetMetrics> {
  return invoke<FleetMetrics>(CMD.fleet_get_metrics, {
    includeArchived: opts.includeArchived ?? false,
  });
}

export async function sendToFleetMember(id: string, prompt: string): Promise<FleetSendResult> {
  return invoke<FleetSendResult>(CMD.fleet_send_to_member, { id, prompt });
}

export async function stopFleetMember(id: string): Promise<boolean> {
  return invoke<boolean>(CMD.fleet_stop_member, { id });
}
