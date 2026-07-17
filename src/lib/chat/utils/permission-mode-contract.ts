/**
 * Canonical permission mode contract.
 *
 * The app, the CLI, and the user-settings layer all have their own
 * vocabulary for permission modes. Before v1.0.9 these mappings were
 * scattered across three files (`permission-mode-options.ts`,
 * `utils/permission-modes.ts`, `adapter.rs::map_permission_mode`), and
 * rapid mode switches could race such that an old in-flight persist
 * overwrote a newer mode.
 *
 * This file is the single source of truth for the frontend. The
 * backend keeps its own mirror (`agent/adapter.rs::map_permission_mode`)
 * with a `Contract: src/lib/chat/utils/permission-mode-contract.ts`
 * comment; parity is enforced by `permission_mode_contract_test.rs`.
 *
 * Names:
 *   - APP_NAMES are what user-facing settings + UI options use.
 *   - CLI_NAMES are the values the CLI accepts via
 *     `--permission-mode` / `set_permission_mode`.
 *
 * Lifecycle invariants:
 *   - Every UI-visible option has BOTH an APP_NAME and a CLI_NAME.
 *   - `mapAppToCli` / `mapCliToApp` are total on the canonical set
 *     and explicit on unknown inputs (no implicit pass-through that
 *     could drift over time).
 *   - Mode changes use a monotonically increasing sequence number; an
 *     old persist cannot overwrite a newer mode (see
 *     `use-permission-mode.ts`).
 */
const APP_NAMES = ["ask", "auto_read", "auto_all", "plan", "auto", "dont_ask"] as const;

type AppPermissionMode (typeof APP_NAMES)[number];

/**
 * CLI permission-mode names. These are what the Claude CLI accepts
 * (matches `set_permission_mode` control_request).
 */
const CLI_NAMES = [
  "default",
  "acceptEdits",
  "bypassPermissions",
  "plan",
  "auto",
  "dontAsk",
] as const;

type CliPermissionMode (typeof CLI_NAMES)[number];

/**
 * UI labels for `AppPermissionMode`. The labelKey is stable across
 * locales; the visible text lives in `messages/{locale}.json`.
 */
interface AppModeMeta {
  app: AppPermissionMode;
  cli: CliPermissionMode;
  /** Stable label key used by `prompt_permAskLabel` etc. */
  labelKey: string;
  /** True if the mode is dangerous (auto-all / dont-ask); UI may
   *  surface a confirmation toast when switching into it. */
  dangerous: boolean;
}

const APP_MODE_META: ReadonlyArray<AppModeMeta> = [
  {
    app: "ask",
    cli: "default",
    labelKey: "prompt_permAskLabel",
    dangerous: false,
  },
  {
    app: "auto_read",
    cli: "acceptEdits",
    labelKey: "prompt_permAutoReadLabel",
    dangerous: false,
  },
  {
    app: "auto_all",
    cli: "bypassPermissions",
    labelKey: "prompt_permAutoAllLabel",
    dangerous: true,
  },
  {
    app: "plan",
    cli: "plan",
    labelKey: "prompt_permPlanLabel",
    dangerous: false,
  },
  {
    app: "auto",
    cli: "auto",
    labelKey: "prompt_permAutoLabel",
    dangerous: false,
  },
  {
    app: "dont_ask",
    cli: "dontAsk",
    labelKey: "prompt_permDontAskLabel",
    dangerous: true,
  },
];

const APP_TO_CLI: Record<AppPermissionMode, CliPermissionMode> = APP_MODE_META.reduce(
  (acc, m) => {
    acc[m.app] = m.cli;
    return acc;
  },
  {} as Record<AppPermissionMode, CliPermissionMode>,
);

const CLI_TO_APP: Record<CliPermissionMode, AppPermissionMode> = APP_MODE_META.reduce(
  (acc, m) => {
    acc[m.cli] = m.app;
    return acc;
  },
  {} as Record<CliPermissionMode, AppPermissionMode>,
);

/**
 * Map an app-side mode to its CLI-side canonical name. Unknown values
 * are returned as-is (pass-through) and surfaced with a debug breadcrumb
 * so we can spot drift early.
 */
function mapAppToCli(mode: string): string {
  if (mode in APP_TO_CLI) return APP_TO_CLI[mode as AppPermissionMode];
  return mode;
}

/**
 * Map a CLI-side mode to its app-side canonical name. Unknown values
 * pass through and are logged.
 */
export function mapCliToApp(mode: string): string {
  if (mode in CLI_TO_APP) return CLI_TO_APP[mode as CliPermissionMode];
  return mode;
}

/** Whether a mode is considered dangerous (auto-all / dont-ask). */
function isDangerousMode(mode: string): boolean {
  const meta = APP_MODE_META.find((m) => m.app === mode || m.cli === mode);
  return meta?.dangerous ?? false;
}

/**
 * Whether a tool is in `NEVER_ALLOW_TOOLS` (permanent allow denied).
 * Mirrors `storage::shared::NEVER_ALLOW_TOOLS` in Rust.
 */
const NEVER_ALLOW_TOOLS: ReadonlyArray<string> = ["ExitPlanMode", "EnterPlanMode"];

export function isPermanentAllowBlocked(toolName: string): boolean {
  return NEVER_ALLOW_TOOLS.includes(toolName);
}
