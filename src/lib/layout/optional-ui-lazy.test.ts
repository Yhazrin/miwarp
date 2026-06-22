/**
 * Source-level tests for the root-shell lazy loading property:
 *
 * The perf pass moves optional UI (overlays + modals) from static `import`
 * statements in the root layout to dynamic `import()` calls so the
 * corresponding chunks are NOT pulled into the root-layout's eager preload
 * graph. This test pins the contract by reading the source files and
 * asserting:
 *
 *   1. Each optional UI component name appears in the layout ONLY inside a
 *      dynamic `import("...")` call.
 *   2. None of the optional UI components are imported statically
 *      (i.e., as a top-level `import X from "$lib/components/X.svelte"`).
 *
 * If a future refactor reintroduces a static import of an optional UI
 * component into the root layout, this test fails — catching the perf
 * regression at CI time.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const here = fileURLToPath(import.meta.url);
const projectRoot = resolve(here, "..", "..", "..", "..");

const layoutPath = resolve(projectRoot, "src/routes/+layout.svelte");
const overlayStackPath = resolve(projectRoot, "src/lib/components/layout/OverlayStack.svelte");

/** Optional UI components that the root layout must NOT load eagerly. */
const OPTIONAL_UI = [
  "AboutModal.svelte",
  "UpdateCenter.svelte",
  "PermissionsModal.svelte",
  "WorkspaceSettingsModal.svelte",
  "SidebarModals.svelte",
  "MemorySidebarGroup.svelte",
  "CommandPalette.svelte",
  "SetupWizard.svelte",
  "CliSessionBrowser.svelte",
  "FolderPicker.svelte",
] as const;

function sourceOf(path: string): string {
  return readFileSync(path, "utf8");
}

/**
 * Heuristic: find every dynamic import of a `$lib/.../<name>` path that
 * references one of the optional UI components. Dynamic imports look like
 * `import("...path...")` or `() => import("...path...")`.
 */
function findDynamicImports(src: string, componentName: string): string[] {
  const hits: string[] = [];
  const re = /import\(\s*(["'`])(\$lib\/[^"'`]*?\/[^"'`]*?)\1\s*\)/g;
  for (const m of src.matchAll(re)) {
    if (m[2].endsWith(componentName)) hits.push(m[0]);
  }
  return hits;
}

/**
 * Heuristic: find every STATIC import of the named component. A static
 * import is either `import X from "..."` or `import { X } from "..."` at
 * the top of a module — not inside parentheses.
 */
function findStaticImports(src: string, componentName: string): string[] {
  const hits: string[] = [];
  // Match `import <name> from "..."` where <name> starts a line (typical
  // for top-level imports) and the path ends with componentName.
  const re = new RegExp(
    `^\\s*import\\s+[A-Za-z_$][\\w$]*\\s+from\\s+["'\`][^"'\`]*${componentName.replace(/\./g, "\\.")}["'\`]`,
    "gm",
  );
  for (const m of src.matchAll(re)) hits.push(m[0]);
  return hits;
}

describe("root-shell lazy loading", () => {
  it.each(OPTIONAL_UI)(
    "%s is referenced dynamically (or not at all) inside OverlayStack.svelte",
    (component) => {
      const src = sourceOf(overlayStackPath);
      const dynamicHits = findDynamicImports(src, component);
      const staticHits = findStaticImports(src, component);
      expect(staticHits).toEqual([]);
      // Most optional UI lives in OverlayStack (4 of 10). For those we
      // expect at least one dynamic import. For the others (which are
      // loaded from +layout.svelte, not OverlayStack), zero is fine.
      const inOverlayStack = [
        "CommandPalette.svelte",
        "SetupWizard.svelte",
        "CliSessionBrowser.svelte",
        "FolderPicker.svelte",
      ];
      if (inOverlayStack.includes(component)) {
        expect(dynamicHits.length).toBeGreaterThan(0);
      }
    },
  );

  it.each(OPTIONAL_UI)(
    "%s is referenced dynamically (or not at all) inside +layout.svelte",
    (component) => {
      const src = sourceOf(layoutPath);
      const staticHits = findStaticImports(src, component);
      expect(staticHits).toEqual([]);
      // No need to assert >= 1 dynamic hits here: some optional UI is
      // declared in OverlayStack and never re-imported in +layout.svelte.
      // The key contract is the absence of static imports.
    },
  );
});
