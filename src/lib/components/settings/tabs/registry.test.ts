/**
 * Unit tests for the settings tab registry.
 * Validates the single source of truth used by +page.svelte and
 * SettingsPanels.
 */
import { describe, expect, it } from "vitest";
import {
  SETTINGS_NAV_GROUPS,
  SETTINGS_TABS,
  LEGACY_TAB_MAP,
  getTab,
  resolveTabId,
  tabsByGroup,
  type SettingsTabId,
} from "./registry";

describe("settings tab registry", () => {
  describe("SETTINGS_TABS", () => {
    it("contains exactly 10 tabs", () => {
      expect(SETTINGS_TABS).toHaveLength(10);
    });

    it("has unique tab ids", () => {
      const ids = SETTINGS_TABS.map((t) => t.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("every tab references a known group", () => {
      const knownGroups = new Set(SETTINGS_NAV_GROUPS.map((g) => g.id));
      for (const tab of SETTINGS_TABS) {
        expect(knownGroups.has(tab.groupId)).toBe(true);
      }
    });

    it("every tab has non-empty iconPath + labelKey + fallbackLabel", () => {
      for (const tab of SETTINGS_TABS) {
        expect(tab.iconPath.length).toBeGreaterThan(0);
        expect(tab.labelKey.length).toBeGreaterThan(0);
        expect(tab.fallbackLabel.length).toBeGreaterThan(0);
      }
    });
  });

  describe("SETTINGS_NAV_GROUPS", () => {
    it("contains exactly 4 groups", () => {
      expect(SETTINGS_NAV_GROUPS).toHaveLength(4);
    });

    it("group ids are unique", () => {
      const ids = SETTINGS_NAV_GROUPS.map((g) => g.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe("getTab", () => {
    it("returns the matching tab for a valid id", () => {
      const tab = getTab("appearance");
      expect(tab?.id).toBe("appearance");
      expect(tab?.labelKey).toBe("settings_tab_appearance");
    });

    it("returns undefined for an unknown id", () => {
      expect(getTab("nonexistent" as SettingsTabId)).toBeUndefined();
    });
  });

  describe("tabsByGroup", () => {
    it("returns the 4 expected groups, each with the right tabs", () => {
      const grouped = tabsByGroup();
      expect(grouped.display.map((t) => t.id)).toEqual(["appearance", "theme"]);
      expect(grouped.integration.map((t) => t.id)).toEqual(["providers", "devices"]);
      expect(grouped.automation.map((t) => t.id)).toEqual([
        "shortcuts",
        "remote-hosts",
        "cli-behavior",
        "worktree",
      ]);
      expect(grouped.system.map((t) => t.id)).toEqual(["notifications", "data-debug"]);
    });

    it("every SETTINGS_TABS entry appears in exactly one group", () => {
      const grouped = tabsByGroup();
      const seen = new Set<string>();
      for (const group of Object.values(grouped)) {
        for (const tab of group) {
          expect(seen.has(tab.id)).toBe(false);
          seen.add(tab.id);
        }
      }
      expect(seen.size).toBe(SETTINGS_TABS.length);
    });
  });

  describe("LEGACY_TAB_MAP", () => {
    it("covers all 9 legacy tab ids (theme became its own first-level tab)", () => {
      const expected = [
        "general",
        "connection",
        "mobile",
        "cli-config",
        "shortcuts",
        "remote",
        "notifications",
        "debug",
        "data",
      ];
      for (const id of expected) {
        expect(LEGACY_TAB_MAP[id]).toBeDefined();
      }
    });

    it("maps every legacy id to a valid new id", () => {
      for (const [legacy, next] of Object.entries(LEGACY_TAB_MAP)) {
        expect(SETTINGS_TABS.some((t) => t.id === next)).toBe(true);
        expect(typeof legacy).toBe("string");
      }
    });
  });

  describe("resolveTabId", () => {
    it("returns 'appearance' for null/undefined", () => {
      expect(resolveTabId(null)).toBe("appearance");
      expect(resolveTabId(undefined)).toBe("appearance");
      expect(resolveTabId("")).toBe("appearance");
    });

    it("returns the new id unchanged when valid", () => {
      expect(resolveTabId("providers")).toBe("providers");
      expect(resolveTabId("data-debug")).toBe("data-debug");
    });

    it("maps legacy id to new id", () => {
      expect(resolveTabId("general")).toBe("appearance");
      expect(resolveTabId("connection")).toBe("providers");
      expect(resolveTabId("mobile")).toBe("devices");
      expect(resolveTabId("debug")).toBe("data-debug");
      // 'theme' used to be an alias for 'appearance'; after the refactor
      // it became its own first-level tab, so old URLs that happened to
      // land on a valid 'theme' id now resolve to that tab directly.
      expect(resolveTabId("theme")).toBe("theme");
    });

    it("falls back to appearance for garbage input", () => {
      expect(resolveTabId("???")).toBe("appearance");
      expect(resolveTabId("not-a-tab")).toBe("appearance");
    });
  });
});
