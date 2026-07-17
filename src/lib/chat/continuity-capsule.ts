/**
 * Continuity Capsule — v1.0.9 "Trustworthy Reload & Session Continuity"
 *
 * A small local-first, versioned, capacity-bounded, TTL-bounded store that
 * complements chat-view-cache with per-run state that the existing cache does
 * not persist: unsent drafts, the cwd captured when the run was active, the
 * first visible timeline anchor + relative offset (for stable scroll
 * restoration), the tool filter, the process visibility, and a per-run
 * Inspector (ToolActivity sidebar) snapshot.
 *
 * Hard rules:
 *   - Schema is versioned (`CAPSULE_SCHEMA_VERSION`). Unknown or mismatched
 *     versions cause a safe wipe — never throw.
 *   - Capacity is bounded to `CAPSULE_MAX_RUNS` runs; LRU eviction.
 *   - Entries older than `CAPSULE_TTL_MS` are dropped on read.
 *   - Drafts are sanitized: never persist token / API-key / env-var strings,
 *     and never persist raw attachment bytes. Only metadata + user-typed
 *     text are kept.
 *   - Storage is local-only (`localStorage`); never synced, never sent to
 *     the backend. No token / secret / env value is allowed in any field.
 */

import type { ToolActivityPanelTab } from "$lib/components/chat/tool-panel-tab";
import type { ProcessVisibility } from "$lib/utils/process-visibility";

const STORAGE_KEY = "ocv:continuity-capsule";

export const CAPSULE_SCHEMA_VERSION = 1;
export const CAPSULE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const CAPSULE_MAX_RUNS = 50;
export const CAPSULE_DRAFT_TEXT_LIMIT = 256 * 1024;
export const CAPSULE_DRAFT_ATTACHMENT_LIMIT = 1000;
export const CAPSULE_DRAFT_PASTED_BLOCK_LIMIT = 1000;
export const CAPSULE_DRAFT_PATHREF_LIMIT = 1000;
export const CAPSULE_DRAFT_PASTED_TEXT_LIMIT = 256 * 1024;
export const CAPSULE_DRAFT_PATHREF_VALUE_LIMIT = 4096;

export interface ContinuityAttachment {
  id: string;
  name: string;
  type: string;
  size: number;
  filePath?: string;
}

export interface ContinuityPastedBlock {
  id: string;
  text: string;
  lineCount: number;
  charCount: number;
  preview: string;
  ext?: string;
}

export interface ContinuityPathRef {
  id: string;
  name: string;
  path: string;
  isDir: boolean;
}

export interface ContinuityDraft {
  text: string;
  attachments: ContinuityAttachment[];
  pastedBlocks: ContinuityPastedBlock[];
  pathRefs: ContinuityPathRef[];
  savedAt: number;
}

export interface ContinuityAnchor {
  entryId: string;
  offsetPx: number;
}

export interface ContinuityInspector {
  toolPanelActiveTab: ToolActivityPanelTab;
  requestedPreviewPath: string | null;
  sidebarCollapsed: boolean;
}

export interface ContinuityRunState {
  runId: string;
  cwd: string;
  draft: ContinuityDraft | null;
  toolFilter: string | null;
  processVisibility: ProcessVisibility;
  anchor: ContinuityAnchor | null;
  inspector: ContinuityInspector;
  savedAt: number;
}

export interface ContinuityCapsule {
  schemaVersion: number;
  lastUpdatedAt: number;
  runs: Record<string, ContinuityRunState>;
}

// ── Defaults ──

function defaultInspector(): ContinuityInspector {
  return {
    toolPanelActiveTab: "workspace",
    requestedPreviewPath: null,
    sidebarCollapsed: false,
  };
}

function defaultRunState(runId: string): ContinuityRunState {
  return {
    runId,
    cwd: "",
    draft: null,
    toolFilter: null,
    processVisibility: "developer",
    anchor: null,
    inspector: defaultInspector(),
    savedAt: 0,
  };
}

function defaultCapsule(): ContinuityCapsule {
  return {
    schemaVersion: CAPSULE_SCHEMA_VERSION,
    lastUpdatedAt: 0,
    runs: {},
  };
}

// ── Sanitizers (defense in depth: never trust incoming data) ──

function sanitizeString(value: unknown, maxLen: number): string {
  if (typeof value !== "string") return "";
  return value.length > maxLen ? value.slice(0, maxLen) : value;
}

