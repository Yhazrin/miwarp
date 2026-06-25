# MiWarp Core Experience v1

> Status: active release gate for v1.0.8 and later  
> Initiative: MiWarp Core Reliability Initiative  
> Product promise: the most stable, transparent, and provider-flexible desktop workspace for Claude Code-compatible agents.

## 1. Product priority

MiWarp development is split into three layers:

1. **CC execution foundation** — model connection, process lifecycle, streaming, tool calls, permissions, file changes, terminal, Git, resume, stop, retry, and failure recovery.
2. **Engineering experience** — session management, trustworthy diff, file preview, concurrent tasks, mobile approval, provider compatibility, long-task recovery, and project context.
3. **Personal AI** — memory, Life Mission, Personal Inbox, life data, digital twin, and proactive long-running agents.

Until Core Experience v1 exits the release gate, capacity allocation is:

- 70% execution foundation;
- 25% engineering experience;
- 5% Personal AI research that does not consume foundation delivery capacity.

## 2. Exit rule

Core Experience v1 is complete only when all blocking gates pass and the evidence is reproducible from a clean checkout.

A feature being present is not evidence that it is reliable. Evidence must come from:

- automated contract, unit, integration, and build checks;
- scenario-based end-to-end runs;
- fault injection and recovery checks;
- measured performance budgets;
- a seven-day real-project soak with no unresolved blocker.

### Blocking release gates

- No known P0 or P1 issue in session start, streaming, tool execution, permission approval, file mutation, stop, resume, or recovery.
- No duplicate or out-of-order user-visible message in the E2E scenario suite.
- Diff content matches disk and Git state for all tested mutation paths.
- App restart, process crash, network loss, sleep/wake, and reconnect have explicit tested outcomes.
- Tier 1 providers pass the same compatibility contract.
- Desktop and mobile approval state cannot diverge silently.
- Diagnostic export identifies session, provider, process, transport, and failing operation without exposing secrets.
- CI passes on frontend, Rust, Android, and iOS.
- Version metadata is aligned across npm, Tauri, Rust, iOS, and Android.

## 3. Twelve acceptance domains

### 3.1 Startup

- Detect the required CLI and report its path and version.
- Give an actionable recovery path for missing or incompatible dependencies.
- Validate provider credentials and endpoint connectivity before starting work.
- Classify startup failures instead of returning a generic failure.
- Measure cold start, workspace open, session start, and first-token latency.

### 3.2 Chat and event consistency

- A user message is submitted exactly once.
- Streaming text, thinking, tool calls, and completion events preserve protocol order.
- Reconnect and replay do not duplicate events.
- Session switching cannot route events into another session.
- Long output does not block input, scrolling, or stop actions.
- Draft input survives non-destructive navigation and expected reconnects.

### 3.3 Tool calls

- Read, Edit, Write, Bash, Grep, Glob, task, and MCP tools have typed views.
- Unknown tools fall back to a complete generic card instead of disappearing.
- Parallel tools keep independent IDs, progress, result, cancellation, and error state.
- Tool start, delta, end, denial, timeout, and cancellation are distinguishable.

### 3.4 Permissions

Every permission request must present:

- requested action;
- reason or task context;
- affected files, command, host, or resource;
- risk classification;
- one-time, persistent, and reject choices when supported;
- the expected consequence of rejection;
- pending request count and origin session.

Raw protocol JSON is diagnostic detail, not the primary interface.

### 3.5 Files and diff

- Show before/after content and mutation type: add, edit, delete, rename, binary, or conflict.
- Separate agent changes, user changes, and pre-existing Git changes.
- Match the latest disk state and show stale-snapshot warnings.
- Support file-level rollback and tool-call-level rollback where provenance exists.
- Large diff rendering is virtualized or bounded and cannot freeze the application.
- Conflict and partial-write states are explicit.

### 3.6 Terminal

- Preserve stdout, stderr, ANSI semantics, command, working directory, exit code, and termination reason.
- Stop terminates the intended process tree without leaving hidden children.
- Interactive-command limitations are visible before execution.
- Output backpressure cannot freeze the session event stream.

### 3.7 Git

- Status and diff are refreshed from the repository rather than inferred from agent messages.
- Commit scope is previewed and unrelated user files are excluded by default.
- Push shows remote and branch before execution.
- Merge conflicts and detached HEAD are treated as explicit states.
- Rollback never silently discards unrelated user work.

### 3.8 Provider compatibility

Providers are published in three tiers:

