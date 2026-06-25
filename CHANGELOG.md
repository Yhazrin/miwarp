# Changelog

All notable changes to MiWarp will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0-rc.1] - 2026-06-25

> **主题**：Open Agent Workbench。
> **状态**：Release Candidate（详见 `docs/v1.1.0-rc-checklist.md` 与 `docs/RELEASE_NOTES_V1.1.0.md`）。
> **基线**：`v1.0.9` … `e35bfdc2 feat(attention-realtime): 110-A17 Attention Queue live push 增量刷新`。
> **核心变更**：Durable Task / Run Journal / Attention Queue 闭环、Runtime Control Tower、Worktree Task Lab、Attention Queue Workspace UI 与实时增量刷新、macOS 原生窗口圆角 / sidebar underlay 修复。

### Features

- **Task Core (110-A8)**：跨 Session / 跨进程 / 跨验证阶段的工程工作单元。
  - Task aggregate、`tasks/`、`task_core.rs`（579 行）、`run_core.rs`（205 行）、`run_core/{apply,events,idempotency,projector}.rs`。
  - 单调 `revision` / `last_event_seq`，typed lifecycle journal；`mutation.json → events.jsonl → task.json` 本地 WAL 支持中断幂等恢复；no-op / 重复 link 不推进版本。
  - 桌面 IPC + WebSocket 增量读取 Task events；启动时收敛 orphan run，把失去活跃 run 的执行中 Task 原子迁移到 `needs_attention` 并记录 `restart_reconciled`。
- **Worktree Task Lab UI (110-A8)**：前端 `TaskListPanel` / `TaskDetailPanel` / `TaskCreateDialog` + `src/routes/tasks/+page.svelte`，对应 `9272dc08 feat(tasks): 110-A8 Worktree Task Lab UI`。
- **Durable Run Journal (110-S1)**：
  - 每 run 独立 `run-journal.json` / `run-journal-events.jsonl` / `run-journal-mutation.json`（与 chat `events.jsonl` 分离）。
  - typed `RunStage` / `RunActionRecord` / `RecoveryCursor` / `RunCheckpoint`。
  - `start_run` 在 meta 创建后初始化 journal（失败回滚 run）。
  - `session_actor` stdin 前检查 durable accepted IDs，stdin 成功后同步持久化 `UserMessageAccepted`。
  - `BroadcastEmitter` 在 bus seq 分配后投影粗粒度语义事件；启动顺序 `reconcile_orphaned_runs → run_journal::reconcile_after_restart → tasks::reconcile_after_restart → attention_queue::reconcile`。
- **Attention Queue Core (110-A17)**：单全局 aggregate（`~/.miwarp/attention/queue.json` / `events.jsonl` / `mutation.json`），typed `AttentionKind` / `AttentionSeverity` / `AttentionStatus` / `AttentionAction` + `stable_key` 幂等 upsert；来源映射覆盖 `Task.needs_attention`、run journal `pending_approvals` / `manual_confirmation` / `impossible_resume` / `journal_degraded`；`retry_task` / `mark_task_failed` 采用「来源聚合先变更、Attention WAL 后审计」编排；pending approval 仅 acknowledge 不伪装成已批准；`AttentionQueueStore` 提供 `load / incremental events / ack / resolve / reconcile / single-flight / derived` 查询。
- **Attention Queue Workspace UI (110-A17)**：`AttentionQueuePanel` 嵌入 `/workspace`，open / acknowledged 双列表，`allowed_actions` 按钮、打开会话、手动 Sync / reconcile 入口；根 layout 启动时 reconcile + loadSnapshot，工作台 nav badge 显示待处理计数（`2b5ec6cb feat(attention+workspace): Wave 2 Attention Queue UI and macOS surface fix`）。
- **Attention Queue Live Push (110-A17)**：Attention 总线订阅与增量刷新并入 store，对应 `e35bfdc2 feat(attention-realtime): 110-A17 Attention Queue live push 增量刷新`。
- **Runtime Control Tower (110-A4)**：`RuntimeControlCenter` / `RuntimePicker` / `RuntimeChips` / `RuntimeConfigDiffModal` 统一管理 Runtime / Provider / Model，capability negotiation、最近验证时间、配置备份 / 原子写入 / 验证 / 回滚、Provider 降级与能力缺失提示。
- **Visual Host (110-A2)**：`MermaidInteractive`、pan / zoom / fullscreen / 节点弹层 / send-to-prompt、主题与图结构安全测试在 `ClaudeCanvas.svelte` 统一编排。
- **macOS 原生窗口几何 (110-A21)**：`.app-main-shell` 与 `sidebar-main-corner-bridge` 与原生 glass wash 对齐，修复浅色 / 深色主题下圆角缺口透出与色块不连续（`2b5ec6cb`）。
- **Capability Matrix & Capability Attestation (110-A4 / 110-S6)**：`RuntimeCapabilities` typed mirror（TypeScript ↔ Rust 双端），与 `runtime_hub_*` 控制面命令集合；权限与 capability drift 决策进入 Local Agent Trace。

### Bug Fixes

