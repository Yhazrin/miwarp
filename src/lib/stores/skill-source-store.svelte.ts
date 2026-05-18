/**
 * Reactive state for pluggable skill sources (Feishu MVP).
 * Loads and mutations are triggered by UI events — no self-triggering `$effect`.
 */
import * as skillSourcesApi from "$lib/api/skill-sources";
import { dbg, dbgWarn } from "$lib/utils/debug";
import type {
  RemoteSkillCandidate,
  SkillSourceConfig,
  SkillSourceHealth,
  SkillSourceSyncResult,
  SkillSourceUpdateCheck,
} from "$lib/types/skill";

export type SkillSourceSyncLogEntry = {
  ts: string;
  kind: "info" | "success" | "error";
  detail: string;
};

function isoNow(): string {
  return new Date().toISOString();
}

export class SkillSourcesStore {
  sources = $state<SkillSourceConfig[]>([]);
  remoteCandidates = $state<RemoteSkillCandidate[]>([]);
  previewCandidate = $state<RemoteSkillCandidate | null>(null);
  lastSyncBySource = $state<Record<string, SkillSourceSyncResult>>({});
  lastHealthBySource = $state<Record<string, SkillSourceHealth>>({});
  lastUpdatesCheck = $state<SkillSourceUpdateCheck | null>(null);

  syncingSourceIds = $state(new Set<string>());
  loading = $state(false);
  error = $state<string | null>(null);

  syncLogs = $state<SkillSourceSyncLogEntry[]>([]);

  private startupRan = false;

  /** One-shot startup sync for sources with sync.mode === "startup" — call from onMount once. */
  async runStartupSyncIfNeeded(projectCwd: string | undefined): Promise<void> {
    if (this.startupRan) return;
    this.startupRan = true;
    for (const s of this.sources) {
      if (!s.enabled || s.sync.mode !== "startup") continue;
      await this.syncSource(s.id);
    }
  }

  log(kind: SkillSourceSyncLogEntry["kind"], detail: string) {
    this.syncLogs = [{ ts: isoNow(), kind, detail }, ...this.syncLogs].slice(0, 120);
  }

  mergeCandidates(sourceId: string, list: RemoteSkillCandidate[]) {
    const rest = this.remoteCandidates.filter((c) => c.sourceId !== sourceId);
    this.remoteCandidates = [...rest, ...list];
  }

  async loadSources(): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      this.sources = await skillSourcesApi.listSkillSources();
      dbg("skill-sources-store", "loadSources", this.sources.length);
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      dbgWarn("skill-sources-store", "loadSources failed", e);
    } finally {
      this.loading = false;
    }
  }

  async addFeishuSource(config: SkillSourceConfig): Promise<void> {
    const created = await skillSourcesApi.createSkillSource(config);
    this.sources = [...this.sources.filter((s) => s.id !== created.id), created];
    this.log("success", `Source created: ${created.name}`);
  }

  async patchSource(patch: SkillSourceConfig): Promise<void> {
    const updated = await skillSourcesApi.updateSkillSource(patch.id, patch);
    this.sources = this.sources.map((s) => (s.id === updated.id ? updated : s));
  }

  async removeSource(id: string): Promise<void> {
    await skillSourcesApi.deleteSkillSource(id);
    this.sources = this.sources.filter((s) => s.id !== id);
    this.remoteCandidates = this.remoteCandidates.filter((c) => c.sourceId !== id);
    this.log("info", `Removed source ${id}`);
  }

  async testSource(id: string): Promise<void> {
    this.error = null;
    try {
      const h = await skillSourcesApi.testSkillSource(id);
      this.lastHealthBySource = { ...this.lastHealthBySource, [id]: h };
      this.log(h.ok ? "success" : "error", `${id}: ${h.message ?? ""}`.trim());
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.error = msg;
      this.log("error", `test ${id}: ${msg}`);
    }
  }

  async syncSource(id: string): Promise<void> {
    if (this.syncingSourceIds.has(id)) return;
    const next = new Set(this.syncingSourceIds);
    next.add(id);
    this.syncingSourceIds = next;
    this.error = null;
    try {
      const res = await skillSourcesApi.syncSkillSource(id);
      this.lastSyncBySource = { ...this.lastSyncBySource, [id]: res };
      this.mergeCandidates(id, res.candidates ?? []);
      if (res.errors.length) {
        this.log("error", `${id}: ${res.errors.join("; ")}`);
      } else {
        this.log("success", `${id}: sync OK (${res.fetched} fetched, ${res.skipped} skipped)`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.error = msg;
      this.log("error", `${id}: ${msg}`);
    } finally {
      const fin = new Set(this.syncingSourceIds);
      fin.delete(id);
      this.syncingSourceIds = fin;
    }
  }

  async previewFeishuDoc(
    docUrl: string,
    authProfile: string | undefined,
    mode: "strict" | "loose",
    sourceIdHint: string | undefined,
  ): Promise<void> {
    this.error = null;
    try {
      this.previewCandidate = await skillSourcesApi.previewFeishuSkillDoc({
        docUrl,
        authProfile,
        parserMode: mode,
        sourceIdHint,
      });
      if (this.previewCandidate) {
        this.mergeCandidates(this.previewCandidate.sourceId, [this.previewCandidate]);
      }
    } catch (e) {
      this.previewCandidate = null;
      const msg = e instanceof Error ? e.message : String(e);
      this.error = msg;
      this.log("error", `preview: ${msg}`);
    }
  }

  async installCandidate(
    candidateId: string,
    scope: string,
    projectCwd: string | undefined,
    conflictResolution?: string,
  ): Promise<boolean> {
    this.error = null;
    try {
      const result = await skillSourcesApi.installRemoteSkill({
        candidateId,
        scope,
        cwd: scope === "project" ? projectCwd ?? "" : "",
        conflictResolution,
      });
      if (!result.success) {
        this.error =
          result.message + (result.conflictName ? ` (${result.conflictName})` : "");
        return false;
      }
      this.log("success", `Installed remote skill (${result.skillPath ?? "ok"})`);
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.error = msg;
      return false;
    }
  }

  async checkUpdates(id: string, projectCwd: string | undefined): Promise<void> {
    this.error = null;
    try {
      const r = await skillSourcesApi.checkSkillSourceUpdates(id, projectCwd ?? "");
      this.lastUpdatesCheck = r;
      const n = r.updates?.length ?? 0;
      this.log("info", n ? `${id}: ${n} update(s) available` : `${id}: up to date`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.error = msg;
    }
  }
}

export const skillSourcesStore = new SkillSourcesStore();
