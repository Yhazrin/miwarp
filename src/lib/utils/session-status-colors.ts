import type { SessionStatusColors } from "$lib/types";

export type SessionStatusColorKey =
  | "running"
  | "done"
  | "failed"
  | "pending"
  | "paused"
  | "blocked"
  | "idle";

export const DEFAULT_SESSION_STATUS_COLORS: Record<SessionStatusColorKey, string> = {
  running: "#3B82F6",
  done: "#10B981",
  failed: "#EF4444",
  pending: "#F59E0B",
  paused: "#94A3B8",
  blocked: "#F97316",
  idle: "#9CA3AF",
};

const VALID_KEYS: SessionStatusColorKey[] = [
  "running",
  "done",
  "failed",
  "pending",
  "paused",
  "blocked",
  "idle",
];

function isValidHexColor(color: string): boolean {
  return /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(color);
}

export function normalizeSessionStatusColors(
  input: unknown,
): Record<SessionStatusColorKey, string> | null {
  if (input == null || typeof input !== "object") return null;

  const result: Record<SessionStatusColorKey, string> = { ...DEFAULT_SESSION_STATUS_COLORS };
  const obj = input as Record<string, unknown>;

  for (const key of VALID_KEYS) {
    const val = obj[key];
    if (typeof val === "string" && isValidHexColor(val)) {
      (result as Record<string, string>)[key] = val;
    }
  }

  return result;
}

export function getSessionStatusColor(
  colors: Partial<Record<SessionStatusColorKey, string>> | undefined,
  key: SessionStatusColorKey,
): string {
  return colors?.[key] ?? DEFAULT_SESSION_STATUS_COLORS[key];
}

export function buildSessionStatusColorVars(
  colors: Partial<Record<SessionStatusColorKey, string>> | undefined,
): string {
  const vars: string[] = [];
  for (const key of VALID_KEYS) {
    const color = colors?.[key] ?? DEFAULT_SESSION_STATUS_COLORS[key];
    vars.push(`--miwarp-status-${key}-custom: ${color};`);
  }
  return vars.join(" ");
}

export function mapRunStatusToColorKey(status: string): SessionStatusColorKey {
  const s = status.toLowerCase();
  if (s === "running" || s === "streaming") return "running";
  if (s === "completed" || s === "done" || s === "success") return "done";
  if (s === "failed" || s === "error") return "failed";
  if (s === "pending" || s === "queued" || s === "loading" || s === "waiting_input")
    return "pending";
  if (s === "stopped" || s === "cancelled" || s === "paused") return "paused";
  if (
    s === "permission_prompt" ||
    s === "ask_pending" ||
    s === "blocked" ||
    s === "waiting_approval"
  )
    return "blocked";
  return "idle";
}
