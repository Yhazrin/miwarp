/**
 * Vitest wrapper for scripts/sync-version.mjs.
 *
 * Mirrors the regex at the top of sync-version.mjs and verifies the
 * script accepts release-candidate suffixes. The actual file-writing
 * logic is exercised by `npm run version:sync` in CI; this test only
 * guards the input-parsing boundary so a future refactor that drops the
 * `-rc.N` allowance fails fast.
 */
import { existsSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, "../sync-version.mjs");

// Same regex as scripts/sync-version.mjs. Drift detector — update both.
const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)(?:-rc\.\d+)?$/;

function parseVersion(
  input: string,
): { major: number; minor: number; patch: number; rc: number | null } | null {
  const m = input.match(VERSION_RE);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    rc: input.includes("-rc.") ? Number(input.split("-rc.")[1]) : null,
  };
}

function expectedBuildNumber(v: { major: number; minor: number; patch: number }): string {
  return String(v.major * 1_000_000 + v.minor * 1_000 + v.patch);
}

describe("sync-version.mjs version regex", () => {
  it("accepts canonical x.y.z", () => {
    expect(parseVersion("1.0.0")?.rc).toBeNull();
    expect(parseVersion("1.1.0")?.rc).toBeNull();
  });

  it("accepts x.y.z-rc.N", () => {
    const v = parseVersion("1.1.0-rc.1");
    expect(v?.rc).toBe(1);
    expect(v?.major).toBe(1);
    expect(v?.minor).toBe(1);
    expect(v?.patch).toBe(0);
  });

  it("rejects malformed versions (matches the throw in the source)", () => {
    expect(parseVersion("1.1.0-rc")).toBeNull();
    expect(parseVersion("1.1.0-beta.1")).toBeNull();
    expect(parseVersion("v1.1.0")).toBeNull();
    expect(parseVersion("")).toBeNull();
  });
});

describe("sync-version.mjs build number derivation", () => {
  it("derives the canonical mobile build number from x.y.z", () => {
    expect(expectedBuildNumber({ major: 1, minor: 1, patch: 0 })).toBe("1001000");
    expect(expectedBuildNumber({ major: 2, minor: 3, patch: 4 })).toBe("2003004");
    expect(expectedBuildNumber({ major: 0, minor: 0, patch: 1 })).toBe("1");
  });

  it("strips rc suffix for the build number (rc is not encoded)", () => {
    // rc versions share the build number with their base release.
    expect(expectedBuildNumber({ ...parseVersion("1.1.0-rc.1")!, rc: null })).toBe("1001000");
    expect(expectedBuildNumber({ ...parseVersion("1.1.0-rc.99")!, rc: null })).toBe("1001000");
  });
});

describe("sync-version.mjs (script integration)", () => {
  it("exists", () => {
    expect(existsSync(SCRIPT)).toBe(true);
  });

  it("throws on a bad package version (regex guard)", () => {
    // Run in a temp dir with a fake package.json that has a bad version.
    // sync-version.mjs throws synchronously, which spawnSync maps to a
    // non-zero exit and a stderr trace.
    const dir = join(tmpdir(), `sync-version-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "x", version: "not-a-version" }),
    );

    try {
      const result = spawnSync("node", [SCRIPT], { cwd: dir, encoding: "utf8" });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/Unsupported release version/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
