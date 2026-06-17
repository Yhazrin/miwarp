# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## What is MiWarp

MiWarp is a Tauri v2 desktop app that wraps AI coding CLIs (Codex, Codex) with a visual chat interface, session management, and activity monitoring. Local-first — all data stored at `~/.miwarp/`.

## Repository Boundaries

This repository contains multiple app targets. Do not assume every UI request targets the desktop app.

| Target | Path | Stack |
|--------|------|-------|
| Desktop app | `src/`, `src-tauri/` | Tauri v2 + Svelte 5 + Rust |
| iOS app | `apps/ios/MiWarpMobile/` | Native SwiftUI app + Live Activity extension |
| Android app | `apps/android/` | Native Android app |
| Mobile docs | `docs/mobile/` | Architecture, protocol, security, design system |

### iOS Work Boundary

When the user mentions iOS, iPad, iPhone, SwiftUI, Dynamic Island, Live Activity, mobile native UI, or asks for iPad/iPhone layout changes, the default work target is **the native iOS package** at `apps/ios/MiWarpMobile/`.

Before touching desktop files for an iOS/mobile request, verify the request explicitly requires desktop/web/Tauri changes. Otherwise:

- Do not edit desktop Svelte files under `src/` for iPad/iPhone native UI work.
- Do not edit Rust/Tauri files under `src-tauri/` unless the mobile app needs a desktop WebSocket/RPC/backend change.
- First inspect `apps/ios/MiWarpMobile/MiWarpMobile/DesignSystem/`, the relevant `Features/` screen, and `docs/mobile/mobile-design-system.md`.
- Keep iPad/iPhone UI work aligned with the desktop visual language by mapping through the native design system (`MWColors`, `MWTheme`, `MWTypography`, `MWComponents`, `MWAdaptiveLayout`) instead of copying desktop CSS/Svelte.
- Live Activity and Dynamic Island work lives in `apps/ios/MiWarpMobile/MiWarpLiveActivityExtension/` plus shared models under `MiWarpMobile/LiveActivities/`.

## Common Commands

```bash
npm install              # Install dependencies
npm run tauri dev        # Dev mode (Vite + Tauri hot-reload)
npm test                 # Run tests (Vitest)
npm run test:watch       # Tests in watch mode
npm run lint             # ESLint
npm run lint:fix         # ESLint auto-fix
npm run format           # Prettier format
npm run format:check     # Prettier check (CI uses this)
npm run check            # Svelte type check (svelte-check)
npm run i18n:check       # i18n key alignment + placeholder validation
npm run rust:check       # cargo fmt --check + cargo clippy
npm run verify           # Full CI gate: lint + format + check + i18n + test + build + rust
npm run version:check    # package.json / tauri / cargo version alignment
npm run version:sync     # Sync version from package.json to tauri + cargo
npm run release:notes    # Markdown release notes from commits since last tag
npm run fix              # Auto-fix everything: lint:fix + format + cargo fmt

# Rust backend only
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
RUST_LOG=debug cargo tauri dev   # Debug logging for Rust

# iOS native app only
cd apps/ios/MiWarpMobile
xcodebuild -project MiWarpMobile.xcodeproj -scheme MiWarpMobile -destination 'platform=iOS Simulator,name=iPhone 16' build
xcodebuild -project MiWarpMobile.xcodeproj -scheme MiWarpMobile -destination 'platform=iOS Simulator,name=iPad Pro 11-inch (M4)' build
xcodebuild -project MiWarpMobile.xcodeproj -scheme MiWarpMobile -destination 'platform=iOS Simulator,name=iPhone 16' test
```

A pre-commit hook (`.githooks/pre-commit`) runs: Rust fmt, Prettier, ESLint, and svelte-check on staged files. Setup via `npm run prepare` (runs automatically on `npm install`).

## Architecture

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Tauri v2 (Rust backend + WebView) |
| Frontend | Svelte 5 + SvelteKit (adapter-static) |
| Styling | Tailwind CSS v3 + CSS variables |
| Terminal | xterm.js |
| Testing | Vitest |

### Frontend (`src/`)

