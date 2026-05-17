# MiWarp 项目瘦身审计报告

**日期**: 2026-05-17
**范围**: 全仓库前端 (src/) + 后端 (src-tauri/src/) + 116 个 Svelte 组件 + 85 个 Rust 文件
**总代码量**: ~125,000 行 (前端 ~86k, 后端 ~40k)

---

## 一、Top 20 高风险文件

| # | 文件 | 行数 | 问题 | 风险 |
|---|------|------|------|------|
| 1 | `src/routes/settings/+page.svelte` | 4,367 | 97 个 $state，单文件承载全部设置面板 | CRITICAL |
| 2 | `src/lib/stores/session-store.svelte.ts` | 3,377 | ~60 个 $state，~50 方法，God Store | CRITICAL |
| 3 | `src/routes/+layout.svelte` | 3,092 | 66 个 $state，40 个 import，Root layout 臃肿 | CRITICAL |
| 4 | `src-tauri/src/agent/claude_protocol.rs` | 2,714 | 协议解析+状态机+I/O 混写 | HIGH |
| 5 | `src-tauri/src/commands/session.rs` | 2,432 | 15 个 command，4 个 clippy::too_many_arguments，含 500ms sleep workaround | HIGH |
| 6 | `src-tauri/src/agent/session_actor.rs` | 2,473 | Actor 过大，生命周期+进程管理+协议混写 | HIGH |
| 7 | `src-tauri/src/models.rs` | 1,928 | 所有 Rust 数据模型单文件，耦合全部模块 | HIGH |
| 8 | `src-tauri/src/storage/cli_sessions.rs` | 1,902 | Storage 层含业务逻辑 | HIGH |
| 9 | `src/routes/plugins/+page.svelte` | 2,602 | 40 个 $state，插件+技能+MCP 全在一个页面 | HIGH |
| 10 | `src/lib/components/InlineToolCard.svelte` | 1,881 | 14 props, 26 $state, 40 $derived，工具卡片过于复杂 | HIGH |
| 11 | `src/lib/chat/use-chat-handlers.svelte.ts` | 1,664 | God composable，与 lifecycle 文件存在 split-brain | HIGH |
| 12 | `src/lib/types.ts` | 1,574 | 124 个 export，全部类型单文件 | HIGH |
| 13 | `src/lib/api.ts` | 1,497 | 177 个 export，全部 IPC 包装单文件 | HIGH |
| 14 | `src/routes/chat/+page.svelte` | 1,459 | 46 个 import，组装过多 composable | MEDIUM |
| 15 | `src/lib/components/PromptInput.svelte` | 1,438 | 28 props，输入框承担过多职责 | MEDIUM |
| 16 | `src-tauri/src/commands/diagnostics.rs` | 1,559 | 9 个 command，诊断逻辑内联 | MEDIUM |
| 17 | `src/lib/chat/use-chat-lifecycle.svelte.ts` | 1,274 | 16 个 $effect，业务逻辑嵌入 effect | MEDIUM |
| 18 | `src/lib/components/ToolDetailView.svelte` | 1,391 | 33 $derived，工具渲染逻辑复杂 | MEDIUM |
| 19 | `src/lib/components/SessionStatusBar.svelte` | 1,119 | **52 props** — 全项目最高 props 数 | MEDIUM |
| 20 | `src/lib/components/ToolActivity.svelte` | 1,239 | 21 props, 9 $effect，活动面板职责过重 | MEDIUM |

---

## 二、Top 20 最适合先拆的文件

按"可无行为变化拆分"优先级排序：