- **Tier 1 — fully validated:** automated conversation, streaming, thinking, tool use, permission, file edit, stop, resume, error, and long-output scenarios pass.
- **Tier 2 — usable:** basic conversation and core tools pass; unsupported capabilities are declared.
- **Tier 3 — experimental:** best-effort adapter with incomplete compatibility evidence.

The matrix records:

| Capability       | Required evidence                                        |
| ---------------- | -------------------------------------------------------- |
| Authentication   | valid, invalid, expired, proxy, and unreachable endpoint |
| Streaming        | ordered text and thinking deltas, cancellation           |
| Tool use         | typed tool calls, parallel calls, failure payloads       |
| Files            | read, create, edit, delete, rename, large diff           |
| Resume           | CLI conversation ID and event checkpoint recovery        |
| Images           | supported, rejected, and oversized behavior              |
| Prompt cache     | capability declaration and accounting                    |
| Errors           | normalized category plus preserved provider detail       |
| Protocol version | last verified CLI/protocol version and date              |

Claims such as “supports N providers” are not release evidence without this matrix.

### 3.9 History and recovery

A recoverable session persists or can reconstruct:

- MiWarp session and run IDs;
- CLI conversation ID;
- cwd and worktree identity;
- provider, model, and relevant launch settings;
- last committed event sequence;
- active permission and tool state;
- file mutation provenance;
- current Git identity and divergence from the saved snapshot.

If execution cannot be resumed safely, MiWarp opens a read-only history with a precise reason.

### 3.10 Web and mobile

The initial cross-device contract is intentionally narrow:

- view current status and recent output;
- receive and resolve permission requests;
- send a message;
- stop a run;
- observe completion or failure.

Desktop remains authoritative for local process and file state. Reconnect must reconcile from server sequence checkpoints rather than trusting stale local UI state.

### 3.11 Performance

Every release records p50 and p95 where meaningful for:

- application cold start;
- workspace open;
- new session start;
- first token;
- 1,000-session history load;
- long-session open and incremental append;
- large diff open and scroll;
- idle memory and CPU;
- three-hour active-session memory growth;
- reconnect and resume.

A regression above the agreed budget blocks release unless explicitly accepted with an owner and removal date.

### 3.12 Diagnostics and observability

Structured diagnostics include:

- trace ID, session ID, run ID, request ID, and tool-call ID;
- application, CLI, adapter, and protocol versions;
- provider category without secrets;
- connection state and last transition;
- process state and exit reason;
- event sequence and replay decision;
- permission state;
- network and proxy summary;
- normalized error category plus safe original detail.

Diagnostic bundles must redact credentials, tokens, authorization headers, sensitive environment values, and private prompt/file content unless the user explicitly includes it.

## 4. Reliability workstreams

### A. Session reliability

- event ordering and deduplication;
- single-owner subscription lifecycle;
- stop and process-tree cleanup;
- resume and replay checkpoints;
- app/CLI crash recovery;
- multi-session isolation;
- sleep/wake and network transition behavior.

### B. Provider compatibility

- declarative provider capability registry;
- automated minimum conversation contract;
- tool-use and error normalization fixtures;
- resume capability checks;
- protocol-version tracking.

### C. Interaction quality

- input and draft behavior;
- streaming scroll behavior;
- tool and permission cards;
- diff navigation and rollback;
- loading, empty, retry, degraded, and fatal states.

### D. Performance

- long sessions and large projects;
- large output and diff virtualization;
- history indexing and pagination;
- memory leak and retained-listener checks;
- page and session switching latency.

### E. Observability

- structured logs and correlation IDs;
- failure taxonomy;
- diagnostics screen;
- redacted support bundle;
- release-level reliability metrics.

## 5. Scenario-based E2E suite

### Scenario 1 — complete engineering task

Open MiWarp → select project → start session → send change request → read files → approve requested action → edit code → run tests → inspect diff → commit.

Assertions:

- no duplicate input or output;
- tool order and status are correct;
- permission copy describes impact;
- disk, diff, and Git agree;
- commit contains only approved files.

### Scenario 2 — interrupted application

Start a task → force-close MiWarp during streaming/tool work → reopen → restore session → verify no duplicate event → continue or enter explicit degraded history.

### Scenario 3 — process failure

Start a task → terminate the agent process → observe classified failure → retry or resume → verify old process and requests are cleaned up.

### Scenario 4 — network loss

Start a remote/provider request → disconnect network → reconnect → resume or retry → verify no duplicate tool execution and monotonic event sequence.

### Scenario 5 — provider matrix

For every Tier 1 provider: start → stream → think → tool call → file edit → error → stop → resume.

### Scenario 6 — mobile approval

