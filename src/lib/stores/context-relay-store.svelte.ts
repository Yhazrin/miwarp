/**
 * v1.0.6 / 4.1 Context Relay: a small in-memory queue of context clips
 * the user wants to send to the next message / another session.
 *
 * Single source of truth for:
 *   - the most recent clip (so the chat input can preview it)
 *   - a brief history of past clips (for the relay modal)
 */
import type { ContextClip } from "$lib/services/context-clip-types";
import { uuid } from "$lib/utils/uuid";

class ContextRelayStore {
  private _clips = $state<ContextClip[]>([]);

  get clips(): ContextClip[] {
    return this._clips;
  }

  get latest(): ContextClip | null {
    return this._clips[this._clips.length - 1] ?? null;
  }

  add(draft: Omit<ContextClip, "id" | "createdAt">): ContextClip {
    const clip: ContextClip = {
      ...draft,
      id: uuid(),
      createdAt: Date.now(),
    };
    this._clips = [...this._clips, clip];
    // Bound the queue to avoid unbounded growth.
    if (this._clips.length > 32) {
      this._clips = this._clips.slice(-32);
    }
    return clip;
  }

  remove(id: string): void {
    this._clips = this._clips.filter((c) => c.id !== id);
  }

  clear(): void {
    this._clips = [];
  }
}

export const contextRelayStore = new ContextRelayStore();
