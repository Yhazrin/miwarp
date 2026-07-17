/**
 * v1.0.6 / 7.1: Per-user mascot overrides.
 *
 * The user can pick a different mascot for each agent (claude, codex, …)
 * from the Appearance settings tab. Overrides are persisted in
 * `~/.miwarp/mascot-overrides.json` via the existing settings pipeline —
 * here we keep the in-memory mirror + a tiny cache for the chat bubbles.
 */
import { dbg } from "$lib/utils/debug";

type AgentKey = string;

const STORAGE_KEY = "ocv:mascot-overrides";

class MascotOverrideStore {
  private _overrides = $state<Record<AgentKey, string>>({});
  private _loaded = false;

  /** Read overrides from localStorage (best-effort, never throws). */
  load(): void {
    if (this._loaded) return;
    if (typeof localStorage === "undefined") return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          this._overrides = parsed as Record<AgentKey, string>;
        }
      }
    } catch (e) {
      dbg("mascot", "load failed", e);
    }
    this._loaded = true;
  }

  /** Get the override for an agent (URL or empty string). */
  get(agent: string): string | undefined {
    return this._overrides[agent];
  }

  /** Persist an override; pass empty string to clear. */
  set(agent: string, mascotUrl: string): void {
    const next: Record<AgentKey, string> = { ...this._overrides };
    if (mascotUrl) next[agent] = mascotUrl;
    else delete next[agent];
    this._overrides = next;
    if (typeof localStorage !== "undefined") {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch (e) {
        dbg("mascot", "set failed", e);
      }
    }
  }

  /** Drop the override (revert to default). */
  clear(agent: string): void {
    this.set(agent, "");
  }
}

export const mascotOverrides = new MascotOverrideStore();
