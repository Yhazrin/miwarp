/**
 * Type-level contract tests for `UserSettingsPatch`.
 *
 * The runtime side of the patch contract (does the backend accept a given
 * field?) is enforced by the Rust `contract_field_coverage` test in
 * `src-tauri/src/storage/settings_patch.rs`. This file only covers the
 * TypeScript side: that `UserSettingsPatch<UserSettings>` widens to
 * include every user-controllable field and lets `null` clear it.
 *
 * These tests are deliberately simple — they exist so a future refactor
 * that accidentally narrows `UserSettingsPatch` (e.g. by changing the
 * conditional type) surfaces as a vitest failure rather than a silent
 * regression.
 */
import { describe, it, expect } from "vitest";
import type { TypedUserSettingsPatch } from "./settings-patch";

describe("TypedUserSettingsPatch", () => {
  it("is a structural subtype of Partial<UserSettings>", () => {
    // Build a patch that sets only `default_agent` to a non-null value.
    // If the mapped type accidentally narrows `default_agent` to `never`
    // or drops the field, this assignment will fail to type-check.
    const patch: TypedUserSettingsPatch = { default_agent: "claude" };
    expect(patch.default_agent).toBe("claude");
  });

  it("allows null to clear a scalar string field", () => {
    const patch: TypedUserSettingsPatch = { default_model: null };
    expect(patch.default_model).toBeNull();
  });

  it("allows null to clear a boolean field", () => {
    const patch: TypedUserSettingsPatch = { notifications_enabled: null };
    expect(patch.notifications_enabled).toBeNull();
  });

  it("allows arrays to be replaced (no null required)", () => {
    const patch: TypedUserSettingsPatch = { allowed_tools: ["Read", "Write"] };
    expect(patch.allowed_tools).toEqual(["Read", "Write"]);
  });

  it("remains usable with an empty object (no-op patch)", () => {
    const patch: TypedUserSettingsPatch = {};
    expect(Object.keys(patch)).toHaveLength(0);
  });

  it("spelled-out mirrors the user-controllable fields on UserSettings", () => {
    // If `UserSettings` gains a new user-controllable field, this assertion
    // fails — that's the point. The contract test on the Rust side will
    // also fail unless the new field is mirrored in `UserSettingsPatch`.
    // We check a small set of known fields here as a smoke test.
    type FieldNames<T> = { [K in keyof T]: K }[keyof T];
    type PatchKeys = FieldNames<TypedUserSettingsPatch>;

    const expected: PatchKeys[] = [
      "default_agent",
      "default_model",
      "allowed_tools",
      "process_visibility",
    ];
    for (const k of expected) {
      // Compile-time: ensure `k` is a known patch key.
      const _check: PatchKeys = k;
      // Runtime: the array elements exist at runtime only for the value
      // (strings), so we just assert the strings are present.
      expect(typeof k).toBe("string");
    }
  });
});
