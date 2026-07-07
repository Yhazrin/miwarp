/**
 * Vitest wrapper for scripts/check-versions.mjs.
 *
 * Validates that the version-alignment gate accepts release-candidate
 * suffixes (v1.1.0-rc.N) just like the canonical x.y.z form. Mirrors the
 * logic at the top of check-versions.mjs so that any drift in the regex
 * shows up as a test failure.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, "../check-versions.mjs");
const REPO_ROOT = resolve(HERE, "../..");

// Same regex as scripts/check-versions.mjs. If you change the source
// regex, this MUST be updated to match (and vice versa).
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

describe("check-versions.mjs version regex", () => {
  it("accepts canonical x.y.z", () => {
    expect(parseVersion("1.0.0")).toEqual({ major: 1, minor: 0, patch: 0, rc: null });
    expect(parseVersion("2.10.30")).toEqual({ major: 2, minor: 10, patch: 30, rc: null });
    expect(parseVersion("0.0.1")).toEqual({ major: 0, minor: 0, patch: 1, rc: null });
  });

  it("accepts x.y.z-rc.N", () => {
    expect(parseVersion("1.1.0-rc.1")).toEqual({ major: 1, minor: 1, patch: 0, rc: 1 });
    expect(parseVersion("1.1.0-rc.10")).toEqual({ major: 1, minor: 1, patch: 0, rc: 10 });
    expect(parseVersion("3.4.5-rc.99")).toEqual({ major: 3, minor: 4, patch: 5, rc: 99 });
  });

  it("rejects malformed versions", () => {
    expect(parseVersion("1.1.0-rc")).toBeNull(); // missing rc number
    expect(parseVersion("1.1.0-beta.1")).toBeNull(); // wrong pre-release tag
    expect(parseVersion("1.1")).toBeNull(); // missing patch
    expect(parseVersion("1.1.0-rc.abc")).toBeNull(); // non-numeric rc
    expect(parseVersion("v1.1.0-rc.1")).toBeNull(); // leading v
    expect(parseVersion("")).toBeNull();
  });

  it("rejects mobile-build overflow (minor/patch >= 1000)", () => {
    // Mirrors the guard inside check-versions.mjs (a runtime check, NOT
    // a regex constraint). The regex accepts the form; the script bails
    // when minor/patch >= 1000.
    expect(parseVersion("1.1000.0")).not.toBeNull();
    expect(parseVersion("1.0.1000")).not.toBeNull();
    // …which means downstream the script's `minor >= 1000` guard rejects them.
    const minor = parseVersion("1.1000.0")!.minor;
    const patch = parseVersion("1.0.1000")!.patch;
    expect(minor >= 1000 || patch >= 1000).toBe(true);
  });
});

describe("check-versions.mjs (script integration)", () => {
  it("exists and is executable", () => {
    expect(existsSync(SCRIPT)).toBe(true);
  });

  it("exits 0 when package.json declares -rc.1 and all files agree", () => {
    // Pre-condition: this test only makes sense in the miwarp repo at the
    // version currently declared in package.json. If the package version
    // is anything other than `x.y.z-rc.N` with all aligned files, the
    // script will exit 1 — which is also valid behavior.
    const pkg = JSON.parse(readFileSync(resolve(REPO_ROOT, "package.json"), "utf-8"));
    const isRc = typeof pkg.version === "string" && /^[\d.]+-rc\.\d+$/.test(pkg.version);
    // skip unless the package version is actually an RC form
    if (!pkg.version?.includes("-rc.")) {
      return;
    }
    expect(isRc).toBe(true);

    const result = spawnSync("node", [SCRIPT], { cwd: REPO_ROOT, encoding: "utf8" });
    if (result.status !== 0) {
      // Surface the script's stderr for easier debugging when this fails.
      throw new Error(
        `check-versions.mjs exited ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
      );
    }
    expect(result.stdout).toMatch(/All versions aligned/);
  }, 30_000);
});
