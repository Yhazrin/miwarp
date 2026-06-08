/**
 * v1.0.6 follow-up: helper that wraps `api.updateUserSettings` with
 * optimistic update + error rollback. Returns a stable function for
 * use in SettingsField* onchange handlers.
 */
import * as api from "$lib/api";
import type { UserSettings } from "$lib/types";

export type SettingsPatcher = (patch: Partial<UserSettings>) => Promise<UserSettings | null>;

/**
 * Returns a function that:
 *  1. Optimistically writes the patch to `current` (in-place via $state).
 *  2. Calls `api.updateUserSettings`.
 *  3. On error, rolls back to the prior value.
 *  4. On success, replaces `current` with the server-returned settings
 *     (authoritative).
 *
 * Use inside Svelte component code:
 *
 *   const patch = useSettingsPatch();
 *   const onToggle = (v: boolean) => patch({ notifications_enabled: v });
 */
export function useSettingsPatch(
  current: { value: UserSettings | null },
  onSaved?: (s: UserSettings) => void,
): SettingsPatcher {
  return async (patch) => {
    if (!current.value) return null;
    const prev = current.value;
    // Optimistic update.
    current.value = { ...prev, ...patch };
    try {
      const next = (await api.updateUserSettings(patch as Partial<UserSettings>)) as UserSettings;
      current.value = next;
      if (onSaved) onSaved(next);
      return next;
    } catch (e) {
      // Roll back on failure.
      current.value = prev;
      throw e;
    }
  };
}