function sanitizeInt(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

function sanitizeBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function sanitizeAttachment(raw: unknown): ContinuityAttachment | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = sanitizeString(r.id, 64);
  if (!id) return null;
  const name = sanitizeString(r.name, 512);
  const type = sanitizeString(r.type, 256);
  const size = sanitizeInt(r.size, 0);
  const filePath =
    typeof r.filePath === "string"
      ? sanitizeString(r.filePath, CAPSULE_DRAFT_PATHREF_VALUE_LIMIT)
      : undefined;
  // Deliberately drop contentBase64 (may contain tokens / binary secrets).
  return { id, name, type, size, filePath };
}

function sanitizePastedBlock(raw: unknown): ContinuityPastedBlock | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = sanitizeString(r.id, 64);
  if (!id) return null;
  const text = sanitizeString(r.text, CAPSULE_DRAFT_PASTED_TEXT_LIMIT);
  const lineCount = sanitizeInt(r.lineCount, 0);
  const charCount = sanitizeInt(r.charCount, text.length);
  const preview = sanitizeString(r.preview, 256);
  const ext = typeof r.ext === "string" ? sanitizeString(r.ext, 32) : undefined;
  return { id, text, lineCount, charCount, preview, ext };
}

function sanitizePathRef(raw: unknown): ContinuityPathRef | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = sanitizeString(r.id, 64);
  if (!id) return null;
  const name = sanitizeString(r.name, 512);
  const path = sanitizeString(r.path, CAPSULE_DRAFT_PATHREF_VALUE_LIMIT);
  if (!path) return null;
  const isDir = sanitizeBool(r.isDir, false);
  return { id, name, path, isDir };
}

export function sanitizeDraft(raw: unknown): ContinuityDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const text = sanitizeString(r.text, CAPSULE_DRAFT_TEXT_LIMIT);
  const rawAtts = Array.isArray(r.attachments) ? r.attachments : [];
  const rawPastes = Array.isArray(r.pastedBlocks) ? r.pastedBlocks : [];
  const rawRefs = Array.isArray(r.pathRefs) ? r.pathRefs : [];
  const attachments: ContinuityAttachment[] = [];
  for (const a of rawAtts.slice(0, CAPSULE_DRAFT_ATTACHMENT_LIMIT)) {
    const sa = sanitizeAttachment(a);
    if (sa) attachments.push(sa);
  }
  const pastedBlocks: ContinuityPastedBlock[] = [];
  for (const b of rawPastes.slice(0, CAPSULE_DRAFT_PASTED_BLOCK_LIMIT)) {
    const sb = sanitizePastedBlock(b);
    if (sb) pastedBlocks.push(sb);
  }
  const pathRefs: ContinuityPathRef[] = [];
  for (const p of rawRefs.slice(0, CAPSULE_DRAFT_PATHREF_LIMIT)) {
    const sp = sanitizePathRef(p);
    if (sp) pathRefs.push(sp);
  }
  const savedAt = sanitizeInt(r.savedAt, Date.now());
  // Treat a completely empty draft as no draft — saves bytes and prevents
  // accidental "phantom draft" UX after a fully-cleared input.
  if (
    text.length === 0 &&
    attachments.length === 0 &&
    pastedBlocks.length === 0 &&
    pathRefs.length === 0
  ) {
    return null;
  }
  return { text, attachments, pastedBlocks, pathRefs, savedAt };
}

const TOOL_PANEL_TABS: ReadonlySet<ToolActivityPanelTab> = new Set<ToolActivityPanelTab>([
  "workspace",
  "tools",
  "context",
  "files",
  "info",
  "tasks",
  "preview",
  "scheduled-tasks",
]);

function sanitizeInspector(raw: unknown): ContinuityInspector {
  const fallback = defaultInspector();
  if (!raw || typeof raw !== "object") return fallback;
  const r = raw as Record<string, unknown>;
  const tab = r.toolPanelActiveTab;
  const inspector: ContinuityInspector = {
    toolPanelActiveTab:
      typeof tab === "string" && (TOOL_PANEL_TABS as Set<string>).has(tab)
        ? (tab as ToolActivityPanelTab)
        : fallback.toolPanelActiveTab,
    requestedPreviewPath:
      typeof r.requestedPreviewPath === "string" && r.requestedPreviewPath.length > 0
        ? sanitizeString(r.requestedPreviewPath, CAPSULE_DRAFT_PATHREF_VALUE_LIMIT)
        : null,
    sidebarCollapsed: sanitizeBool(r.sidebarCollapsed, fallback.sidebarCollapsed),
  };
  return inspector;
}

