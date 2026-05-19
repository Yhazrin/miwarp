/**
 * Permission mode translation maps.
 *
 * Store/dropdown use CLI names; UserSettings uses app names;
 * adapter.rs maps app→CLI.
 */

export const CLI_TO_APP_MODE: Record<string, string> = {
  default: "ask",
  acceptEdits: "auto_read",
  bypassPermissions: "auto_all",
  plan: "plan",
  auto: "auto",
  dontAsk: "dont_ask",
};

export const APP_TO_CLI_MODE: Record<string, string> = {
  ask: "default",
  auto_read: "acceptEdits",
  auto_all: "bypassPermissions",
  plan: "plan",
  auto: "auto",
  dont_ask: "dontAsk",
};
