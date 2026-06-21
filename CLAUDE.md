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

For architecture-affecting work, communication/state refactors, reliability fixes, large audits, acceptance, and optimization, read and apply `.codex/skills/architecture-lifecycle/SKILL.md`. Scale the process to the task, but always preserve explicit ownership, measurable quality attributes, failure-path tests, synchronized architecture documentation, and incremental migration rather than flag-day rewrites.

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

### Language

Always respond in Chinese (中文) unless the user writes in English. This includes explanations, summaries, and commit messages.

### Action Over Reporting

- Always make actual code changes — do NOT produce audit reports, summaries, or status documents unless explicitly asked.
- When fixing bugs, write and run the fix immediately. Never stop to summarize findings without acting first.
- If a fix doesn't work, try the next approach immediately rather than re-analyzing.

### Code Quality — High Cohesion, Low Coupling

开发过程中所有改动必须遵循"高内聚、低耦合"原则，让代码少异味。每改一处都对照下方的异味清单扫一遍。

#### 高内聚（High Cohesion）— 相关的东西放一起

- **一个文件 = 一个职责**。Svelte 组件 / composable / store / Rust 模块只做一件事，文件名要能精确描述它做什么（`useChatScroll` 只管滚动，不掺 API 调用）
- **相关逻辑就近放**：
  - chat 域 composables 放 `src/lib/chat/`（`useChatLifecycle` / `useChatHandlers` / `useChatDerived` / `useChatController` / `useChatScroll` / `useProgressiveTimeline` …）
  - prompt 域放 `src/lib/prompt/`（`useFileHandling` / `useSlashMenu` / `useAtMention`）
  - selectors 放 `src/lib/chat/selectors/`
  - 后端按域分 `src-tauri/src/commands/{session,chat,runs,settings,files,git,mcp,teams,plugins,...}.rs`
- **长文件立即拆**：
  - Svelte 组件 > 500 行 → 抽 composable 或子组件
  - Rust 文件 > 800 行 → 拆子模块
  - `chat/+page.svelte` 历史上从 4600+ 行拆到 841 行就是这个原则的应用（参考 `docs/PLAN_V1.0.6.md`）
- **types 按域分文件**：`types/teams.ts` / `types/plugins.ts` / `types/bus-events.ts` / `types/marketplace.ts` / `types/scheduled-task.ts` — 不要塞回 `types/index.ts`
- **常量集中管理**：`utils/storage-keys.ts` 是 `localStorage` 键的模式参考；magic string / magic number 都应该有名有姓

#### 低耦合（Low Coupling）— 模块之间少知道对方

- **单向数据流**：Props down / Events up / 跨组件状态走 store。子组件不直接修改父组件的 state，父子之间通过 callback 通信
- **跨组件共享走 store，不直接 import 内部状态**：
  - `Sidebar` ↔ `ChatPage` ↔ `SessionStatusBar` 之间不互相 import 内部变量，共享走 `SessionStore` / `TeamStore` / `KeybindingStore`
  - 后端 `session_actor` ↔ `turn_engine` ↔ `broadcaster` 之间不互相持有引用，通过 mpsc channel 通信
- **Composable 边界清晰**：每个 composable 只暴露必要的 getter / action；内部 helper 私有（不 `export`）
- **Backend 模块按域分 + service 层**：domain 之间不互相 import `commands/*` 内部实现，统一走 `src-tauri/src/agent/`（`session_actor.rs` / `turn_engine.rs` / `claude_protocol.rs` / `pipe_parser.rs` / `notify.rs`）
- **Transport 抽象不绕过**：所有 IPC 必须走 `getTransport()`，永远不要在 component / page 里 `import { invoke } from '@tauri-apps/api/core'`（ESLint `no-restricted-imports` 强制）
- **事件类型集中**：`BusEvent` 枚举统一在 `src-tauri/src/models.rs` 定义，新加事件必须扩 enum + 在 `broadcaster::event_type_name` 注册 + 前端 `BusEvent` union 同步
- **i18n 不污染代码**：UI 字符串永远走 `t('key')`，不写中文 / 英文硬编码到 `.svelte` 模板

#### 代码异味清单（Code Smell Checklist）

每改一处 / 每个 PR 前必须对照扫一遍：

