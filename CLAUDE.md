# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is MiWarp

MiWarp is a Tauri v2 desktop app that wraps AI coding CLIs (Claude Code, Codex) with a visual chat interface, session management, and activity monitoring. Local-first — all data stored at `~/.miwarp/`.

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

### Communication Flow

Frontend calls `invoke("command_name", args)` → transport layer → Tauri IPC → Rust command handler → storage/agent system. Real-time events flow back via Tauri's `app.emit()` (desktop) or WebSocket (browser).

Session lifecycle: `session_actor.rs` spawns a CLI child process, reads stdout line-by-line, parses stream-JSON events, stores them, and emits to the frontend. User input goes through stdin.

## Code Conventions

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

When multiple Claude Code sessions work in the same project folder, each session **must** work on its own branch to avoid file conflicts and stale context issues. Before making any changes, create or switch to a dedicated branch (e.g. `feat/your-task`). After completing work, merge or rebase back into the target branch. Never edit files directly on `master` in a multi-session workflow.

### Parallel Development with Git Worktree

For truly parallel work on different branches without file conflicts, use `git worktree`:

```bash
git worktree add ../miwarp-feat-x feat/x   # separate directory for branch feat/x
git worktree add ../miwarp-fix-y fix/y      # another directory for branch fix/y
git worktree list                            # list all worktrees
git worktree remove ../miwarp-feat-x         # cleanup when done
```

Each worktree is an independent checkout sharing the same `.git` database. In MiWarp, each worktree directory appears as a separate project in the sidebar — no special adaptation needed since MiWarp's session model is `cwd`-based.

Claude Code's Agent tool also supports `isolation: "worktree"` which auto-creates a temporary worktree for sub-agent tasks and cleans it up afterward.

## Key Patterns

- **Session Actor**: one tokio actor per CLI session, owns the child process. All mutations go through a bounded mpsc mailbox for sequential execution without locks.
- **Event Middleware** (`src/lib/stores/event-middleware.ts`): routes raw protocol events to the appropriate store handlers.
- **Tauri Commands**: Rust functions annotated with `#[tauri::command]` in `src-tauri/src/commands/`. Frontend calls them by name string via `invoke()`.
- **localStorage keys** use `ocv:` prefix (legacy from OpenCoVibe).
- **Sidebar width**, expanded projects, pinned folders, and removed cwds are persisted in localStorage.
