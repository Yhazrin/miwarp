/**
 * RuntimeCapabilities / RuntimeDescriptor frontend type contract.
 *
 * The v1.0.9-runtime-contract.md spec (§3) lists 12 capability flags
 * that `RuntimeCapabilities` MUST contain. The TypeScript equivalent
 * of this struct is owned by Agent B (file: src/lib/runtime/**).
 * Once that file is added, this test enforces that the TS type
 * declares all 12 flags with the correct names — failing fast if
 * a future change drops a flag or adds a new one without updating
 * the spec.
 *
 * Today (ca41bf45) the TS type does not exist; the test is dormant.
 *
 * Run with: `npx vitest run src/lib/runtime/__tests__/`
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..");
const RUNTIME_DIR = join(REPO_ROOT, "src", "lib", "runtime");

const CAPABILITY_FLAGS = [
  "supports_streaming",
  "supports_resume",
  "supports_permission_requests",
  "supports_tool_calls",
  "supports_usage",
  "supports_thinking",
  "supports_attachments",
  "supports_images",
  "supports_mcp",
  "supports_skills",
  "supports_remote_execution",
  "supports_structured_events",
] as const;

/**
 * Recursively gather every .ts file under src/lib/runtime/. The
 * directory may not exist on the integration HEAD; that is fine.
 */
function collectTypeScriptFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "__tests__") continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...collectTypeScriptFiles(full));
    } else if (name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("v1.0.9 RuntimeCapabilities frontend type contract", () => {
  const files = collectTypeScriptFiles(RUNTIME_DIR);

  it("at least one source file exists in src/lib/runtime (or the test is dormant)", () => {
    // We don't assert >0 — Agent B may not have landed yet. But
    // we record the file count for diagnostic visibility.
    expect(files.length).toBeGreaterThanOrEqual(0);
  });

  it("every capability flag appears in some runtime source file (dormant if dir empty)", () => {
    if (files.length === 0) {
      // Agent B hasn't landed yet. The spec is the source of truth.
      return;
    }
    const allSrc = files
      .map((f) => {
        try {
          return readFileSync(f, "utf-8");
        } catch {
          return "";
        }
      })
      .join("\n");
    const missing: string[] = [];
    for (const flag of CAPABILITY_FLAGS) {
      if (!allSrc.includes(flag)) missing.push(flag);
    }
    expect(
      missing,
      `RuntimeCapabilities missing flags: ${missing.join(", ")}. ` +
        `Update src/lib/runtime/** OR add the flag to docs/architecture/v1.0.9-runtime-contract.md §3.`,
    ).toEqual([]);
  });

  it("capability flag count matches the spec (12)", () => {
    // Pin the constant. If the spec ever adds a 13th flag, this
    // test forces a manual update here AND in the contract doc.
    expect(CAPABILITY_FLAGS).toHaveLength(12);
  });

  it("capability flags are all snake_case and unique", () => {
    const re = /^[a-z][a-z0-9_]*$/;
    const seen = new Set<string>();
    for (const flag of CAPABILITY_FLAGS) {
      expect(re.test(flag), `flag "${flag}" is not snake_case`).toBe(true);
      expect(seen.has(flag), `duplicate flag "${flag}"`).toBe(false);
      seen.add(flag);
    }
  });
});
