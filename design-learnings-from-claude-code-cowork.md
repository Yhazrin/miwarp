# MiWarp 借鉴 Claude Code / Cowork 设计模式报告

> 本报告基于对 Claude Code 及 Cowork 模式核心设计的研究，结合 MiWarp 当前架构，提出可落地的功能改进建议。

---

## 一、Session 管理

### 当前状态
MiWarp 已有 `SessionStore` 前端状态管理和 `session_actor.rs` 后端会话生命周期管理。每次会话通过唯一 ID 标识，会话历史持久化到 `~/.miwarp/`。

### Claude Code / Cowork 的设计
每个会话是离散隔离单元，有自己的状态和上下文。会话支持显式命名（在侧边栏和标签栏显示）。Cowork 环境下支持父会话广播能力，可派生子会话（Agent），子会话可读父会话的 transcript 并监控进度。当请求隔离模式（`isolation: "worktree"`）时，子会话在独立 git worktree 中运行。

### 对 MiWarp 的借鉴

**1. 具名会话 UI**
在会话创建后允许用户为会话命名，而非仅使用自动生成的 ID。存储 `session_name` 字段到会话元数据，在侧边栏和标签栏渲染可编辑名称。

**2. 会话预览**
在侧边栏会话列表中显示最近几条消息内容，无需完全加载即可预览（lazy preview）。这对快速定位历史会话很有帮助。

**3. 子会话与 worktree 集成**
`git-worktree-store.svelte.ts` 已实现 worktree 管理，可进一步与 Agent 工具链结合：
- 在 `multi-agent/+page.svelte` 中，当子 agent 需要隔离时，自动创建 worktree
- Agent 完成后通过 transcript 读取结果并合并
- 这与 CLAUDE.md 中"并行开发用 Git Worktree"的指引一致

---

## 二、Chat / Terminal UX

### 当前状态
xterm.js 终端渲染已有实现，流式输出在 `session_actor.rs` 中逐 token 处理。markdown 渲染和代码高亮在聊天区域呈现。

### Claude Code / Cowork 的设计
流式响应时实时渲染 markdown（而非等生成完毕再格式化）。代码块根据语言检测做语法高亮，hover 显示复制按钮。Diff 输出使用统一视图语义——增量为绿色、删减为红色、带行号。交互式确认（如 `Confirm? [y/n]`）被拦截并以 UI 对话框呈现，而非原始文本提示。

### 对 MiWarp 的借鉴

**1. 实时流式 markdown 渲染**
当前实现可能是流式输出到 terminal 区域，但聊天消息的 markdown 渲染可以考虑实时生成（逐 token append），提升用户感知的响应速度。

**2. Diff 视图增强**
`DiffModal.svelte` 已存在，可进一步增强：参考 Claude Code 的统一 diff 风格，增加行号显示、增删颜色高亮、折叠上下文等特性。

**3. CLI 确认对话框拦截**
当前 Tauri 命令可返回需要用户确认的操作，但可将 CLI 的交互式 prompts（如 `claude-code` 在需要批准时弹出的确认）拦截并渲染为 `ElicitationDialog.svelte` 风格的 UI 对话框，而非让用户直接在 terminal 中输入。这需要在 `session_actor.rs` 中识别特定模式的输出并触发事件。

---

## 三、文件操作

### 当前状态
MiWarp 通过 `api.ts` 封装了读写文件的 Tauri 命令。批量编辑目前直接执行。

### Claude Code / Cowork 的设计
编辑操作前有明确的用户确认步骤，批量修改前显示摘要视图（列出所有受影响文件及变更性质）。文件操作使用原子写入保证。多文件操作展示变更摘要后再执行。

### 对 MiWarp 的借鉴

**1. 批量编辑预览**
在多文件修改场景中（`session_actor` 处理 ToolUse 事件时），在执行前显示预览面板，列出所有待修改文件及变更概览，用户确认后再执行。与当前权限管理 (`PermissionsModal`) 结合是一个自然的切入点。

**2. 文件监听**
在 `session_actor.rs` 处理过程中，如果外部进程修改了相关源文件，可能导致缓存失效。可在特定场景下启用文件监听（Rust 的 `notify` crate），在检测到变更时通知用户刷新。

