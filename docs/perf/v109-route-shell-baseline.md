# v1.0.9 Route / Shell Loading — Production Baseline

> Tooling: `vite build` (SvelteKit adapter-static, manualChunks for codemirror / xterm)
> Measurement method: parse `build/index.html` `modulepreload` list and `.svelte-kit/output/client/.vite/manifest.json`
> Bundle proxy (gzipped bytes on disk). Real p50/p95 TTI / LCP on macOS WebView is a separate harness — this document tracks **eager JS shipped before the first user interaction**.

## Root layout (`nodes/0.js`) before / after

| Metric | Before (`6192017d`) | After (`perf/v109-route-shell-loading`) | Delta |
|--------|---------------------|------------------------------------------|-------|
| Raw bytes | 259 591 | 122 833 | **−136 758 (−52.7 %)** |
| Gzipped | 75 730 | 36 911 | **−38 819 (−51.3 %)** |
| Eager imports | 39 | 38 | −1 |
| Dynamic imports | 10 | 16 | +6 |

The 6 new dynamic imports are the 10 optional UI components listed below (folded into the 6 dynamic entries plus their transitive chunks). The 1 net eager-import delta reflects `SidebarModals` moving to dynamic while a new `theme-store` chunk was promoted in its place.

## Optional UI moved to dynamic import

All 10 are now present in `+layout.svelte`'s `dynamicImports` list (verified via `.svelte-kit/output/client/.vite/manifest.json`):

| Component | Host | Old (eager raw / gz) | New (dynamic, fetched on first open) |
|-----------|------|---------------------|----------------------------------------|
| `CommandPalette.svelte` | `OverlayStack` | bundled in `nodes/0` | dynamic chunk |
| `SetupWizard.svelte` | `OverlayStack` | bundled in `nodes/0` | dynamic chunk |
| `CliSessionBrowser.svelte` | `OverlayStack` | bundled in `nodes/0` | dynamic chunk |
| `FolderPicker.svelte` | `OverlayStack` | bundled in `nodes/0` | dynamic chunk |
| `AboutModal.svelte` | `+layout.svelte` | bundled in `nodes/0` (+ the 151 kB / 49 kB gz `markdown` chunk) | dynamic chunk |
| `UpdateCenter.svelte` | `+layout.svelte` | bundled in `nodes/0` | dynamic chunk |
| `PermissionsModal.svelte` | `+layout.svelte` | bundled in `nodes/0` | dynamic chunk |
| `WorkspaceSettingsModal.svelte` | `+layout.svelte` | bundled in `nodes/0` | dynamic chunk |
| `SidebarModals.svelte` (7 confirm dialogs) | `+layout.svelte` | bundled in `nodes/0` | dynamic chunk |
| `MemorySidebarGroup.svelte` | `+layout.svelte` | bundled in `nodes/0` | dynamic chunk |

## Single-flight loader

The `OverlayStack` slot factory and the `+layout.svelte` modal slot factory both use a `makeSlot(loader)` pattern that:

- Caches the in-flight promise so re-opens during the first import do not stack concurrent imports.
- Records a human-readable error and shows `t("overlay_loadFailed", { name })` if the import fails.
- Resolves to a stable component reference after the first success — re-opens are free.

The team subscription factory (`src/lib/layout/team-subscription.svelte.ts`) follows the same single-flight contract for `team-update` / `task-update` listeners + poll: `dispose()` tears down both, is idempotent, and concurrent subscriptions each get their own unlisten.

## Verification commands

```bash
pnpm build
cat .svelte-kit/output/client/.vite/manifest.json \
  | python3 -c "import json,sys; m=json.load(sys.stdin); print(m['.svelte-kit/generated/client-optimized/nodes/0.js'])"
```

```
