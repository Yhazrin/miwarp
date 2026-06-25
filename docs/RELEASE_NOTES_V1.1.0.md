# MiWarp v1.1.0 Release Notes

> **版本主题**：Open Agent Workbench
> **一句话承诺**：接入不同 Agent，看清执行过程，在关键节点干预，并在任何中断后继续工作。
> **英文承诺**：Connect any agent. See everything that matters. Intervene before damage. Resume without losing work.
> **对应 CHANGELOG 条目**：`1.1.0-rc.1`（2026-06-25）
> **完整冻结条件检查**：[`docs/v1.1.0-rc-checklist.md`](./v1.1.0-rc-checklist.md)

---

## What's New

MiWarp v1.1.0 是从「AI CLI 桌面外壳」到「可观测 Agent Workbench」的一次产品层级跃迁。这次版本围绕四个核心承诺展开：

### 1. Task 取代 Session 成为工程单元

之前每次「我要修个 bug」「我要做一次小重构」都会落在一个 Session 里。如果你重启、断网或者切窗口，Session 里的上下文可能就模糊了。v1.1.0 引入了 **Task**：一个跨 Session、跨进程、跨验证阶段的工程工作单元。

- Task 会跟随文件修改、测试结果、运行日志一起被持久化；
- App 重启后 Task 状态可恢复；
- 一个 Task 失败不会污染另一个 Task；
- 你可以从一个对话、一次 Diff 或一段 Issue 直接创建一个 Task。

### 2. Run Journal：Agent 说什么完成，不再等于真的完成

「Agent 写完了」之前可能是自我声明。v1.1.0 把每一次 Agent 运行记录在 **Durable Run Journal** 里：

- 每条工具调用有唯一 action_id；
- 文件修改绑定来源动作；
- App 崩溃 / CLI 崩溃 / 断网后能区分「安全重试」「需要确认」「无法恢复」三种状态；
- 不会自动盲重试非幂等动作。

### 3. Attention Queue：你只需要处理真正需要你的事

并行跑多个任务时，最怕的是「我不在的时候发生了什么」。v1.1.0 引入 **Attention Queue**：

- 在工作台右侧统一展示所有需要你决定的事情（权限、问题、计划审查、验证失败、合并冲突、不可恢复状态、超预算、Runtime 离线、MCP 异常、最终审查）；
- 按风险、等待时间和工作区分组；
- 已处理项保留审计记录；
- 桌面 IPC 与 WebSocket 实时同步，跨端状态不漂移。

### 4. Worktree Task Lab：并行 Agent 不再串写

之前在多任务并发时容易出现「两个 Agent 改了同一个文件」。v1.1.0 的 **Worktree Task Lab** 提供：

- 每个 Task 可选独立 Worktree；
- 任务预算、最大文件数、允许目录和验证命令；
- 任务结束后能回收 CLI、终端和 Dev Server；
- 合并、保留分支或丢弃 Worktree 三种收口决策。

### 5. Runtime Control Tower：能力不再靠猜

设置页面现在有一个 **Runtime Control Center**：统一管理 Runtime、Provider、Model、CLI 配置、能力和健康状态。

- 每个 Runtime 标注 Tier 1 / Experimental 标签；
- 显示能力支持矩阵（streaming、tool、permission、resume、image、MCP、browser、parallel tool 等）；
- 配置写入前自动备份、原子上写、失败回滚；
- 切换 Model 不会改变正在运行 Run 的身份。

### 6. macOS 圆角缺口终于连续了

v1.1.0 修复了 macOS 上的一个长期视觉问题：主内容圆角与左侧 sidebar 合成背景在某些主题下出现透明漏底和色块。现在 `.app-main-shell` 与 sidebar underlay 与原生窗口玻璃材质严格对齐。

---

## Improvements

- **会话时间线**：对话视图与全部视图切换时事件身份保持一致；阶段模型（Understanding / Planning / Editing / Verifying / Waiting / Reviewing / Complete）统一收口。
- **设置冷启动**：sidebar IPC 延迟到首次展开；`/settings` 冷启动复用缓存，首屏可见更快。
- **历史列表**：后端新增 `list_runs_lite`，200+ 个 Run 秒开，前向到会话对话框瞬时响应。
- **会话恢复**：长会话初次渲染有界，避免一次性 hydrate 大量事件。
- **侧栏设置**：设置项按需加载，避免无意义全量 hydrate。
- **i18n**：UI 文本统一走 `t('key')`，新增条目在 `messages/en.json` 与 `messages/zh-CN.json` 同步；`npm run i18n:check` 强制 key 对齐。
- **架构约束**：新增 `architecture-lifecycle` skill + `scripts/architecture/*` 边界检查；God Object 拆分进入持续节奏。

---

## Bug Fixes

