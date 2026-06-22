/**
 * Source-level redaction-manifest contract check.
 *
 * Walks the diagnostics writer source (when Agent D lands it) and
 * asserts the redaction manifest declares all required fields.
 * Used by both the Vitest unit test (`e2e/__tests__/`) and the
 * Playwright e2e spec (`e2e/golden-path.spec.ts`).
 *
 * Why source-level (not a runtime assertion)? The diagnostics
 * writer runs at the IPC boundary, and a regression in the
 * redaction manifest is invisible to the e2e flow unless we
 * actually run the export. For the v1.0.9 release gate, a
 * source-level check is enough — when the writer lands, this
 * function starts validating the manifest; until then, it
 * returns `present: false` and the spec / test log a "dormant"
 * annotation.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Walks the diagnostics writer source and asserts the redaction
 * manifest declares all required fields.
 *
 * @returns { present, missing, message } — `present` is `false`
 *   when no diagnostics writer exists yet (dormant).
 */
export function contractCheck(): {
  present: boolean;
  missing: string[];
  message: string;
} {
  const REPO = join(__dirname, "..");
  const candidates = [
    join(REPO, "src-tauri", "src", "diagnostics", "writer.rs"),
    join(REPO, "src-tauri", "src", "diagnostics", "mod.rs"),
    join(REPO, "src-tauri", "src", "commands", "diagnostics.rs"),
  ];
  const files = candidates.filter((p) => existsSync(p));
  // Walk src-tauri/src/diagnostics/ recursively (when it exists)
  // to find any .rs file.
  const alt = join(REPO, "src-tauri", "src", "diagnostics");
  if (existsSync(alt) && statSync(alt).isDirectory()) {
    for (const name of readdirSync(alt)) {
      const full = join(alt, name);
      if (statSync(full).isFile() && name.endsWith(".rs")) {
        files.push(full);
      }
    }
  }
  if (files.length === 0) {
    return {
      present: false,
      missing: [],
      message: "diagnostics writer not landed yet (dormant contract check)",
    };
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
  // The manifest must list every redacted field by name.
  // v1.0.9 baseline: prompt text, api_key, env secrets.
  const required = ["prompt", "api_key", "authorization"];
  const missing = required.filter((k) => !allSrc.toLowerCase().includes(k));
  return {
    present: true,
    missing,
    message:
      missing.length === 0
        ? "redaction manifest declares all required fields"
        : `redaction manifest is missing: ${missing.join(", ")}`,
  };
}