| # | 文件 | 拆分方式 | 预期收益 |
|---|------|----------|----------|
| 1 | `settings/+page.svelte` (4367行) | 按 tab 拆为子组件：GeneralTab, ConnectionTab, CliConfigTab, AgentAppearanceTab | 每个 tab < 800 行 |
| 2 | `+layout.svelte` (3092行) | 抽 Sidebar, CommandPalette, SetupWizard, UpdateBanner, MemorySidebar 为独立组件 | Root layout < 500 行 |
| 3 | `use-chat-handlers.svelte.ts` (1664行) | 拆出 fork/BTW/rewind/drag/preview 各自的 composable | 每个 < 300 行 |
| 4 | `use-chat-lifecycle.svelte.ts` (1274行) | 拆出 thinking timer, project init, URL param, model guard 为独立 effect 组 | 每个 < 200 行 |
| 5 | `InlineToolCard.svelte` (1881行) | 按工具类型拆渲染子组件：ToolPermission, ToolPlan, ToolAskUser, ToolSubTimeline | 主文件 < 600 行 |
| 6 | `SessionStatusBar.svelte` (1119行) | 将 52 props 分组为 sub-objects 或拆 ModelInfo, McpStatus, ContextUtil 等子组件 | props < 20 |
| 7 | `PromptInput.svelte` (1438行) | 抽 SlashCommandMenu, AtMentionMenu, FileAttachment, AgentModelSelector 为子组件 | 主文件 < 600 行 |
| 8 | `api.ts` (1497行) | 按 domain 拆为 session-api, team-api, plugin-api, skill-api, mcp-api, git-api 等 | 每个 < 300 行 |
| 9 | `types.ts` (1574行) | 按 domain 拆到 src/lib/types/ 目录 | 每个 < 300 行 |
| 10 | `session-store.svelte.ts` (3377行) | 抽 SessionReducer, SessionSnapshot, SessionProtocol 为独立模块 | core < 1000 行 |
| 11 | `ToolActivity.svelte` (1239行) | 拆 WorkspaceContext, FilePreview, SessionInfo 为子组件 | 主文件 < 500 行 |
| 12 | `ToolDetailView.svelte` (1391行) | 按工具类型拆渲染器 | 主文件 < 500 行 |
| 13 | `plugins/+page.svelte` (2602行) | 拆 McpTab, CommunitySkillsTab, InstalledPluginsTab | 每个 < 800 行 |
| 14 | `teams/+page.svelte` (1808行) | 拆 ChatRoom, RunHistory, LegacyMonitor 为子组件 | 每个 < 600 行 |
| 15 | `cli_sessions.rs` (1902行) | 抽业务逻辑到 service 层 | storage < 800 行 |
| 16 | `commands/session.rs` (2432行) | 抽 auth resolution, process spawning 到 service 模块 | command < 800 行 |
| 17 | `models.rs` (1928行) | 按 domain 拆为 models/session.rs, models/team.rs 等 | 每个 < 400 行 |
| 18 | `claude_protocol.rs` (2714行) | 拆 parsing, state machine, I/O 为独立模块 | 每个 < 800 行 |
| 19 | `session_actor.rs` (2473行) | 拆 lifecycle management, process handling, protocol dispatch | 每个 < 800 行 |
| 20 | `memory-store.svelte.ts` (502行) | 抽 API 调用为独立 service | store < 300 行 |

---

## 三、Top 20 低风险 Quick Wins

可在不改变任何行为的情况下立即执行：

