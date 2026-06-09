# Changelog

All notable changes to MiWarp will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.7] - 2026-06-09

### Added
- Settings: new first-level **Theme** tab (split from Appearance). Theme picker
  and the light / dark / system mode toggle live in their own first-level
  tab; Appearance keeps language, UI zoom, sidebar/display toggles, CLI auto-sync.
- Theme: system-follow mode. When set to "system", MiWarp subscribes to
  `prefers-color-scheme` at the store level (`$effect.root`), so the app
  keeps following OS theme changes even when the Settings tab is closed.

### Changed
- **Theme system refactor**: each theme is now one design with light and
  dark as its two renderings. The picker shows 12 themes (down from 24);
  the mode toggle is separate. Changing the mode no longer resets the
  selected theme.
  - 12 themes now have both light and dark CSS variants. Before, 7 themes
    (midnight / ocean / dracula / nord / carbonPink / deepSeaMilk /
    auroraLime) had dark only, and 2 themes (auroraPomelo /
    pomegranateMist) had light only.
  - Old `*-light` localStorage theme IDs auto-migrate to the new
    `(base, mode)` pair via `_migrateThemeId` — no user action needed.
  - i18n: collapsed `theme_codexDark` / `theme_codexLight` /
    `theme_morandiLight` / `theme_devPreviewLight` into a single
    `theme_codex` key.
- **Forward-to-session dialog** redesign from "file-path list" to
  "session target selector":
  - Each row shows three layered lines: title (name → prompt first line →
    short id, never the full UUID) / last message preview / meta
    (updated time · message count · model).
  - Group header: short project name (primary) + full path (auxiliary,
    shown only once per group, not on every row).
  - Footer: explicit action bar — `Cancel` + `Forward to this session`.
    Enter still works as a keyboard shortcut but no longer replaces the
    primary button.
  - Selected / hover states use system standards:
    `bg-accent text-accent-foreground` / `hover:bg-accent/50`.
  - Search uses the system `<Input>` component; footer uses the system
    `<Button variant="ghost|default">` component.
- Dialog chrome: removed all `elevation-3` / `shadow-lg` from dialogs
  and menus. Backdrop blur bumped from `2xl` to `3xl`.
- MiDialog: `size="lg/md/sm"` titles are now a proper header bar
  (`px-6 py-4 border-b shrink-0`). Previously they sat at the dialog's
  top-left edge with zero padding.

### Performance
- New backend command `list_runs_lite` reads only `meta.json` per run
  and skips the `summarize_events` events.jsonl scan. The forward-to-
  session dialog now uses it. 200+ runs load instantly instead of several
  seconds. Falls back to `list_runs` on failure.
- Dark-mode sidebar: native glass background opacity bumped to 0.92 to
  prevent the wallpaper from bleeding through.

### Fixed
- **Windows build**: `window-vibrancy 0.6` `apply_acrylic` /
  `apply_blur` second arg is `Option<(u8, u8, u8, u8)>`; the previous
  `Some("#00000000")` string didn't type-check. Changed to
  `Some((0, 0, 0, 0))` (fully transparent black, same intent).
- **Windows + Linux build**: `window_effect::apply()`'s `material`
  parameter is only consulted on macOS but Rust's unused-variable lint
  fired on the other two targets under `clippy -D warnings`. Added
  function-level `#[allow(unused_variables)]`.
- i18n: added 5 missing keys —
  `settings_mobile_qrAlt`, `settings_mobile_linkCopied`,
  `settings_shortcuts_inputAppDesc`,
  `settings_shortcuts_cliKeybindingsFile`,
  `settings_shortcuts_cliKeybindingsFileWin` — plus the new forward
  dialog keys (`chat_forwardSelectedLabel`, `chat_forwardNoSelection`,
  `chat_forwardCancel`, `chat_forwardConfirm`,
  `chat_forwardMessagesMeta`).

### Tests
- Updated `registry.test.ts` to reflect that `theme` is now its own
  first-level tab (no longer an alias for `appearance`): 10 tabs,
  display group is `["appearance", "theme"]`, `LEGACY_TAB_MAP` covers
  9 legacy IDs, `resolveTabId("theme") === "theme"`.

## [1.0.6] - 2026-06-08

### Added
- **Welcome screen**: workspace selection flow when no folder is open.
- **Native sidebar glass** (macOS vibrancy / Windows mica) over the full
  left sidebar. Brighter on light themes, darker on dark themes, with
  separate native / fallback tinting.
- **macOS private API** enabled so the window's `transparent` flag
  actually takes effect.
- **Status bar**: pinned center for the 4 chrome buttons; reveal
  spacing follows the reveal fade-in animation. Reveal uses ease-in
  on retract, ease-out on expand.
- **Mobile pairing**: QR-code sheet and connection dialog.
- **Inspector**: P3 + P4 wrap-up — inspector integration and TOC anchor
  fix.
- **Session state machine**: added `stale_cached` and `syncing` states
  with i18n; corrected the `cached` phase lazy-resume logic.

### Changed
- **Sidebar theming** is now mode-aware: bright tint on light themes,
  dark tint on dark themes. Wash alpha reduced from 0.72-0.88 to
  0.42-0.58.
- **Chat message layout**: agent container aligned to input edge (agent
  text flush left, user bubble flush right); copy / timestamp moved to
  the message footer; selected-text forward flow switched to the new
  forward-to-session dialog.
- **Mobile P0 fixes**: reconnect, `full_reload`, chunk loading, and
  token storage hardening.
- **Status bar**: hover-leave no longer causes tabs / tier-2 to flash
  out of existence; chrome stays pinned center regardless of window
  width.
- Bits UI: wrapper-ized `MiSelect` / `MiTooltip` / `MiDropdownMenu` /
  `MiAlertDialog` / `MiTabs`. Existing screens migrated to wrappers.
- Inline `Input` styling in prompt: removed the focus ring rectangle.

### Fixed
- `CliSessionBrowser` modal: removed the deep drop-shadow + triple blur
  layering that made the dialog look cheap.
- Personal avatar feature removed; `user` bubble `pr-7` dead offset
  cleaned up.
- Stability batch 2: 14 files of P0/P1 bug fixes and performance
  improvements.
- `cargo fmt` / `clippy` drift across master cleaned up.
- `/simplify` audit fixes: 3 Rust compile errors + dead code in
  `InlineToolCard` + mojibake cleanup.

### Refactor
- Split `InlineToolCard` → extracted `AskUserQuestionCard` as a child
  component.
- Split `_reduce()` into `_reduceMessage` + `_reduceTool`.
- Extracted `ReduceCtx` to `reducers/types.ts`.
- Centralized `localStorage` keys and window event names into
  `storage-keys.ts` / `bus-events.ts`.
- Deduplicated types + removed dead code.

## [1.0.5] - 2026-06-06

### Changed
- v1.0.5 was a stability + repo hygiene release. Specific changes
  tracked in the
  [v1.0.4...v1.0.5 diff](https://github.com/Yhazrin/miwarp/compare/v1.0.4...v1.0.5).