const PROCESS_VISIBILITIES: ReadonlySet<ProcessVisibility> = new Set<ProcessVisibility>([
  "output",
  "guided",
  "developer",
  "expert",
]);

export function sanitizeRunState(raw: unknown, fallbackRunId: string): ContinuityRunState | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const runId = sanitizeString(r.runId, 128) || fallbackRunId;
  if (!runId) return null;
  const cwd = sanitizeString(r.cwd, CAPSULE_DRAFT_PATHREF_VALUE_LIMIT);
  const toolFilter =
    typeof r.toolFilter === "string" && r.toolFilter.length > 0
      ? sanitizeString(r.toolFilter, 256)
      : null;
  const pv = r.processVisibility;
  const processVisibility: ProcessVisibility =
    typeof pv === "string" && (PROCESS_VISIBILITIES as Set<string>).has(pv)
      ? (pv as ProcessVisibility)
      : "developer";
  let anchor: ContinuityAnchor | null = null;
  if (r.anchor && typeof r.anchor === "object") {
    const a = r.anchor as Record<string, unknown>;
    const entryId = sanitizeString(a.entryId, 128);
    if (entryId) {
      anchor = {
        entryId,
        offsetPx: sanitizeInt(a.offsetPx, 0),
      };
    }
  }
  return {
    runId,
    cwd,
    draft: sanitizeDraft(r.draft),
    toolFilter,
    processVisibility,
    anchor,
    inspector: sanitizeInspector(r.inspector),
    savedAt: sanitizeInt(r.savedAt, 0),
  };
}

// ── Persistence (with corruption tolerance) ──

function loadFromStorage(): ContinuityCapsule {
  if (typeof localStorage === "undefined") return defaultCapsule();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultCapsule();
    const parsed = JSON.parse(raw) as Partial<ContinuityCapsule> | null;
    if (!parsed || typeof parsed !== "object") return defaultCapsule();
    if (parsed.schemaVersion !== CAPSULE_SCHEMA_VERSION) {
      // Schema bumped — wipe (no migration until v2 is actually shipped).
      return defaultCapsule();
    }
    const rawRuns =
      parsed.runs && typeof parsed.runs === "object"
        ? (parsed.runs as Record<string, unknown>)
        : {};
    const runs: Record<string, ContinuityRunState> = {};
    for (const [id, value] of Object.entries(rawRuns)) {
      if (!id) continue; // empty key → drop
      const sanitized = sanitizeRunState(value, id);
      if (sanitized) runs[sanitized.runId] = sanitized;
    }
    return {
      schemaVersion: CAPSULE_SCHEMA_VERSION,
      lastUpdatedAt: sanitizeInt(parsed.lastUpdatedAt, 0),
      runs,
    };
  } catch {
    return defaultCapsule();
  }
}

function saveToStorage(c: ContinuityCapsule): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
  } catch {
    /* quota / private mode — silently drop */
  }
}

// ── Mutation helpers (pure: return a new capsule) ──

/** Drop runs whose `savedAt` is older than `CAPSULE_TTL_MS`. */
export function evictExpired(c: ContinuityCapsule, now: number = Date.now()): ContinuityCapsule {
  const next: Record<string, ContinuityRunState> = {};
  for (const [id, run] of Object.entries(c.runs)) {
    if (run.savedAt > 0 && now - run.savedAt <= CAPSULE_TTL_MS) {
      next[id] = run;
    }
  }
  return { ...c, runs: next, lastUpdatedAt: now };
}

/** Cap the run count to `target` by dropping the least-recently-touched first. */
export function evictLeastRecentlyUsed(
  c: ContinuityCapsule,
  target: number,
  now: number = Date.now(),
): ContinuityCapsule {
  const entries = Object.values(c.runs);
  if (entries.length <= target) return c;
  const sorted = [...entries].sort((a, b) => a.savedAt - b.savedAt);
  const keep = new Set(sorted.slice(entries.length - target).map((r) => r.runId));
  const next: Record<string, ContinuityRunState> = {};
  for (const id of Object.keys(c.runs)) {
    if (keep.has(id)) next[id] = c.runs[id];
  }
  return { ...c, runs: next, lastUpdatedAt: now };
}

