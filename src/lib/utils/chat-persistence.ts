/**
 * v1.0.6 / 5.16: Persist the active session id so the next app start can
 * re-open the same chat automatically. We intentionally use localStorage
 * (not IDB) because this is a tiny single key and we want it readable
 * from the boot path before any IDB connection is established.
 */

const KEY = "ocv:active-session-id";

export function readActiveSessionId(): string {
  if (typeof localStorage === "undefined") return "";
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function writeActiveSessionId(id: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {
    // ignore quota / privacy mode
  }
}

export function clearActiveSessionId(): void {
  writeActiveSessionId("");
}
