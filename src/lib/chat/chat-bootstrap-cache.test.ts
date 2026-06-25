import { describe, expect, it } from "vitest";
import type { UserSettings } from "$lib/types";
import {
  consumeChatBootstrap,
  refreshChatBootstrapSettings,
  snapshotChatBootstrap,
} from "./chat-bootstrap-cache";

const baseSettings = { show_token_usage_report: true } as UserSettings;

describe("chat-bootstrap-cache", () => {
  it("refreshes settings in an active snapshot", () => {
    snapshotChatBootstrap(baseSettings, null);
    refreshChatBootstrapSettings({
      ...baseSettings,
      show_token_usage_report: false,
      session_island_alignment: "right",
    });

    const bootstrap = consumeChatBootstrap();
    expect(bootstrap?.settings.show_token_usage_report).toBe(false);
    expect(bootstrap?.settings.session_island_alignment).toBe("right");
  });

  it("no-ops refresh when no snapshot exists", () => {
    expect(() =>
      refreshChatBootstrapSettings({
        ...baseSettings,
        show_token_usage_report: false,
      }),
    ).not.toThrow();
    expect(consumeChatBootstrap()).toBeNull();
  });
});
