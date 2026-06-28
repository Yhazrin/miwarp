/**
 * Personal profile export — security regression test.
 *
 * P0 invariant: the JSON file a user downloads from the Personal page
 * MUST NOT contain any credential-shaped field. If a future refactor
 * reintroduces `JSON.stringify(settings)`, or widens the whitelist by
 * mistake, this test fails before the build ships.
 *
 * Forbidden substrings (case-sensitive) cover the historical leak paths:
 *   - `sk-secret-123` / `ghp_x` — synthetic secret values injected below
 *   - `anthropic_api_key` — Anthropic credential field
 *   - `api_key` — generic credential field name (catches platform_credentials[*].api_key)
 *   - `platform_credentials` — array of provider credentials
 *   - `remote_hosts` — SSH host list (also leaks `ssh_*` keys transitively)
 *   - `token` — auth tokens / feishu webhook template variables
 *   - `webhook` — feishu webhook URL surface
 */
import { describe, it, expect } from "vitest";
import type { UserSettings } from "$lib/types";
import { buildPersonalProfileExport } from "../personal-export";

function makeSettingsWithSecrets(): UserSettings {
  return {
    default_agent: "claude",
    default_model: "sonnet",
    allowed_tools: ["Read", "Write"],
    provider_mode: "platform",
    auth_mode: "platform",
    anthropic_api_key: "sk-secret-123",
    anthropic_base_url: "https://api.example.test",
    auth_env_var: "ANTHROPIC_API_KEY",
    permission_mode: "default",
    keybinding_overrides: [],
    remote_hosts: [
      {
        name: "prod",
        host: "prod.example.test",
        user: "deploy",
        port: 22,
        key_path: "/Users/leak/.ssh/id_rsa",
        forward_api_key: true,
      },
    ],
    platform_credentials: [
      {
        platform_id: "github",
        api_key: "ghp_x",
        name: "personal",
      },
    ],
    active_platform_id: "github",
    ui_zoom: 1.25,
    onboarding_completed: true,
    notifications_enabled: true,
    feishu_webhook_url: "https://hooks.feishu.test/secret-token-route",
    feishu_webhook_enabled: true,
    feishu_webhook_triggers: ["run.completed"],
    feishu_webhook_template: "token: ${token}",
    default_session_mode: "worktree",
    auto_commit_on_complete: true,
    auto_pr_on_complete: false,
    auto_cleanup_worktree: true,
    user_display_name: "  Alex Doe  ",
    user_handle: "alex",
    user_email: "alex@example.test",
    user_role: "engineer",
    user_timezone: "Asia/Shanghai",
    updated_at: "2026-06-28T13:00:00.000Z",
  };
}

const FORBIDDEN_SUBSTRINGS = [
  "sk-secret-123",
  "ghp_x",
  "anthropic_api_key",
  "api_key",
  "platform_credentials",
  "remote_hosts",
  "token",
  "webhook",
  "key_path",
  "id_rsa",
] as const;

describe("buildPersonalProfileExport", () => {
  it("serializes only the whitelisted schema and metadata", () => {
    const dto = buildPersonalProfileExport(makeSettingsWithSecrets(), {
      runs7d: 12,
      skillCount: 4,
      providerCount: 2,
    });

    expect(dto.schema).toBe("miwarp.personal-profile/v1");
    expect(typeof dto.exportedAt).toBe("string");
    expect(Number.isNaN(Date.parse(dto.exportedAt))).toBe(false);
    expect(dto.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("maps identity fields, trimming whitespace", () => {
    const dto = buildPersonalProfileExport(makeSettingsWithSecrets(), {
      runs7d: 0,
      skillCount: 0,
      providerCount: 0,
    });
    expect(dto.identity).toEqual({
      displayName: "Alex Doe",
      handle: "alex",
      role: "engineer",
      timezone: "Asia/Shanghai",
    });
  });

  it("maps preference fields, normalizing empties to null", () => {
    const sparse: UserSettings = {
      ...makeSettingsWithSecrets(),
      default_agent: "",
      default_model: "",
      default_session_mode: "",
      ui_zoom: undefined,
    };
    const dto = buildPersonalProfileExport(sparse, {
      runs7d: 0,
      skillCount: 0,
      providerCount: 0,
    });
    expect(dto.preferences).toEqual({
      defaultAgent: null,
      defaultModel: null,
      defaultSessionMode: null,
      uiZoom: null,
    });
  });

  it("passes through the injected statistics snapshot", () => {
    const dto = buildPersonalProfileExport(makeSettingsWithSecrets(), {
      runs7d: 7,
      skillCount: 3,
      providerCount: 1,
    });
    expect(dto.statistics).toEqual({
      runs7d: 7,
      skillCount: 3,
      providerCount: 1,
    });
  });

  it("falls back to zero stats when omitted", () => {
    const dto = buildPersonalProfileExport(makeSettingsWithSecrets());
    expect(dto.statistics).toEqual({
      runs7d: 0,
      skillCount: 0,
      providerCount: 0,
    });
  });

  it("coerces non-finite stats to zero (preserves finite negatives)", () => {
    const dto = buildPersonalProfileExport(makeSettingsWithSecrets(), {
      runs7d: Number.NaN,
      skillCount: Number.POSITIVE_INFINITY,
      providerCount: -1,
    });
    expect(dto.statistics.runs7d).toBe(0);
    expect(dto.statistics.skillCount).toBe(0);
    expect(dto.statistics.providerCount).toBe(-1);
  });

  it("never serializes credential-shaped fields from UserSettings", () => {
    const dto = buildPersonalProfileExport(makeSettingsWithSecrets(), {
      runs7d: 0,
      skillCount: 0,
      providerCount: 0,
    });
    const serialized = JSON.stringify(dto);
    for (const forbidden of FORBIDDEN_SUBSTRINGS) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("does not leak secrets when settings contain extra platform credentials", () => {
    const s = makeSettingsWithSecrets();
    s.platform_credentials = [
      {
        platform_id: "anthropic",
        api_key: "sk-secret-123",
        name: "primary",
      },
      {
        platform_id: "openai",
        api_key: "sk-openai-leak-9999",
        name: "backup",
      },
    ];
    const dto = buildPersonalProfileExport(s, {
      runs7d: 0,
      skillCount: 0,
      providerCount: 0,
    });
    const serialized = JSON.stringify(dto);
    expect(serialized).not.toContain("sk-secret-123");
    expect(serialized).not.toContain("sk-openai-leak-9999");
    expect(serialized).not.toContain("platform_credentials");
    expect(serialized).not.toContain("api_key");
  });

  it("produces only the keys defined on PersonalProfileExportDto", () => {
    const dto = buildPersonalProfileExport(makeSettingsWithSecrets(), {
      runs7d: 1,
      skillCount: 1,
      providerCount: 1,
    });
    expect(Object.keys(dto).sort()).toEqual(
      ["exportedAt", "identity", "preferences", "schema", "statistics"].sort(),
    );
    expect(Object.keys(dto.identity).sort()).toEqual(
      ["displayName", "handle", "role", "timezone"].sort(),
    );
    expect(Object.keys(dto.preferences).sort()).toEqual(
      ["defaultAgent", "defaultModel", "defaultSessionMode", "uiZoom"].sort(),
    );
    expect(Object.keys(dto.statistics).sort()).toEqual(
      ["providerCount", "runs7d", "skillCount"].sort(),
    );
  });
});
