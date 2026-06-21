import * as api from "$lib/api";
import { dbg, dbgWarn } from "$lib/utils/debug";
import { mapCliToApp } from "$lib/chat/utils/permission-mode-contract";
import type { SessionStore } from "$lib/stores/session-store.svelte";

export interface PermissionModeContext {
  store: SessionStore;
  t: (key: string, params?: Record<string, string>) => string;
  showToast: (msg: string) => void;
  getPermModeLabel: (mode: string) => string;
}

/**
 * Sequence-tracked permission mode switcher.
 *
 * Race-safety invariant: every mode change increments `seq`. A persist
 * that resolves AFTER a newer mode change has already been observed
 * cannot roll the UI back to the older mode — the seq check on each
 * async continuation aborts the stale work.
 *
 * The two awaits (control protocol + settings persist) are independent
 * chains that both honor the seq. The control protocol chain is
 * strictly ordered; the persist chain runs in the background so a
 * flaky disk write doesn't block the user's perceived switch.
 */
export function createPermissionModeHandler(ctx: PermissionModeContext) {
  let permissionModeChangeSeq = 0;
  let pendingPersist: Promise<void> = Promise.resolve();

  return async function handlePermissionModeChange(
    newMode: string,
    opts?: { toast?: boolean },
  ): Promise<boolean> {
    const { store, t, showToast, getPermModeLabel } = ctx;
    const seq = ++permissionModeChangeSeq;
    const oldMode = store.permissionMode;
    const oldFlag = store.permissionModeSetByUser;
    const oldPersistFailed = store.permissionModePersistFailed;
    const hadActiveSession = store.sessionAlive;
    dbg("chat", "permission mode change", { from: oldMode, to: newMode, seq, hadActiveSession });

    // Optimistic UI + protect from session_init during awaits. Only
    // commit if this is still the latest change.
    if (seq !== permissionModeChangeSeq) return false;
    store.permissionMode = newMode;
    store.permissionModeSetByUser = true;
    store.permissionModePersistFailed = false;

    if (hadActiveSession && store.run) {
      try {
        await api.setPermissionMode(store.run.id, newMode);
        dbg("chat", "permission mode changed via control protocol", { newMode });
      } catch (e) {
        if (seq !== permissionModeChangeSeq) return false;
        store.permissionMode = oldMode;
        store.permissionModeSetByUser = oldFlag;
        store.permissionModePersistFailed = oldPersistFailed;
        dbgWarn("chat", "permission mode change failed:", e);
        store.error = t("chat_permModeFailed", { mode: newMode, error: String(e) });
        if (opts?.toast !== false) {
          showToast(t("toast_permissionFailed"));
        }
        return false;
      }
    }

    if (seq !== permissionModeChangeSeq) return false;

    if (opts?.toast !== false) {
      showToast(t("toast_permissionMode", { mode: getPermModeLabel(newMode) }));
    }

    let persistFailed = false;
    // Canonical mapping: app mode (UI/CLI) is stored in settings under
    // the APP name; control protocol uses the CLI name. We re-derive
    // the app name from the CLI value so the persisted shape is
    // consistent regardless of which side of the mapping the user
    // touched first.
    const appName = mapCliToApp(newMode);

    pendingPersist = pendingPersist
      .then(async () => {
        if (seq !== permissionModeChangeSeq) return;
        try {
          await api.updateUserSettings({ permission_mode: appName });
          dbg("chat", "permission mode persisted", { appName });
        } catch (e) {
          if (seq !== permissionModeChangeSeq) return;
          dbgWarn("chat", "permission mode persist failed:", e);
          if (hadActiveSession) {
            store.permissionModePersistFailed = true;
            if (opts?.toast !== false) showToast(t("toast_permissionPersistFailed"));
          } else {
            persistFailed = true;
            store.permissionMode = oldMode;
            store.permissionModeSetByUser = oldFlag;
            store.permissionModePersistFailed = oldPersistFailed;
            dbgWarn("chat", "no active session — reverting UI to match persisted settings");
            if (opts?.toast !== false) showToast(t("toast_permissionChangeFailed"));
          }
        }
      })
      .catch((e) => dbgWarn("chat", "permission mode persist failed:", e));

    await pendingPersist;

    if (persistFailed) return false;

    if (seq === permissionModeChangeSeq) {
      api.updateAgentSettings("claude", { plan_mode: newMode === "plan" }).catch((e) => {
        dbgWarn("chat", "plan_mode sync failed:", e);
      });
    }

    return seq === permissionModeChangeSeq;
  };
}
