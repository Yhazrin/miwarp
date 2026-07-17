# Architecture

> Shared architecture reference for MiWarp. Both `AGENTS.md` and `CLAUDE.md` reference this document instead of duplicating content.

## What is MiWarp

MiWarp is a Tauri v2 desktop app that wraps AI coding CLIs (Claude Code, Codex) with a visual chat interface, session management, and activity monitoring. Local-first — all data stored at `~/.miwarp/`.

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

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Tauri v2 (Rust backend + WebView) |
| Frontend | Svelte 5 + SvelteKit (adapter-static) |
| Styling | Tailwind CSS v3 + CSS variables |
| Terminal | xterm.js |
| Testing | Vitest |

## Frontend (`src/`)

- **Routes** (`src/routes/`): SvelteKit pages — `chat`, `explorer`, `memory`, `history`, `usage`, `settings`, `plugins`, `workflow`, `scheduled-tasks`, `teams`, `skills`, `release-notes`, `browser`, `multi-agent`
- **Root layout** (`src/routes/+layout.svelte`): sidebar with project folder tree, icon rail, team/chat tabs, resize handle, theme/locale toggles. All pages share this shell.
- **Components** (`src/lib/components/`): reusable Svelte 5 components
- **Stores** (`src/lib/stores/`): reactive state using Svelte 5 `$state`/`$derived` runes (NOT legacy Svelte stores). `SessionStore` is the primary chat session state manager. `TeamStore`, `KeybindingStore`, `memoryStore`, `EventMiddleware` are other key stores.
- **Transport** (`src/lib/transport/`): abstraction over Tauri IPC vs WebSocket. `getTransport()` returns `TauriTransport` in desktop or `WsTransport` in browser. All frontend→backend calls go through this.
- **API layer** (`src/lib/api.ts`): typed wrappers around `invoke<T>(cmd, args)` — the single entry point for all Tauri commands. Imports types from `src/lib/types`.
- **i18n** (`src/lib/i18n/`): custom lightweight reactive runtime. `t(key, params?)` for translations, `initLocale()` in root layout, `switchLocale()` for runtime switching. Messages in `messages/en.json` and `messages/zh-CN.json`.

## Backend (`src-tauri/src/`)

- **Agent system** (`src-tauri/src/agent/`): `session_actor.rs` owns one CLI session's lifecycle (process, stdin/stdout, protocol state). `turn_engine.rs` manages turn phases and timeouts. `claude_protocol.rs` / `pipe_parser.rs` handle stream-JSON parsing. `spawn.rs` launches CLI processes.
- **Commands** (`src-tauri/src/commands/`): Tauri command handlers (one module per domain: `session`, `chat`, `runs`, `settings`, `files`, `git`, `mcp`, `teams`, `plugins`, etc.)
- **Storage** (`src-tauri/src/storage/`): local persistence at `~/.miwarp/` — run history, settings, events, CLI config, prompt index, favorites, MCP registry, community skills, changelog
- **Web server** (`src-tauri/src/web_server/`): embedded Axum server for browser-based access (WebSocket relay, auth, static files)
- **Scheduler** (`src-tauri/src/scheduler/`): cron-based scheduled task runner
- **Hooks** (`src-tauri/src/hooks/`): Tauri event hooks and team file watcher

## iOS (`apps/ios/MiWarpMobile/`)

- **Project**: `MiWarpMobile.xcodeproj` generated from `project.yml`, Swift 5.9, iOS 17 deployment target for the Xcode project.
- **SwiftPM package**: `Package.swift` exposes the app code as `MiWarpMobile` for package-aware tooling.
- **App entry** (`MiWarpMobile/App/`): SwiftUI app and navigation router.
- **Core** (`MiWarpMobile/Core/`): WebSocket/RPC client, connection store, keychain, event reducer, logging, models.
- **Design system** (`MiWarpMobile/DesignSystem/`): native MiWarp tokens and reusable SwiftUI components.
- **Features** (`MiWarpMobile/Features/`): Pairing, sessions, chat, artifacts, settings, and related mobile screens.
- **Live Activities** (`MiWarpMobile/LiveActivities/`, `MiWarpLiveActivityExtension/`): shared activity models plus extension UI.
- **Tests** (`MiWarpMobileTests/`): unit tests for reducers and mobile logic.

## Communication Flow

Frontend calls `invoke("command_name", args)` → transport layer → Tauri IPC → Rust command handler → storage/agent system. Real-time events flow back via Tauri's `app.emit()` (desktop) or WebSocket (browser).

Session lifecycle: `session_actor.rs` spawns a CLI child process, reads stdout line-by-line, parses stream-JSON events, stores them, and emits to the frontend. User input goes through stdin.

## Key Patterns

- **Session Actor**: one tokio actor per CLI session, owns the child process. All mutations go through a bounded mpsc mailbox for sequential execution without locks.
- **Event Middleware** (`src/lib/stores/event-middleware.ts`): routes raw protocol events to the appropriate store handlers.
- **Tauri Commands**: Rust functions annotated with `#[tauri::command]` in `src-tauri/src/commands/`. Frontend calls them by name string via `invoke()`.
- **localStorage keys** use `ocv:` prefix (legacy from OpenCoVibe).
- **Sidebar width**, expanded projects, pinned folders, and removed cwds are persisted in localStorage.