- **Routes** (`src/routes/`): SvelteKit pages — `chat`, `explorer`, `memory`, `history`, `usage`, `settings`, `plugins`, `workflow`, `scheduled-tasks`, `teams`, `skills`, `release-notes`, `browser`, `multi-agent`
- **Root layout** (`src/routes/+layout.svelte`): sidebar with project folder tree, icon rail, team/chat tabs, resize handle, theme/locale toggles. All pages share this shell.
- **Components** (`src/lib/components/`): reusable Svelte 5 components
- **Stores** (`src/lib/stores/`): reactive state using Svelte 5 `$state`/`$derived` runes (NOT legacy Svelte stores). `SessionStore` is the primary chat session state manager. `TeamStore`, `KeybindingStore`, `memoryStore`, `EventMiddleware` are other key stores.
- **Transport** (`src/lib/transport/`): abstraction over Tauri IPC vs WebSocket. `getTransport()` returns `TauriTransport` in desktop or `WsTransport` in browser. All frontend→backend calls go through this.
- **API layer** (`src/lib/api.ts`): typed wrappers around `invoke<T>(cmd, args)` — the single entry point for all Tauri commands. Imports types from `src/lib/types`.
- **i18n** (`src/lib/i18n/`): custom lightweight reactive runtime. `t(key, params?)` for translations, `initLocale()` in root layout, `switchLocale()` for runtime switching. Messages in `messages/en.json` and `messages/zh-CN.json`.

### Backend (`src-tauri/src/`)

- **Agent system** (`src-tauri/src/agent/`): `session_actor.rs` owns one CLI session's lifecycle (process, stdin/stdout, protocol state). `turn_engine.rs` manages turn phases and timeouts. `claude_protocol.rs` / `pipe_parser.rs` handle stream-JSON parsing. `spawn.rs` launches CLI processes.
- **Commands** (`src-tauri/src/commands/`): Tauri command handlers (one module per domain: `session`, `chat`, `runs`, `settings`, `files`, `git`, `mcp`, `teams`, `plugins`, etc.)
- **Storage** (`src-tauri/src/storage/`): local persistence at `~/.miwarp/` — run history, settings, events, CLI config, prompt index, favorites, MCP registry, community skills, changelog
- **Web server** (`src-tauri/src/web_server/`): embedded Axum server for browser-based access (WebSocket relay, auth, static files)
- **Scheduler** (`src-tauri/src/scheduler/`): cron-based scheduled task runner
- **Hooks** (`src-tauri/src/hooks/`): Tauri event hooks and team file watcher

### iOS (`apps/ios/MiWarpMobile/`)

- **Project**: `MiWarpMobile.xcodeproj` generated from `project.yml`, Swift 5.9, iOS 17 deployment target for the Xcode project.
- **SwiftPM package**: `Package.swift` exposes the app code as `MiWarpMobile` for package-aware tooling.
- **App entry** (`MiWarpMobile/App/`): SwiftUI app and navigation router.
- **Core** (`MiWarpMobile/Core/`): WebSocket/RPC client, connection store, keychain, event reducer, logging, models.
- **Design system** (`MiWarpMobile/DesignSystem/`): native MiWarp tokens and reusable SwiftUI components.
- **Features** (`MiWarpMobile/Features/`): Pairing, sessions, chat, artifacts, settings, and related mobile screens.
- **Live Activities** (`MiWarpMobile/LiveActivities/`, `MiWarpLiveActivityExtension/`): shared activity models plus extension UI.
- **Tests** (`MiWarpMobileTests/`): unit tests for reducers and mobile logic.

### Communication Flow

Frontend calls `invoke("command_name", args)` → transport layer → Tauri IPC → Rust command handler → storage/agent system. Real-time events flow back via Tauri's `app.emit()` (desktop) or WebSocket (browser).

Session lifecycle: `session_actor.rs` spawns a CLI child process, reads stdout line-by-line, parses stream-JSON events, stores them, and emits to the frontend. User input goes through stdin.

## Code Conventions

### Language

Always respond in Chinese (中文) unless the user writes in English. This includes explanations, summaries, and commit messages.

### Action Over Reporting

- Always make actual code changes — do NOT produce audit reports, summaries, or status documents unless explicitly asked.
- When fixing bugs, write and run the fix immediately. Never stop to summarize findings without acting first.
- If a fix doesn't work, try the next approach immediately rather than re-analyzing.

### Build & Verify

