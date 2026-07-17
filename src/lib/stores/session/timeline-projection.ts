/**
 * TimelineProjection — pure derivations over the store's timeline and tools.
 *
 * Extracted from session-store (Worker-4 P0/P1/P2 refactor). Every export
 * here is a pure function that takes a read view and returns a derived
 * value. No I/O, no side effects.
 *
 * This module owns:
 *  - activeToolName (item #4 Tool/SubTimeline Index)
 *  - backfillAnchorId (pre-existing helper used by snapshot-repository)
 *  - timelineAttachments / mapAttachments / appendCapped (pre-existing
 *    timeline utility helpers)
 *  - activeBackgroundTasks / hasBackgroundTasks
 *  - effectiveCwd
 */

import type { TimelineEntry, Attachment } from "$lib/types";
import { IMAGE_TYPES } from "$lib/utils/file-types";

/** Local structural type for the taskNotifications map values. */
interface TaskNotificationLike {
  task_id: string;
  status: string;
  message: string;
  startedAt: number;
  data: unknown;
  output_file?: string;
  task_type?: string;
  summary?: string;
  tool_use_id?: string;
}

/** Backfill anchorId for old timeline entries that predate the anchor system. */
export function backfillAnchorId(entry: TimelineEntry): TimelineEntry {
  if (entry.anchorId) return entry;
  const e = entry as Record<string, unknown>;
  const anchor = (e.cliUuid as string) || (e.id as string);
  const patched = { ...entry, anchorId: anchor } as TimelineEntry;
  if (patched.kind === "tool" && patched.subTimeline) {
    patched.subTimeline = patched.subTimeline.map(backfillAnchorId);
  }
  return patched;
}

/**
 * Strip contentBase64 from non-image attachments to avoid storing MB of
 * data in reactive state. Images keep base64 for inline <img> preview;
 * PDF/other show as file chip (metadata only).
 */
export function timelineAttachments(atts: Attachment[]): Attachment[] | undefined {
  if (atts.length === 0) return undefined;
  return atts.map((a) =>
    (IMAGE_TYPES as readonly string[]).includes(a.type) ? a : { ...a, contentBase64: "" },
  );
}

/** Map frontend Attachment[] to backend AttachmentData format for IPC. */
export function mapAttachments(
  atts: Attachment[],
): Array<{ content_base64: string; media_type: string; filename: string }> | null {
  if (atts.length === 0) return null;
  return atts.map((a) => ({
    content_base64: a.contentBase64,
    media_type: a.type,
    filename: a.name,
  }));
}

/** Append to a capped array (rolling 100-entry window). */
function appendCapped<T>(arr: T[], item: T): T[] {
  const next = [...arr, item];
  return next.length > 100 ? next.slice(-100) : next;
}

/** Find the most recently running top-level tool. */
export function activeToolName(
  timeline: TimelineEntry[],
  useStream: boolean,
  tools: { status?: string; tool_name?: string }[],
): string {
  if (useStream) {
    for (let i = timeline.length - 1; i >= 0; i--) {
      const e = timeline[i];
      if (e.kind === "tool" && e.tool.status === "running") return e.tool.tool_name;
    }
    return "";
  }
  return tools.filter((e) => e.status === "running").at(-1)?.tool_name ?? "";
}

/** Active background task notifications (deduped by task_id). */
function activeBackgroundTasks<T extends TaskNotificationLike>(
  taskNotifications: Map<string, T>,
): T[] {
  return [...taskNotifications.values()].filter((t) => t.status !== "completed");
}

function hasBackgroundTasks<T extends TaskNotificationLike>(
  taskNotifications: Map<string, T>,
): boolean {
  return activeBackgroundTasks(taskNotifications).length > 0;
}

/** Effective cwd: prefer sessionCwd, fall back to run.cwd, then "". */
function effectiveCwd(
  sessionCwd: string,
  remoteHostName: string | null,
  platformCwd: string | null,
): string {
  if (sessionCwd) return sessionCwd;
  if (platformCwd) return platformCwd;
  return "";
}
