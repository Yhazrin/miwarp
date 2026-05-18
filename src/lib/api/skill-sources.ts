/**
 * Skill source registry API (Feishu MVP — execution stays on the Rust side).
 */
import { getTransport } from "$lib/transport";
import type {
  InstallRemoteSkillResult,
  RemoteSkillCandidate,
  SkillSourceConfig,
  SkillSourceHealth,
  SkillSourceSyncResult,
  SkillSourceUpdateCheck,
} from "$lib/types/skill";

function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return getTransport().invoke<T>(cmd, args);
}

export function listSkillSources(): Promise<SkillSourceConfig[]> {
  return invoke<SkillSourceConfig[]>("list_skill_sources");
}

export function createSkillSource(config: SkillSourceConfig): Promise<SkillSourceConfig> {
  return invoke<SkillSourceConfig>("create_skill_source", { config });
}

export function updateSkillSource(id: string, patch: SkillSourceConfig): Promise<SkillSourceConfig> {
  return invoke<SkillSourceConfig>("update_skill_source", { id, patch });
}

export function deleteSkillSource(id: string): Promise<void> {
  return invoke<void>("delete_skill_source", { id });
}

export function testSkillSource(id: string): Promise<SkillSourceHealth> {
  return invoke<SkillSourceHealth>("test_skill_source", { id });
}

export function syncSkillSource(id: string): Promise<SkillSourceSyncResult> {
  return invoke<SkillSourceSyncResult>("sync_skill_source", { id });
}

export function previewFeishuSkillDoc(params: {
  docUrl: string;
  authProfile?: string | null;
  parserMode?: "strict" | "loose";
  sourceIdHint?: string | null;
}): Promise<RemoteSkillCandidate> {
  return invoke<RemoteSkillCandidate>("preview_feishu_skill_doc", {
    doc_url: params.docUrl,
    auth_profile: params.authProfile ?? null,
    parser_mode: params.parserMode ?? null,
    source_id_hint: params.sourceIdHint ?? null,
  });
}

export function installRemoteSkill(params: {
  candidateId: string;
  scope?: string;
  cwd?: string | null;
  conflictResolution?: "abort" | "copy" | "replace" | string;
}): Promise<InstallRemoteSkillResult> {
  const args: Record<string, unknown> = {
    candidate_id: params.candidateId,
    scope: params.scope ?? null,
    cwd: params.cwd ?? null,
  };
  if (params.conflictResolution !== undefined && params.conflictResolution !== "") {
    args.conflict_resolution = params.conflictResolution;
  }
  return invoke<InstallRemoteSkillResult>("install_remote_skill", args);
}

export function checkSkillSourceUpdates(
  id: string,
  cwd?: string | null,
): Promise<SkillSourceUpdateCheck> {
  return invoke<SkillSourceUpdateCheck>("check_skill_source_updates", {
    id,
    cwd: cwd ?? null,
  });
}