---

## 四、Project Context（CLAUDE.md）

### 当前状态
CLAUDE.md 已在 CLAUDE.md 中作为核心模式记录实现。MiWarp 加载 CLAUDE.md 内容并注入到 AI 会话上下文中。

### Claude Code / Cowork 的设计
CLAUDE.md 在会话启动时加载，并在文件被修改时自动刷新上下文（文件监听）。系统还检测 `.gitignore` 模式，在建议文件操作时自动遵守。Project 检测通过向上遍历目录树实现。

### 对 MiWarp 的借鉴

**1. CLAUDE.md 热重载**
当前在会话启动时加载 CLAUDE.md，但会话过程中修改文件不会自动更新上下文。可在 `session_actor.rs` 中加入对项目目录下 CLAUDE.md 的文件监听，当文件变更时自动将其内容更新到会话上下文。

**2. .gitignore 感知**
在文件浏览 (`FilesPanel.svelte`) 和文件选择器中，对 `.gitignore` 模式进行检测，隐藏被 ignore 的文件。这可在 `api.listFiles` 层级统一处理。

**3. Project 检测指示器**
在侧边栏中显示当前活跃的项目上下文（如项目名称、当前分支），让用户清楚知道自己处于哪个项目环境。

---

## 五、多 Agent / Team 协作

### 当前状态
MiWarp 已有 `TeamsStore`、team 相关 Tauri 命令和多 Agent 面板 (`multi-agent/+page.svelte`)。git-worktree-store 也已实现。

### Claude Code / Cowork 的设计
父子会话模型：父会话通过 Agent 工具派生子会话，子会话在 worktree 隔离中运行。通过 transcript 读取实现通信，父会话聚合子会话结果。Team 模式下多个 agent 可共享上下文空间，包含角色定义和权限范围。

### 对 MiWarp 的借鉴

**1. 子 Agent 派发**
将 `git-worktree-store.svelte.ts` 与多 Agent 工作流结合：当用户触发需要隔离的子任务时，自动创建 worktree，将子 agent 指向新 worktree 目录，执行后通过 transcript 读取结果。这需要 Rust 后端支持 worktree 的创建与管理（`spawn.rs` 中已有进程管理能力，可扩展）。

**2. Team 共享上下文**
在 `TeamsStore` 中增加共享上下文空间（shared context），团队成员可见并可访问。实现会话间的 context handoff。

**3. 任务交接协议**
当 team 中一个 agent 需要将任务交接给另一个时，通过结构化的 handover 消息传递上下文（而非简单的 chat history 复制）。

---

## 六、Activity Monitoring / 可观测性

### 当前状态
MiWarp 已有 `EventMiddleware` store 进行事件路由。`usage/+page.svelte` 页面展示使用情况。

### Claude Code / Cowork 的设计
所有操作都发出结构化事件（文件读写、命令执行、agent spawn、错误）。事件流经过 middleware 系统可路由到日志、存储或实时 UI。会话级指标包括消息数、token 使用量（若可用）、文件操作摘要、会话时长。Turn 级计时追踪每个模型轮次完成耗时。

### 对 MiWarp 的借鉴

**1. 增强 EventMiddleware 事件模式**
当前事件可能较为松散，可建立结构化事件 schema：统一的 event type + timestamp + payload 格式，便于前端渲染活动流和后端日志分析。

**2. 会话级指标聚合**
在 `usage/+page.svelte` 中增加会话级指标面板，展示当前会话的消息数、文件操作次数、会话时长、AI 模型使用量等。

**3. Transcript 搜索**
会话历史已有 transcript 存储，可增加搜索功能，支持按关键词、时间范围、agent 类型过滤。这对调试和审计都很有价值。

---

## 七、Settings / 个性化

### 当前状态
KeybindingStore (`keybindings.svelte.ts`) 已实现可配置的快捷键，支持覆盖保存到 settings。平台感知（macOS 符号渲染）也已实现。

### Claude Code / Cowork 的设计
设置采用层级优先策略：defaults < project-level (CLAUDE.md) < user-level < runtime 修改。快捷键配置界面展示所有可用命令及其当前绑定，允许重绑定并检测冲突。

### 对 MiWarp 的借鉴