Run desktop task → receive mobile request → approve once → desktop continues → both clients converge on the same request and run state.

### Scenario 7 — sleep and wake

Run a long task → sleep computer → wake → reconcile process, transport, subscriptions, timers, and UI without silent stale state.

### Scenario 8 — concurrent sessions

Run multiple sessions with parallel tools → switch rapidly → stop one → approve another → verify event, permission, and output isolation.

## 6. Maturity score

Each domain is scored weekly from 0 to 100:

- 40 points: automated correctness and contract evidence;
- 25 points: scenario E2E evidence;
- 15 points: fault and recovery evidence;
- 10 points: measured performance within budget;
- 10 points: diagnostics and operator usability.

Rules:

- a known P0 caps the affected domain at 30;
- a known P1 caps it at 60;
- an untested recovery path caps it at 75;
- a provider claim without matrix evidence does not score;
- stale evidence from an older protocol or CLI version is discounted.

Core Experience v1 exits when:

- weighted average is at least 90;
- message consistency and diff trust are at least 98;
- session reliability is at least 95;
- no blocking gate is open;
- seven-day soak succeeds.

## 7. Seven-day soak

The soak uses real repositories and normal daily work, not a synthetic idle run.

Record for every session:

- provider/model and CLI version;
- start, first token, completion, stop, resume, and reconnect timings;
- permission count and decision latency;
- duplicate, missing, reordered, or stale events;
- process leaks or forced restarts;
- diff/Git mismatch;
- memory and CPU samples;
- diagnostic quality when an error occurs.

A blocker resets the seven-day clock after the fix is merged. Non-blocking defects require an owner and target release.

## 8. Current v1.0.8 foundation evidence

As of 2026-06-21:

- browser/desktop: 1,627 tests pass;
- Rust: 462 library tests pass, formatting and Clippy are clean;
- iOS: 84 SwiftPM tests and 84 simulator tests pass;
- Android: 48 JVM tests pass, Lint has 0 errors, Debug APK builds;
- WebSocket connection lifecycle, request registry, run subscription ownership, single-flight recovery, and bounded cross-platform chunk assembly are documented and tested;
- architecture and cross-platform command contracts run in CI;
- version alignment covers npm, Tauri, Rust, iOS, and Android;
- GitHub Actions now contains frontend, Rust, Android, and iOS gates.

This evidence proves a stronger foundation. It does **not** by itself complete the seven-day soak, the full provider matrix, performance budgets, or every scenario E2E flow.

## 9. Next execution order

1. Build the scenario E2E harness around session start, permission, edit, test, diff, commit, stop, and resume.
2. Establish Tier 1 provider fixtures and publish the compatibility matrix.
3. Add process, network, sleep/wake, and crash fault injection.
4. Instrument startup, first-token, long-session, history, diff, memory, and reconnect budgets.
5. Complete diagnostics export with secret-redaction tests.
6. Run the seven-day soak and close every blocker.
7. Only then increase investment in Mission, multi-agent orchestration, Personal Memory, Life Mission, and Personal Inbox.

---

## 10. v1.1.0-rc.1 self-check (2026-06-25)

> **基线**：分支 `feat/v1.1.0-final`，HEAD `e35bfdc2 feat(attention-realtime): 110-A17 Attention Queue live push 增量刷新`。
> **范围**：对 §3 全部 12 个领域逐条列出当前实现证据（文件路径 + commit hash），与冻结条件一一对应。
> **配套**：`docs/PLAN_V1.1.0.md` §十一 + `docs/v1.1.0-rc-checklist.md`。

### 3.1 Startup

- CLI 检测 / 版本报告 / 启动失败分类：`src-tauri/src/agent/spawn.rs`、`src-tauri/src/agent/spawn_locks.rs`（typed failure）。
- 凭证与端点连通性：`src-tauri/src/agent/control_plane/state.rs` + `runtime_hub_*` 命令。
- 冷启动 / 工作区打开 / 会话启动 / 首 Token 指标：`docs/perf/v109-performance-contract.md` + `scripts/perf-compare.mjs`。
- 状态：`PARTIAL` → 7 天 soak 未做。

### 3.2 Chat and event consistency

- 用户消息提交唯一性 + 流式顺序：v1.0.9 send transaction + 幂等（`src/lib/chat/send-coordinator`）。
- 重连 / 重放不重复：`src-tauri/src/agent/session_actor.rs` 持久化 accepted IDs。
- Session 切换不串写：`src/lib/stores/session-store.svelte.ts` 单订阅模型。
- 长输出不阻塞：`src/lib/components/chat/ChatTimelineEntries.svelte` 收敛为单一时间线 + progressive timeline（`src/lib/chat/`）。
- 草稿保留：v1.0.9 SendCoordinator 草稿分支。
- 状态：`PARTIAL` → 长会话 10k 事件 FPS 预算缺真实采样。

