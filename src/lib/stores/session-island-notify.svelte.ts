import type { PermissionStatusInput } from "$lib/chat/send-status-presentation";

type SessionIslandNotifyListener = (input: PermissionStatusInput) => void;

/** Chat page registers this while mounted so global callers can surface island overlays. */
let _listener: SessionIslandNotifyListener | null = null;

export function registerSessionIslandNotify(listener: SessionIslandNotifyListener | null): void {
  _listener = listener;
}

/** Push a transient status into SessionStatusBar when chat is active. Returns false if no listener. */
export function pushSessionIslandNotify(input: PermissionStatusInput): boolean {
  if (!_listener) return false;
  _listener(input);
  return true;
}