- 修复 macOS 主内容圆角与 sidebar 合成背景在浅色 / 深色主题、native glass on/off、sidebar 折叠 / 展开下出现的透明漏底与色块。
- 修复长会话恢复与同步路径上的计时器绑定边界（`5074b025`）。
- 修复 Attention Queue UI 与持久化 WAL 在跨端同步时的背离（`e35bfdc2`）。
- 修复 stdin 写失败时已出队消息被静默丢弃的问题（`aac9cd13`）。
- 修复前端 reactivity 残留与重复导入（`24a456e6`）。
- 修复 Android `session_lifecycle.timestamp_ms` 类型（`4203d9c5`）。
- 修复 CI 锁链上的 contract gates / doc lint / Android build 偶发不通（PR #15）。

---

## Known Issues

- **7 天真实项目 soak 未完成**：性能预算（10,000 Timeline Event ≥ 55 FPS、10,000 行 Diff p95 ≤ 500ms 等）暂以目标形式记录，缺真实采样数据。计划在 v1.1.1 期间补齐。
- **macOS 截图视觉回归门禁尚未自动化**：圆角修复的视觉验证目前依赖手工检查；视觉回归脚本将随 v1.1.1 一起入库。
- **MCP App Canvas 未交付**：v1.1.0 不包含交互式 MCP App 的 Host，列为 v1.2.0 路线图。
- **完整多 Agent 自主组织未交付**：当前 `executeAgent` 仍是 mock，Task 隔离和并行委派以窄范围出现；复杂多 Agent 协作列为 v1.2.0。
- **Personal AI / Life Assistant 延后**：与「工程工作台」主线差异过大，明确不在 v1.1.0 范围。
- **Teams 实时协作平台延后**：当前 Teams chat 仍偏本地 mock，不扩大假能力。
- **完整 IDE 不在范围**：MiWarp 是 Agent Workbench，不与 VS Code 正面重造编辑器。
- **完整 Dev Container / Remote Sandbox 未交付**：Environment Capsule 当前只覆盖 Local 与 Worktree；Docker / Podman Adapter 列为 v1.1.1。

---

## Upgrade Notes

### 从 v1.0.9 升级

1. **本地数据无破坏**：所有 v1.0.9 的 Run / Session / 设置 / 主题 / localStorage 键保持兼容；新引入的 `~/.miwarp/tasks/`、`~/.miwarp/run_journal/`、`~/.miwarp/attention/` 为新目录。
2. **新版本号同步**：
   - `package.json` → `1.1.0-rc.1`（自动 `npm run version:sync` 写入 `src-tauri/tauri.conf.json` 与 `src-tauri/Cargo.toml`）。
   - 桌面端 Tauri 窗口标题显示 `MiWarp v1.1.0-rc.1`。
3. **i18n 完整性**：升级后请运行 `npm run i18n:check`，确保 `en.json` / `zh-CN.json` 与代码 key 对齐；缺失条目会在控制台输出。
4. **首次启动 Attention Queue 初始化**：升级后第一次启动会执行一次 `attention_queue::reconcile`，从已有 Run Journal / Tasks 数据回填待处理项；过程不阻塞主界面，但持续数秒。
5. **Worktree 复用**：v1.0.9 已存在的 Git Worktree 在新版本中可被 Task 直接复用；删除 Worktree 前会检查未提交 / 未推送状态。
6. **回滚策略**：保留 v1.0.9 启动入口 `MiWarp v1.0.9` 备份在 `~/.miwarp/release-history.json`；如需回滚，运行 `npm run release` 选择上一个 tag。

### 开发者升级

1. **架构检查**：升级后请运行 `npm run arch:check`，确保 `direction / layers / cycle / budget / tauri-contract / ios-ws-contract / cross-platform-bus / mobile-bus-contract / runtime-contract` 全部通过。
2. **新增 store / composable**：必须落到对应域子目录（`chat / prompt / tasks / runtime / attention / workspace / trace`），禁止回填到 `+layout.svelte` 或 chat 页面。
3. **新增 IPC 命令**：必须在 `src-tauri/src/models.rs` 的 `BusEvent` 枚举注册，并在 `broadcaster::event_type_name` 注册；前端 `src/lib/types/bus-events.ts` 同步。
4. **新增 UI 字符串**：必须走 `t('key')`，并在 `messages/en.json` 与 `messages/zh-CN.json` 同时新增。

### 移动端 Companion 同步

- iOS / Android 客户端保持与 v1.0.9 兼容；新增 `attention` 与 `task` 事件为增量事件，旧客户端忽略即可。
- 完整多设备状态收敛在 v1.1.1 推进。

---

## Reference

- 计划书：[`docs/PLAN_V1.1.0.md`](./PLAN_V1.1.0.md)
- 冻结条件检查：[`docs/v1.1.0-rc-checklist.md`](./v1.1.0-rc-checklist.md)
- 12 领域毕业标准：[`docs/core-experience-v1.md`](./core-experience-v1.md)
- 趋势与证据池：[`docs/V1.1.0_TREND_RADAR.md`](./V1.1.0_TREND_RADAR.md)
- 完整变更日志：[`CHANGELOG.md`](../CHANGELOG.md)
- RC 流程：[`docs/RELEASE_PROCESS.md`](./RELEASE_PROCESS.md)