- [ ] **God object**：一个类 / 组件 / store 做 > 1 件事 → 拆
- [ ] **Prop drilling**：props 透传 > 2 层 → 提到 store 或 context
- [ ] **循环依赖**：A import B，B import A → 重构到一个共同依赖
- [ ] **重复代码**：相同 / 相似逻辑出现 ≥ 3 次 → 抽到 utility / composable
- [ ] **魔法字符串**：硬编码 `"claude"` / `"session_actor"` / `"/var/folders/..."` → 抽命名常量
- [ ] **魔法数字**：`5` / `10` / `300` 等无注释数字 → 抽命名常量（参考 `_IDLE_GAP_MS` / `QUARANTINE_DEADLINE`）
- [ ] **`any` 类型**：禁用。实在不知道类型用 `unknown` + 类型守卫
- [ ] **`// @ts-ignore` / `// @ts-expect-error`**：禁用。修复类型本身，不要绕过
- [ ] **死代码**：注释掉的代码块 / 永远走不到的分支 / 未引用的 export → 立即删除（用 `git log -p` / `git show` 找回）
- [ ] **冗余抽象**：为假想复用提前写 hook / base class / 泛型 → 等真有第二处用再抽（Three similar lines is better than a premature abstraction）
- [ ] **跨层泄漏**：前端 `as any` 强转后端类型 / 后端 struct 字段乱给前端用 → 加 explicit 边界类型
- [ ] **过度耦合测试**：测试依赖内部 state 变量名（而不是行为）→ 改 black-box
- [ ] **可变全局**：跨模块 mutation 共享 state → 用 store 或参数传递
- [ ] **过深缩进 / 嵌套 callback**：> 3 层 → 早返回 / 抽函数
- [ ] **注释解释 WHAT**（不是 WHY）→ 删掉，命名应该自解释（`/// <summary>Sends a message</summary>` 这种都是噪音）
- [ ] **Suspicious 名字**：`handleXxx` / `doXxx` / `processXxx` / `data` / `temp` / `result2` / `flag1` → 重命名为具体含义
- [ ] **组件 > 500 行** → 拆 composable / 子组件
- [ ] **函数 > 50 行** → 拆
- [ ] **参数 > 4 个** → 引入 struct / options object（Rust 用 `#[allow(clippy::too_many_arguments)]` 是最后手段，先重构）
- [ ] **混合关注点**：UI 组件里直接调 IPC / store 里写模板字符串 / composable 里操作 DOM → 各回各家

#### 改动后自检（3 步必走）

1. **类型 + lint**：`pnpm check` + `pnpm lint` 必须 0 错；Rust 改完跑 `cargo clippy -- -D warnings`
2. **影响范围**：`git grep "<新类型/常量名>"` 检查所有引用点同步更新（特别是改 store / types 后）
3. **回归测试**：改了 store / composable → 跑 `npm test`；改了 IPC → `cargo test`；改了 UI 行为 → `tauri dev` 手动走一遍金路径

#### 重构前红线

禁止"边修 bug 边大重构" — 改动前如果发现需要拆文件 / 拆模块：

- **单开分支做**：`refactor/xxx` 独立分支，不和 `fix/yyy` / `feat/zzz` 混
- **拆 commit**：重构和功能改动分成 2 个独立 commit（看 `git log --oneline feat/extensions-center` 那种粒度）
- **行为不变**：现有 snapshots / tests / `pnpm check` / `cargo clippy` 全过才允许 merge
- **不引入新功能**：refactor PR 不带 feature 改动，feature PR 不带大规模重构

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

### 版本管理节奏（及时但不必频繁）

> **目标**：每一次提交都是有意义的"快照"，避免微碎提交刷屏，也避免"攒一大坨一次性 commit"。

- **攒到一组再提交**：把同一主题的多处改动攒成一个 commit（例：把"零章产品原则"+"侧边栏改造"+"斜杠命令修复"拆成 3 个独立 commit，而不是一个巨型 commit）
- **每个 commit 独立可回滚**：commit 之间不应有"必须前一个才有意义"的强依赖；这样 bisect / cherry-pick / revert 都干净
- **commit 前自检**：
  1. `git status` 看有没有意外被 staged 的文件
  2. `git diff --stat` 确认改动范围符合预期
  3. `git diff --staged` 再扫一遍内容
  4. 跑一遍 pre-commit 钩子能过的检查（`pnpm check` / `cargo clippy` 按改动域走）
- **不要主动 push**：默认 commit 留在本地，等用户确认后再 push；不在用户没要求时 `git push`
- **commit message 走 Conventional Commits**：`feat:` / `fix:` / `chore:` / `refactor:` / `docs:`，scope 写清楚（`feat(sidebar): ...` / `fix(shell-env): ...`）
- **跨分支前先同步**：开新分支前确认 master 是干净的、本地 commit 已落到应到之处
- **计划书 / 大文档改动**：可以一个 commit 包含多个文件（例：CLAUDE.md + docs/*.md），因为它们语义上是同一组约束
- **改动后很久才想起还有补充**：单独再开一个 commit，不要 amend 前一个（除非用户明确要求）

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