**1. 层级设置系统**
当前设置较为扁平，可引入优先层级：default settings < project-level overrides < user settings < runtime modifications。例如，通过项目目录下的 `.miwarp.json` 允许项目级设置覆盖用户默认配置。

**2. 快捷键冲突检测**
KeybindingStore 中已有 `findConflict` 方法，可进一步在配置界面上实时显示冲突警告（当前可能有部分实现）。

**3. 设置预览**
更改设置后立即生效，无需重启。可在设置面板中对特定选项提供实时预览（如调整字体大小后即时反馈）。

---

## 八、Browser 集成

### 当前状态
MiWarp 的 `transport/` 抽象层已实现 `TauriTransport` 和 `WsTransport` 的切换。`web_server/` 使用 Axum。Browser 模式下 WebSocket 通信已有基础设施。

### Claude Code / Cowork 的设计
WebSocket 通信，认证中间件控制访问，静态文件服务和 WebSocket 升级请求处理。跨域请求的正确 CORS 处理。浏览器访问需要 session token 管理。

### 对 MiWarp 的借鉴

**1. WebSocket 认证**
当前 WebSocket 连接可能缺少认证机制。需要实现 session token 管理：为每个浏览器会话创建临时 token，验证后方可建立 WebSocket 连接。

**2. CORS 正确处理**
跨域请求的 CORS header 正确配置，确保在非本机浏览器访问时不会因 CORS 被阻止。

**3. 浏览器端 UI 适配**
当前 UI 主要为桌面设计，可在 `+layout.svelte` 中增加浏览器环境检测，对 toolbar、快捷键等做移动端/小屏适配。

---

## 九、Scheduled Task / 自动化

### 当前状态
MiWarp 已有 `scheduled-tasks-store.svelte.ts` 和 Rust 层的 cron 调度器 (`scheduler/`)。支持创建、更新、删除、立即运行任务，任务存储在 `~/.miwarp/`。

### Claude Code / Cowork 的设计
Scheduled task 系统使用 cron 表达式（在本地时区）定义任务计划。任务包含完全自包含的 prompt（每次运行不保留会话上下文记忆）、计划时间和元数据。一次性和循环任务均可，循环任务除非暂停或删除否则持续运行。

### 对 MiWarp 的借鉴

**1. 任务依赖管理**
当前任务之间相互独立，可引入依赖链：`task A runs after task B completes`。在 Rust 调度器中用 DAG 调度实现。

**2. 任务链触发**
一个任务完成后可触发另一个任务，适合 ETL 流水线类型的自动化场景。

**3. 增强通知系统**
任务完成/失败时，当前可能只是静默写入记录。可在 Cowork app 打开时发送通知（利用 Tauri 的 notification API），让用户及时了解任务状态。

---

## 十、Memory / 上下文保持

### 当前状态
`memory-store.svelte.ts` 实现了 Memory 文件管理（candidates 列表、content 编辑、consolidation、sync 状态）。包含 `consolidateMemory()` 方法用于合并重复条目和清理过时条目。

### Claude Code / Cowork 的设计
两层记忆系统：短期工作记忆（有限的 context window）和长期记忆（持久化知识库）。记忆可被查询以获取相关上下文。consolidation pass 定期执行，合并重复条目、修复过时事实、剪枝索引防止无限增长。记忆条目包含时间戳和来源归属。

### 对 MiWarp 的借鉴

**1. 语义搜索**
当前 memory 系统基于文件路径管理，可增加基于内容相似度的语义检索：用 embedding 模型将记忆内容向量化，查询时返回相关记忆条目。这需要存储层支持向量索引（可考虑 `sqlite-vec` 或 Qdrant 连接器）。

**2. 自动事实提取**
在会话 transcript 中自动提取关键事实（如"用户偏好使用 yarn 而非 npm"），写入记忆文件。可在 `EventMiddleware` 中处理 transcript 事件时触发此逻辑。

**3. 记忆来源归属**
每个记忆条目标注来源（哪个会话、哪个时间点），提升信任度和可追溯性。`memory-store.svelte.ts` 中的 `MemoryFileCandidate` 类型已包含部分元数据，可扩展。

---

## 十一、Plugin / Skill 系统

