/**
 * Permission mode translation maps.
 *
 * @deprecated Use `permission-mode-contract.ts` directly. This file is
 * retained as a thin re-export so older imports compile unchanged.
 * The canonical source is `utils/permission-mode-contract.ts` and the
 * backend mirror in `agent/adapter.rs::map_permission_mode`.
 */
export {
  APP_NAMES,
  APP_MODE_META,
  CLI_NAMES,
  mapAppToCli,
  mapCliToApp,
  NEVER_ALLOW_TOOLS,
  isDangerousMode,
  isPermanentAllowBlocked,
  type AppPermissionMode,
  type CliPermissionMode,
  type AppModeMeta,
} from "./permission-mode-contract";

/** @deprecated Prefer {@link mapCliToApp}. */
export const CLI_TO_APP_MODE: Record<string, string> = {
  default: "ask",
  acceptEdits: "auto_read",
  bypassPermissions: "auto_all",
  plan: "plan",
  auto: "auto",
  dontAsk: "dont_ask",
};

/** @deprecated Prefer {@link mapAppToCli}. */
export const APP_TO_CLI_MODE: Record<string, string> = {
  ask: "default",
  auto_read: "acceptEdits",
  auto_all: "bypassPermissions",
  plan: "plan",
  auto: "auto",
  dont_ask: "dontAsk",
};