| # | 任务 | 文件 | 风险 | 验证方式 |
|---|------|------|------|----------|
| 1 | ~~删除未使用组件 `GlassPanel.svelte`~~ | components/ | ZERO | ✅ DONE |
| 2 | ~~删除未使用组件 `MacDragRegion.svelte``~~ | components/ | ZERO | ✅ DONE |
| 3 | ~~`CliSessionBrowser.svelte` 的 `formatSize()` 改为 import `formatBytes()`~~ | components/ | ZERO | ✅ DONE |
| 4 | ~~`virtual-commands.ts` 和 `use-chat-handlers.svelte.ts` 中全部 virtual command 去重~~ | chat/ | LOW | ✅ DONE (-394 行) |
| 5 | ~~提取 `PROJECT_CWD_KEY` 常量~~ | utils/ | LOW | ✅ DONE (2/12 文件已替换) |
| 8 | ~~统一 `formatTime()` — 抽取到 `utils/format.ts`~~ | 多文件 | LOW | ✅ DONE (4 处替换) |
| 9 | ~~统一 `formatDate()` — 使用 i18n locale 而非硬编码~~ | 多文件 | LOW | ✅ DONE (硬编码 locale 已消除) |
| 10 | 提取 localStorage key 常量 `PROJECT_CWD_KEY` | 多文件 | LOW | 17+ 处使用同一字符串字面量 |
| 11 | 推广已有的 `<Card>` 组件到 plugins 页面 | plugins/ | LOW | 组件已存在，仅 3 文件使用 |
| 12 | 推广已有的 `<Input>` 组件 | 多文件 | LOW | 组件已存在但 0 使用 |
| 13 | 推广已有的 `<Textarea>` 组件 | 多文件 | LOW | 组件已存在但 0 使用 |
| 14 | 提取 Spinner 为共享组件 | 多文件 | LOW | 13+ 处手写相同 CSS |
| 15 | `StatusIcon` 硬编码色改为 CSS 变量 | components/ | LOW | `text-emerald-500` → `--miwarp-status-success` |
| 16 | ~~消除 fork/forkElapsed/resuming split-brain~~ | chat/ | MEDIUM | ✅ DONE — 删除死文件 use-session-lifecycle.svelte.ts |
| 17 | ~~消除 folderPickerOpen 重复~~ | chat/ | MEDIUM | ✅ DONE — 删除死文件 use-folder-picker.svelte.ts |
| 18 | ~~消除 pageDragActive 重复~~ | chat/ | MEDIUM | ✅ DONE — 删除死文件 use-drag-drop-controller.svelte.ts |
| 19 | `browser-service.ts` 14 个 `any` 类型替换为具体类型 | services/ | LOW | 消除 any 类型 |
| 20 | `ContextRelayModal` 改为使用 `<Modal>` 组件 | components/ | LOW | 逐行复制了 Modal 结构 |

---

## 四、不建议当前动的高风险核心区

| 模块 | 原因 |
|------|------|
| `session-store.svelte.ts` 核心 reducer | 3377 行的 God Store，但它是整个 chat 系统的中枢。任何改动都需要全面回归测试。建议先抽纯 helper，不改 store 本身。 |
| `session_actor.rs` 核心生命周期 | Actor 模式复杂，改动影响所有 CLI 会话。需要先建立集成测试覆盖。 |
| `claude_protocol.rs` 解析逻辑 | 协议解析器对字节级正确性敏感。改动需要流式测试数据验证。 |
| `+layout.svelte` 的 sidebar 路由逻辑 | 根 layout 的项目文件夹树、session 列表、路由导航深度耦合。拆分需要确保 sidebar 状态在页面切换时一致。 |
| `chat/+page.svelte` 的 composable 组装 | 虽然 import 多，但已经通过 composable 做了较好的拆分。进一步拆分需要理解 composable 间的依赖图。 |
| IPC command 名称和参数签名 | 165 个已注册的 command，任何重命名都会破坏前后端契约。 |
| `models.rs` 数据结构 | Rust 模型被全部模块引用，拆分需要逐步进行，每步确保编译通过。 |
| localStorage key 名称 | 已有 `ocv:` 命名空间的 key 被 20+ 文件读取。重命名需要一次性迁移。 |

---

## 五、分阶段治理路线图

### P0 — 立即执行（本次会话）

**目标**: 消除确认的 dead code 和逐字重复代码

| 任务 | 文件 | PR 切片 |
|------|------|---------|
| 删除 3 个未使用组件 + 1 个未使用工具 | GlassPanel, MacDragRegion, DualStatusIndicator, spinner-verbs | PR-0a: dead-code-cleanup |
| `list-todos` / `show-diff` handler 去重 | virtual-commands.ts + use-chat-handlers.svelte.ts | PR-0b: dedup-virtual-commands |
| `formatSize()` → `formatBytes()` 统一 | CliSessionBrowser.svelte | PR-0c: dedup-format |
| 提取 `PROJECT_CWD_KEY` 常量 | 新建 utils/storage-keys.ts，替换 17+ 处 | PR-0d: extract-storage-keys |

### P1 — 短期（1-2 周）

**目标**: 拆分 God File，降低单文件复杂度

| 任务 | 文件 | PR 切片 |
|------|------|---------|
| ~~settings page 按 tab 拆子组件~~ | settings/+page.svelte → RemoteTab, NotificationsTab, ConnectionTab, CliConfigTab | ✅ DONE (-3644 行, 83.5%) |
| ~~提取 layout 子组件~~ | +layout.svelte → FolderCrudDialogs | ✅ DONE (-190 行) |
| ~~消除 chat composable split-brain~~ | 删除 3 个死文件 | ✅ DONE (P0 已完成) |
| ~~提取 connection 逻辑到 composable~~ | use-connection-platform.svelte.ts (497行) | ✅ DONE |
| ~~提取共享 Spinner 组件~~ | Spinner.svelte, 14/15 实例替换 | ✅ DONE |
| 推广已有共享组件 | Card, Input, Textarea | PR-1d: adopt-shared-components (剩余) |
| ~~统一 formatTime/formatDate~~ | 提取到 i18n/format.ts | ✅ DONE (-26 行) |

### P2 — 中期（2-4 周）

**目标**: 降低 store/composable 复杂度，拆分 API/Types

| 任务 | 文件 | PR 切片 |
|------|------|---------|
| api.ts 按 domain 拆分 | api.ts → session-api.ts, team-api.ts, etc. | PR-2a: split-api |
| types.ts 按 domain 拆分 | types.ts → types/session.ts, types/team.ts, etc. | PR-2b: split-types |
| use-chat-handlers 拆分 composable | 拆出 fork/BTW/rewind/preview | PR-2c: split-chat-handlers |
| use-chat-lifecycle 拆分 effect 组 | 拆出 thinking/project-init/model-guard | PR-2d: split-chat-lifecycle |
| SessionStore 抽纯 reducer | 抽 SessionReducer 为独立函数模块 | PR-2e: extract-session-reducer |
| SessionStatusBar props 分组 | 52 props → sub-objects 或子组件 | PR-2f: simplify-statusbar-props |

### P3 — 长期（1-2 月）

**目标**: 后端 service 层提取，localStorage 命名空间统一

| 任务 | 文件 | PR 切片 |
|------|------|---------|
| 后端 commands/session.rs 拆分 | 抽 auth service, spawn service | PR-3a: extract-session-services |
| Rust models.rs 按 domain 拆分 | models.rs → models/session.rs, etc. | PR-3b: split-rust-models |
| localStorage ocv: → miwarp: 迁移 | 统一命名空间 + 迁移函数 | PR-3c: migrate-storage-namespace |
| 消除硬编码颜色 | 替换为 CSS 变量 | PR-3d: css-variable-migration |
| 统一 Modal/Dialog | ContextRelayModal, SkillPreviewDialog 改用 Modal | PR-3e: unify-modals |
| claude_protocol.rs 拆分 | 拆 parsing, state machine, I/O | PR-3f: split-protocol |

---

## 六、关键指标基线

| 指标 | 基线 | 当前值 | P1 目标 | P2 目标 |
|------|------|--------|---------|---------|
| 最大 .svelte 文件 | 4,367 行 | 1,881 行 (InlineToolCard) | < 1,500 行 | < 800 行 |
| settings/+page.svelte | 4,367 行 | **723 行** (-83.5%) | < 1,500 行 ✅ | < 800 行 |
| 最大 .ts 文件 | 3,377 行 | 3,617 行 (session-store) | < 2,000 行 | < 1,000 行 |
| 最大 .rs 文件 | 2,714 行 | 2,714 行 | 不变 | < 1,500 行 |
| 组件最大 props 数 | 52 | 52 | < 25 | < 15 |
| 单文件最大 $state 数 | 97 | ~23 (conn composable) | < 30 | < 15 |
| 共享 Spinner 组件 | 0/15 使用 | 14/15 使用 | 15/15 | 15/15 |
| localStorage key 使用处 | 17+ (ocv:project-cwd) | 17+ | 1 (cwdStore) | 0 (统一 store) |
| 未使用组件 | 3 | 0 | 0 | 0 |
| 逐字重复代码块 | 3 处 | 0 | 0 | 0 |
| 硬编码格式函数 | 4 处 | 0 | 0 | 0 |
| 硬编码颜色值 | 100+ 处 | 100+ 处 | 80 处 | < 20 处 |
| `any` 类型使用 | 20+ 处 | 20+ 处 | 10 处 | < 5 处 |