- After ANY Tauri config change (`tauri.conf.json`, `Cargo.toml`, plugins), verify the frontend is actually being rebuilt — check `beforeBuildCommand` is not empty.
- Always run `pnpm check` after Svelte file modifications.
- Always run `cargo clippy` after Rust changes.
- After multi-file refactors, run the full build pipeline before committing.

### Git Safety

- Never remove Tauri command handlers (`invoke_handler`) without verifying the frontend no longer calls them — grep for each command name first.
- When merging branches, proactively check for duplicate imports, naming collisions, and type conflicts before running the build.
- Before committing, verify staged files match intent — no auto-staged extras.
- Commit 前运行 `git diff --stat` 确认只包含预期的文件变更。
- 合并冲突解决后必须运行完整构建验证。

### 项目架构备注

- Windows 构建需要 MSVC C++ 工具链，如缺少则提醒用户安装而非反复尝试。
- `tauri.conf.json` 中的 `beforeBuildCommand` 必须正确配置以确保前端被重建。
- 变更 store 或类型定义后，必须同步更新所有引用文件。
- 修复 bug 前先运行一次完整构建确认基线状态，避免在已损坏的基础上叠加问题。

### Svelte 5 — Runes Only

Use `$state`, `$derived`, `$effect`, `$props()`, `$bindable()`. No legacy stores, no `<slot>`, no `export let`. Use `{#snippet}` + `{@render}` for component children.

### Transport Abstraction

Never import `@tauri-apps/api/*` directly in components or pages. Use `getTransport()` from `$lib/transport`. The ESLint rule `no-restricted-imports` enforces this (exception: `src/lib/transport/**`). Dynamic `import()` is OK for desktop-only features with graceful fallback.

### i18n

All user-facing strings must use `t('key')`. When adding new UI text, update both `messages/en.json` and `messages/zh-CN.json`. Run `npm run i18n:check` to validate key alignment and placeholder consistency.

To add a new locale: add entry in `src/lib/i18n/registry.ts`, create `messages/<code>.json`, add loader in `src/lib/i18n/index.svelte.ts`.

### Prettier

Double quotes, semicolons, trailing commas, 100 char print width, 2-space tabs. Svelte files use `prettier-plugin-svelte`.

### Rust

- `cargo fmt` + `cargo clippy` with zero warnings required
- Release profile: LTO, single codegen unit, strip symbols, `opt-level = "s"`
- Platform-specific deps in `Cargo.toml` via `[target.'cfg(...)'.dependencies]`

### Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `chore:`, etc.

### Branch Naming

`fix/xxx` for bug fixes, `feat/xxx` for features. Branch from `master`.

### Multi-Session Branch Isolation

When multiple Codex sessions work in the same project folder, each session **must** work on its own branch to avoid file conflicts and stale context issues. Before making any changes, create or switch to a dedicated branch (e.g. `feat/your-task`). After completing work, merge or rebase back into the target branch. Never edit files directly on `master` in a multi-session workflow.

### Parallel Development with Git Worktree

For truly parallel work on different branches without file conflicts, use `git worktree`:

```bash
git worktree add ../miwarp-feat-x feat/x   # separate directory for branch feat/x
git worktree add ../miwarp-fix-y fix/y      # another directory for branch fix/y
git worktree list                            # list all worktrees
git worktree remove ../miwarp-feat-x         # cleanup when done
```

Each worktree is an independent checkout sharing the same `.git` database. In MiWarp, each worktree directory appears as a separate project in the sidebar — no special adaptation needed since MiWarp's session model is `cwd`-based.

Codex's Agent tool also supports `isolation: "worktree"` which auto-creates a temporary worktree for sub-agent tasks and cleans it up afterward.

## Key Patterns

- **Session Actor**: one tokio actor per CLI session, owns the child process. All mutations go through a bounded mpsc mailbox for sequential execution without locks.
- **Event Middleware** (`src/lib/stores/event-middleware.ts`): routes raw protocol events to the appropriate store handlers.
- **Tauri Commands**: Rust functions annotated with `#[tauri::command]` in `src-tauri/src/commands/`. Frontend calls them by name string via `invoke()`.
- **localStorage keys** use `ocv:` prefix (legacy from OpenCoVibe).
- **Sidebar width**, expanded projects, pinned folders, and removed cwds are persisted in localStorage.