### 3.3 Tool calls

- Read / Edit / Write / Bash / Grep / Glob / task / MCP 类型化卡片：`src/lib/components/InlineToolCard.svelte` + `src/lib/components/AskUserQuestionCard.svelte`。
- 未知 Tool 降级：generic card 分支。
- 并行 Tool 独立 ID / progress / result / cancel：`src-tauri/src/agent/turn_engine.rs`。
- 状态：`DONE`（v1.0.9 已签字）。

### 3.4 Permissions

- `PermissionPanel` / `PermissionsModal` 提供完整 action / reason / 影响范围 / 风险 / 一次性 vs 持久 / 拒绝后果 / 计数。
- 原始终止 JSON 仅作诊断显示（`src/lib/components/HookReviewCard.svelte`）。
- 状态：`DONE`。

### 3.5 Files and diff

- 文件级 / 行级 Diff：`src/lib/components/DiffModal.svelte` + `src/lib/components/DiffPreview.svelte`。
- Agent 修改 / 用户修改 / 预存在修改分离：`src/lib/components/inspector/WorkspaceInspector.svelte`。
- Disk 状态匹配：`src-tauri/src/commands/git.rs` + `src-tauri/src/commands/files.rs`。
- 回滚边界：`src/lib/components/RewindModal.svelte`。
- 大 Diff 虚拟化：`src/lib/components/DynamicVirtualList.svelte`。
- 状态：`PARTIAL` → 行级评论 / Checkpoint Diff 未齐。

### 3.6 Terminal

- stdout / stderr / ANSI / 命令 / cwd / exit / 终止原因：`src-tauri/src/process_ext.rs` + `src/lib/components/XTerminal.svelte`。
- Stop 终止进程树：`src-tauri/src/agent/spawn_locks.rs`。
- 交互命令限制前置显示：`src-tauri/src/agent/ssh.rs`。
- 输出背压：`src-tauri/src/agent/stream.rs`。
- 状态：`DONE`。

### 3.7 Git

- Status / Diff 来自仓库而非 agent 消息：`src-tauri/src/commands/git.rs`。
- Commit scope preview + 未推送检查：`src/lib/components/GitWorktreePanel.svelte`。
- Push 显示 remote / branch：`src-tauri/src/commands/git.rs::preview_push`。
- Merge conflict / detached HEAD 显式状态：`src/lib/components/git/*`。
- Rollback 不静默丢失：`src-tauri/src/agent/runtime_recovery.rs`。
- 状态：`DONE`。

### 3.8 Provider compatibility

- Tier 1 / Tier 2 / Tier 3 三档 + capability matrix：`src-tauri/src/agent/control_plane/state.rs` + `RuntimeCapabilities` typed mirror。
- 9 项 capability + 必需证据：`docs/architecture/cross-platform-capability-matrix.md`。
- 最近验证时间字段已在 matrix，但由手工填写，自动化采集脚本列为 v1.1.1。
- 状态：`PARTIAL`。

### 3.9 History and recovery

- 持久化 / 重建关键 ID：`src-tauri/src/run_core.rs` + `src-tauri/src/storage/run_journal.rs` + `src-tauri/src/attention_core.rs`。
- CLI conversation ID：`src-tauri/src/agent/recovery.rs`。
- cwd / worktree 身份：`src-tauri/src/commands/worktree.rs`。
- provider / model / 启动设置：`src-tauri/src/agent/hub.rs`。
- 上次提交事件序列号：bus seq。
- 权限 / tool 状态：`run_journal::pending_approvals`。
- 文件 mutation provenance：`run_journal::file_mutations`。
- Git identity / divergence：`src-tauri/src/commands/git.rs::snapshot_git_identity`。
- 无法安全恢复 → 只读 history：Attention Queue `impossible_resume` 投影。
- 状态：`DONE`。

### 3.10 Web and mobile

- 跨端窄契约：v1.1.0 范围（见 `docs/PLAN_V1.1.0.md` §六 `110-A6`）。
- iOS Live Activity + Android SessionLifecycle 已 wire：`087113b5 feat(mobile): wire v1.0.9 SessionLifecycle BusEvent into iOS Swift and Android Kotlin clients`。
- Desktop 权威 + 序列号对齐：WebSocket 单飞恢复。
- 状态：`PARTIAL` → 完整移动状态收敛在 v1.1.1。

