import type { SendStatusEvent, SendState } from "$lib/chat/send-coordinator";

export type SendStatusTone = "warning" | "error" | "info";

export interface SendStatusPresentation {
  visible: boolean;
  labelKey: string;
  tone: SendStatusTone;
  shellClass: string;
  retryable: boolean;
  state: SendState | null;
  errorCode?: string;
}

/**
 * Permission-mode notifications reuse the same tone/shell language as send
 * status so the user sees one consistent overlay surface (SessionStatusBar
 * morphs). Statuses are pre-localized text so the SessionStatusBar doesn't
 * have to know about i18n keys here — callers translate before pushing.
 */
export type PermissionStatusTone = "info" | "warning" | "error";

export interface PermissionStatusPresentation {
  visible: boolean;
  text: string;
  tone: PermissionStatusTone;
  shellClass: string;
}

export function sendStatusLabelKey(event: SendStatusEvent): string {
  switch (event.state) {
    case "submitting":
      return "send_status_submitting";
    case "queued":
      return "send_status_queued";
    case "failed":
      return sendFailureLabelKey(event);
    case "accepted":
      return "send_status_accepted";
    default:
      return "";
  }
}

export function sendFailureLabelKey(event: SendStatusEvent): string {
  const code = event.error?.code ?? "unknown";
  switch (code) {
    case "transport_unavailable":
      return "send_status_failed_transport";
    case "rejected":
      return "send_status_failed_rejected";
    case "stale_identity":
      return "send_status_failed_stale";
    case "timeout":
      return "send_status_failed_timeout";
    default:
      return "send_status_failed_unknown";
  }
}

export function sendStatusTone(event: SendStatusEvent): SendStatusTone {
  if (event.state === "submitting" || event.state === "queued") return "info";
  if (event.state === "failed") {
    return event.error?.code === "stale_identity" ? "warning" : "error";
  }
  return "info";
}

export function sendStatusShellClass(tone: SendStatusTone): string {
  switch (tone) {
    case "warning":
      return "session-island-send-warning";
    case "error":
      return "session-island-send-failed";
    default:
      return "session-island-send-pending";
  }
}

/**
 * Reuse the send-status shell tokens so the user sees one morph surface
 * for both transports and configuration changes (e.g. permission mode).
 */
export function permissionStatusShellClass(tone: PermissionStatusTone): string {
  switch (tone) {
    case "warning":
      return "session-island-send-warning";
    case "error":
      return "session-island-send-failed";
    case "info":
    default:
      return "session-island-send-pending";
  }
}

export interface PermissionStatusInput {
  text: string;
  tone: PermissionStatusTone;
  /** When `false`, the caller expects the status to remain until cleared manually. */
  transient?: boolean;
}

export function getPermissionStatusPresentation(
  input: PermissionStatusInput | null,
): PermissionStatusPresentation | null {
  if (!input) return null;
  return {
    visible: true,
    text: input.text,
    tone: input.tone,
    shellClass: permissionStatusShellClass(input.tone),
  };
}

export function getSendStatusPresentation(
  event: SendStatusEvent | null,
): SendStatusPresentation | null {
  if (!event) return null;

  const visible = event.state !== "accepted";
  if (!visible) {
    return {
      visible: false,
      labelKey: "",
      tone: "info",
      shellClass: "",
      retryable: false,
      state: event.state,
      errorCode: event.error?.code,
    };
  }

  const tone = sendStatusTone(event);
  return {
    visible: true,
    labelKey: sendStatusLabelKey(event),
    tone,
    shellClass: sendStatusShellClass(tone),
    retryable: Boolean(event.error?.retryable),
    state: event.state,
    errorCode: event.error?.code,
  };
}