### 当前状态
MiWarp 有 `plugin-store.svelte.ts`（插件市场管理）和 `skill-store.svelte.ts`（技能系统）。技能系统支持内置技能（schedule、consolidate-memory、setup-cowork）和自定义技能。插件市场支持 MCP 连接器、社区技能搜索、marketplace 管理。

### Claude Code / Cowork 的设计
Plugin 系统将技能、命令和连接器打包。通过自然语言意图匹配插件并安装。Skill 是自包含的指令集，通过 slash 命令或上下文自动触发调用。技能可组合（一个技能引用另一个）。插件注册表维护元数据、描述、已安装状态和能力列表。

### 对 MiWarp 的借鉴

**1. 意图驱动的技能推荐**
在聊天输入中，当用户输入 `/` 或特定关键词时，除了现有技能列表外，可通过语义匹配推荐相关技能（类似 Claude Code 的自然语言触发）。`skill-store.svelte.ts` 的 `getSkillByName` 方法可扩展为模糊匹配。

**2. 技能组合**
一个技能的内容可引用另一个技能（如 `consolidate-memory` 在执行后自动触发 `schedule` 来创建定时整理任务）。在技能执行引擎中支持技能引用解析。

**3. 插件能力清单展示**
在 `ExtensionDetailPanel.svelte` 和 `ExtensionCard.svelte` 中展示插件能力的完整清单（与 Claude Code 展示 matchedCapabilities 一致），帮助用户理解每个插件的功能边界。

---

## 十二、其他值得借鉴的设计模式

### 1. Transport 抽象（已良好实现）
`$lib/transport/` 中 `getTransport()` 根据运行时环境返回 `TauriTransport` 或 `WsTransport`。这是 MiWarp 架构的核心优点之一，值得继续保持和强化。

### 2. 命令命名约定
Claude Code 使用的命令命名约定（如 `cli:interrupt`、`app:newChat`）与 MiWarp 当前实现风格相似，保持一致。

### 3. Session 分支隔离
多会话场景下，每个会话应工作在自己的 git 分支上防止干扰。MiWarp 的 `git-worktree-store.svelte.ts` 提供了技术基础，可在多 Agent 场景下强制执行分支隔离策略。

### 4. Pre-commit Hooks（已良好实现）
CLAUDE.md 中记录的 pre-commit hook（Rust fmt、Prettier、ESLint、svelte-check）已在项目中实现。

### 5. Conventional Commits（已记录）
提交信息规范已在 CLAUDE.md 中指定。

---

## 十三、实施优先级建议

按实现成本和用户价值分优先级：

| 优先级 | 改进项 | 原因 |
|--------|--------|------|
| **高** | CLI 确认对话框拦截 | 用户体验提升明显，技术改动局部 |
| **高** | Session 具名和预览 | UI 增强，成本低 |
| **高** | CLAUDE.md 热重载 | 开发者高频使用场景 |
| **中** | 语义记忆检索 | 需要嵌入模型或外部向量库依赖 |
| **中** | 批量编辑预览 | 与现有 PermissionsModal 结合 |
| **中** | 快捷键冲突检测 UI | KeybindingStore 已有 findConflict |
| **中** | 子 Agent worktree 隔离 | 结合现有 git-worktree-store |
| **低** | 任务依赖管理 | 调度器改动较大 |
| **低** | WebSocket 认证 | 需要安全架构设计 |

---

## 十四、结论

Claude Code / Cowork 与 MiWarp 在核心定位上高度相似（都是 AI 编程 CLI 的可视化包装），因此很多设计模式可以直接对应借鉴。最有价值的借鉴集中在：

1. **UX 增强**：实时流式渲染、CLI 确认拦截、Diff 视图标准化 — 提升用户感知质量
2. **多 Agent 协作**：worktree 隔离 + transcript 通信 — 让并行开发真正落地
3. **上下文管理**：CLAUDE.md 热重载、.gitignore 感知、层级设置系统 — 提升项目级体验
4. **Memory 系统**：语义搜索 + 自动事实提取 — 从文件管理进化到智能知识库

建议选择一个高优先级改进项（如"CLI 确认对话框拦截"或"Session 具名和预览"）作为试点，先小范围实现并收集反馈，再逐步扩展到其他改进项。