function normalize(c: ContinuityCapsule, now: number = Date.now()): ContinuityCapsule {
  let out = evictExpired(c, now);
  out = evictLeastRecentlyUsed(out, CAPSULE_MAX_RUNS, now);
  return out;
}

// ── Singleton + public API ──

let _capsule: ContinuityCapsule = normalize(loadFromStorage());

function persist(): void {
  saveToStorage(_capsule);
}

function readRun(runId: string, now: number = Date.now()): ContinuityRunState | null {
  if (!runId) return null;
  const entry = _capsule.runs[runId];
  if (!entry) return null;
  if (entry.savedAt > 0 && now - entry.savedAt > CAPSULE_TTL_MS) {
    // Lazy eviction — silently drop the stale entry on read.
    delete _capsule.runs[runId];
    persist();
    return null;
  }
  return entry;
}

/** Patch a single run's state (or insert a new entry). Returns the updated entry. */
export function touchRunState(
  runId: string,
  patch: Partial<Omit<ContinuityRunState, "runId">>,
  now: number = Date.now(),
): ContinuityRunState | null {
  if (!runId) return null;
  const current = _capsule.runs[runId] ?? defaultRunState(runId);
  const next: ContinuityRunState = {
    ...current,
    ...patch,
    runId,
    savedAt: now,
  };
  _capsule.runs[runId] = next;
  _capsule = normalize(_capsule, now);
  _capsule.lastUpdatedAt = now;
  persist();
  return _capsule.runs[runId] ?? null;
}

/** Read the persisted state for `runId` (or null if missing/expired). */
export function readRunState(runId: string, now: number = Date.now()): ContinuityRunState | null {
  return readRun(runId, now);
}

/** Read a snapshot of the whole capsule (read-only). */
export function readCapsuleSnapshot(): ContinuityCapsule {
  return {
    schemaVersion: _capsule.schemaVersion,
    lastUpdatedAt: _capsule.lastUpdatedAt,
    runs: { ..._capsule.runs },
  };
}

/** Remove a run from the capsule. Idempotent. */
export function removeRunState(runId: string, now: number = Date.now()): void {
  if (!runId) return;
  if (!_capsule.runs[runId]) return;
  delete _capsule.runs[runId];
  _capsule.lastUpdatedAt = now;
  persist();
}

/** Wipe all drafts but keep view state. Used by "clear drafts" UX. */
export function clearAllDrafts(now: number = Date.now()): void {
  for (const id of Object.keys(_capsule.runs)) {
    const run = _capsule.runs[id];
    if (!run) continue;
    if (run.draft) {
      _capsule.runs[id] = { ...run, draft: null, savedAt: now };
    }
  }
  _capsule.lastUpdatedAt = now;
  persist();
}

/** Wipe the entire capsule. Used by the "reset continuity" / debug path. */
export function resetCapsule(now: number = Date.now()): void {
  _capsule = defaultCapsule();
  _capsule.lastUpdatedAt = now;
  persist();
}

/** For tests: inject a capsule into the singleton. Restores on next call. */
export function __setCapsuleForTest(c: ContinuityCapsule | null): void {
  if (c === null) {
    _capsule = normalize(loadFromStorage());
    return;
  }
  // Drop entries with empty runId (mirrors the loadFromStorage filter).
  const safeRuns: Record<string, ContinuityRunState> = {};
  for (const [id, value] of Object.entries(c.runs)) {
    if (!id) continue;
    const sanitized = sanitizeRunState(value, id);
    if (sanitized) safeRuns[sanitized.runId] = sanitized;
  }
  _capsule = normalize({
    schemaVersion: CAPSULE_SCHEMA_VERSION,
    lastUpdatedAt: c.lastUpdatedAt,
    runs: safeRuns,
  });
  persist();
}

/** Whether a stored run state is still fresh. */
export function isRunStateFresh(
  entry: ContinuityRunState | null,
  now: number = Date.now(),
): boolean {
  if (!entry) return false;
  if (entry.savedAt <= 0) return false;
  return now - entry.savedAt <= CAPSULE_TTL_MS;
}
