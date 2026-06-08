/**
 * v1.0.6 / 4.1 Context Relay — shape of a "clip" (selected text passed
 * between sessions / surfaces).
 *
 * Clips are intentionally small JSON payloads: text + source attribution.
 * We do not embed file blobs; for "send a file" the caller uses an
 * attachment (which has its own transport).
 */

export type ContextClipSource = "chat-bubble" | "tool-output" | "artifact" | "file" | "manual";

export interface ContextClip {
  /** UUID v4 (or runId + counter for tests). */
  id: string;
  /** Text snippet being relayed. */
  text: string;
  /** Where the clip came from. */
  source: ContextClipSource;
  /** Free-form label (e.g. file path, message id, or user-typed note). */
  label?: string;
  /** Run id this clip was originally observed in, if any. */
  runId?: string;
  /** Wall-clock ms when the clip was created. */
  createdAt: number;
}

export type ContextClipDraft = Omit<ContextClip, "id" | "createdAt">;