### 3.11 Performance

- p50 / p95 覆盖项：`docs/perf/v109-performance-contract.md`。
- 性能工具链：`scripts/perf-compare.mjs` + `src/lib/perf/*`。
- 长会话 / 大 Diff / 内存 / 重连预算：性能契约已建立，但真实采样数据缺。
- 状态：`PARTIAL` → 7 天 soak + 真实采样 DEFERRED 至 v1.1.1。

### 3.12 Diagnostics and observability

- Trace ID / session / run / request / tool-call ID：`src-tauri/src/run_core/events.rs`。
- 应用 / CLI / adapter / 协议版本：`src-tauri/src/diagnostics/*`。
- Provider 分类脱敏：`src-tauri/src/agent/control_plane/redaction.rs`。
- 连接状态 / 上次转换 / 进程状态 / 退出原因：`src-tauri/src/diagnostics/*`。
- 事件序列 / 重放决策：`src-tauri/src/run_core.rs::recovery_cursor`。
- 权限状态：`run_journal::pending_approvals`。
- 网络 / 代理摘要：`src-tauri/src/http_client.rs`。
- 错误分类 + 安全原始 detail：`src-tauri/src/agent/permission_error.rs` + `agent::constants.rs`。
- 脱敏支持：v1.0.9 bounded ring buffer + redaction（`0a87f279`、`8eee6f99`）。
- Doctor UI / 一键脱敏导出：DEFERRED 至 v1.1.1。
- 状态：`PARTIAL`。

### 汇总

| 领域          | 状态        | 关键证据 |
| ------------- | ----------- | -------- |
| 3.1 Startup   | `PARTIAL`  | 启动失败类型化、Runtime Hub；soak 未做 |
| 3.2 Chat      | `PARTIAL`  | progressive timeline + 单时间线；10k FPS 缺采样 |
| 3.3 Tools     | `DONE`     | v1.0.9 已签字 |
| 3.4 Permissions| `DONE`    | `PermissionPanel` / `PermissionsModal` |
| 3.5 Files/Diff| `PARTIAL` | Diff 基础；行级评论未齐 |
| 3.6 Terminal  | `DONE`     | `XTerminal` + `spawn_locks` |
| 3.7 Git       | `DONE`     | `GitWorktreePanel` + `git.rs` |
| 3.8 Providers | `PARTIAL` | capability matrix 在；自动化验证时间未齐 |
| 3.9 History   | `DONE`     | Run Journal WAL + reconcile |
| 3.10 Mobile   | `PARTIAL` | Live Activity + SessionLifecycle；完整收敛 v1.1.1 |
| 3.11 Perf     | `PARTIAL` | harness 在；真实采样 DEFERRED |
| 3.12 Diag     | `PARTIAL` | Trace 在；Doctor UI / 一键脱敏导出未齐 |

> **签字建议**：3 个 `DONE` + 9 个 `PARTIAL`。所有 PARTIAL 项均有书面 DEFERRED 决策；不阻断 v1.1.0-rc.1 标签，但 v1.1.1 RC 前置门禁清单必须包含 9 项 PARTIAL 升级。## 8. Current v1.0.8 foundation evidence

As of 2026-06-21:

- browser/desktop: 1,627 tests pass;
- Rust: 462 library tests pass, formatting and Clippy are clean;
- iOS: 84 SwiftPM tests and 84 simulator tests pass;
- Android: 48 JVM tests pass, Lint has 0 errors, Debug APK builds;
- WebSocket connection lifecycle, request registry, run subscription ownership, single-flight recovery, and bounded cross-platform chunk assembly are documented and tested;
- architecture and cross-platform command contracts run in CI;
- version alignment covers npm, Tauri, Rust, iOS, and Android;
- GitHub Actions now contains frontend, Rust, Android, and iOS gates.

This evidence proves a stronger foundation. It does **not** by itself complete the seven-day soak, the full provider matrix, performance budgets, or every scenario E2E flow.

## 9. Next execution order

1. Build the scenario E2E harness around session start, permission, edit, test, diff, commit, stop, and resume.
2. Establish Tier 1 provider fixtures and publish the compatibility matrix.
3. Add process, network, sleep/wake, and crash fault injection.
4. Instrument startup, first-token, long-session, history, diff, memory, and reconnect budgets.
5. Complete diagnostics export with secret-redaction tests.
6. Run the seven-day soak and close every blocker.
7. Only then increase investment in Mission, multi-agent orchestration, Personal Memory, Life Mission, and Personal Inbox.