- **Continuity timers & bounded CLI sync** (`5074b025 fix(core): bind continuity timers and bound CLI sync`)：长会话恢复与同步路径上的计时器绑定与 CLI 同步边界。
- **macOS 圆角缺口透出**：修复主内容圆角与 sidebar 合成背景在浅色 / 深色主题、native glass on/off、sidebar collapsed/expanded 下出现透明漏底与色差（`2b5ec6cb`）。
- **Attention Queue 增量刷新补齐 (110-A17)**：避免 UI 与持久化 WAL 出现背离，对应 `e35bfdc2`。
- **Stale reactive snapshots & duplicate imports** (`24a456e6 fix(perf)`)：清理前端 reactivity 残留与重复导入。
- **Session dequeue preservation** (`aac9cd13 fix(agent): preserve dequeued messages when stdin write fails`)：stdin 写失败时保留已出队消息，避免静默丢失。
- **Architecture cycle break** (`d18491f5 refactor(agent)`)：提取 `AttachmentData` 与 accepted-ledger helper，打破 `agent/*` 内部循环依赖。
- **CI 锁链 (PR #15)** (`a9ba9ad0 fix(ci)`)：解锁 contract gates / doc lint / Android build。
- **Android timestamp 类型** (`4203d9c5 fix(android)`)：使用 `longOrNull` 修正 `session_lifecycle.timestamp_ms` 类型。

### Performance

- **Sidebar 延迟加载** (`a40ff0f2 perf(layout)`)：sidebar IPC 延迟到首次展开；`/settings` 冷启动复用 settings 缓存。
- **Runs `list_runs_lite`**：新后端命令只读 `meta.json`，跳过 `summarize_events` 扫描，前向到会话对话框秒开。
- **Settings 按需加载** (`67ea57a2 perf(settings)`)：settings store 改为按需加载，首屏不再全量 hydrate。
- **Long-session 渲染** (`03f43651 perf(chat)`)：长会话初次渲染有界，避免一次性 hydrate 万级事件。
- **Stale snapshots & duplicate imports** (`24a456e6 fix(perf)`)。
- **Spawn augmented_path 缓存** (`9b484a64 perf(spawn)`)：避免每次启动反复扫描 PATH。
- **Visual performance mode 即时应用** (`6204bbc8 perf(ui)`)：挂载时即时套用，避免闪烁与二次渲染。
- **Pre-filter non-bus events** (`42301429 perf(events)`)：在 JSON 解析前过滤非总线事件，减少主线程压力。
- **`summarize_events` 单遍化** (`45d1d3ca perf(runs)`)：单遍 + circular buffer 完成汇总。

### Refactor

- **AttachmentData / accepted-ledger 提取** (`d18491f5 refactor(agent)`)：打破 `agent/*` 内部循环依赖。
- **Split send coordinator policies** (`84229c2a refactor(core)`)：发送协调策略拆分。
- **Centralize async lifecycle ownership** (`eda465fa refactor(session)`)：会话生命周期异步所有权集中。
- **Module split (Rust)**：`src-tauri/src/{task_core,run_core,run_core/{apply,events,idempotency,projector}}.rs`、`src-tauri/src/agent/control_plane/{adapters/{claude,codex,cursor,mimo,opencode},config_transaction,config_watcher,redaction,state}.rs` 等按域拆分（参考 `docs/architecture/architecture-lifecycle-standard.md`）。
- **Module split (TS)**：`src/lib/components/{runtime,tasks,workspace,chat}` 等按域收敛到子目录，store / composable 边界清晰化。

### Documentation

- `docs/PLAN_V1.1.0.md`：`Open Agent Workbench` 主题、锚点总账本、P0 验收标准、Wave 0-8 交付波次、§十一 锚点增量记录追加 2026-06-23 / 2026-06-25 两次审计。
- `docs/core-experience-v1.md`：12 领域毕业标准。
- `docs/V1.1.0_TREND_RADAR.md`：趋势与证据池。
- `docs/v1.1.0-rc-checklist.md`（本次新增）：12 条冻结条件逐条检查。
- `docs/RELEASE_NOTES_V1.1.0.md`（本次新增）：用户视角 release notes。
- `docs/RELEASE_PROCESS.md`（本次新增）：RC 流程文档化。
- `scripts/verify-rc.sh` + `npm run verify:rc`（本次新增）：RC 验证流水线。

### Known Issues / Deferred

- `110-A1` 10,000 Timeline Event ≥ 55 FPS / `110-A3` 10,000 行 Diff p95 ≤ 500ms 等性能预算缺真实采样，列为 `DEFERRED` 至 v1.1.1。
- 7 天真实项目 soak 未完成，列为 `DEFERRED`。
- `110-A7` MCP App Canvas / `110-A15` Protocol Gateway / `110-A19` Semantic Code Intelligence / `110-A23` Reproducible Environment Capsule / `110-S5` Resource & Cost Governor 等实验性 / 长链路锚点 `DEFERRED` 至 v1.2.0 路线图。
- macOS 截图视觉回归门禁尚未自动化入库（`110-A21` PARTIAL 跟踪项）。

完整检查项与降级决策见 `docs/v1.1.0-rc-checklist.md`；与本版本对齐的产品主题、范围与 P0 锚点见 `docs/PLAN_V1.1.0.md`。

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
