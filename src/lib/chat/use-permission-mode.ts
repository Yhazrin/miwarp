import * as api from "$lib/api";
import { dbg, dbgWarn } from "$lib/utils/debug";
import { CLI_TO_APP_MODE } from "$lib/chat/utils/permission-modes";
import type { SessionStore } from "$lib/stores/session-store.svelte";

export interface PermissionModeContext {
  store: SessionStore;
  t: (key: string, params?: Record<string, string>) => string;
  showToast: (msg: string) => void;
  getPermModeLabel: (mode: string) => string;
}

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

    // Optimistic UI + protect from session_init during awaits
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
    const appName = CLI_TO_APP_MODE[newMode] ?? newMode;

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
