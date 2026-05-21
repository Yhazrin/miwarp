# MiWarp 设计改进：从 Codex/Cowork 学习心得

基于对 MiWarp 项目源码的全面分析，结合对 Codex/Cowork 产品定位和设计理念的理解，以下是从 Codex/Cowork 中值得借鉴的关键设计模式，以及针对 MiWarp 的具体落地建议。

---

## 一、整体产品定位对比

| 维度 | Codex/Cowork | MiWarp |
|------|-------------|--------|
| 核心定位 | 纯云端 Web 应用，通过浏览器访问 | 本地桌面应用 (Tauri)，数据本地存储 |
| AI 模型 | 统一托管，用户无需配置 | 支持多种 agent (Claude Code、Codex)，需用户配置 |
| 会话管理 | 云端持久化，自动保存 | 本地运行历史，支持 fork、rewind |
| 团队协作 | 实时协作、评论、状态同步 | 团队 dispatch、并行运行 |

Cowork 的核心优势在于**无需安装、云端同步、协作体验**。MiWarp 作为本地应用可以借鉴其**交互设计和状态管理**理念，但要保持本地优先的核心价值。

---

## 二、可借鉴的具体设计

### 1. 会话状态感知与上下文感知交互

**Cowork 的设计：** Cowork 能感知当前会话的状态（思考中、输入中、等待工具批准），并在 UI 上提供精确的状态指示。

**MiWarp 现状：** MiWarp 的 `SessionStore` 已经有 `phase`、`streamingText`、`pendingToolPermissions` 等状态，`SessionStatusBar` 和 `ChatConversationStage` 负责展示。但状态转换逻辑分散在多个 `$effect` 中。

**改进建议：**
- 在 `SessionStore` 中增加一个统一的 `sessionActivity` 派生状态，类似于：
  ```typescript
  type SessionActivity = 'idle' | 'thinking' | 'streaming' | 'waiting_approval' | 'paused'
  ```
- 创建一个 `useSessionActivity` composable，集中管理状态转换动画的触发条件
- 为不同 activity 状态设计专属的视觉动画（如 thinking 时的心跳光效、waiting_approval 时的脉冲边框）

### 2. 工具调用折叠与批次分组

**Cowork 的设计：** 在 Cowork 的 chat UI 中，多个连续的工具调用被自然地组织在一起，用户可以选择展开查看细节或折叠保持简洁。

**MiWarp 现状：** MiWarp 已有 `useToolBurstCollapse` composable (`src/lib/chat/use-tool-burst-collapse.svelte.ts`)，负责工具爆发折叠。`InlineToolCard` 已经有折叠机制，`GuidedToolTimelineRow` 提供了引导式时间线展示。

**改进建议：**
- 引入**视觉批次标识**：在折叠的工具批次左侧显示一个小图标（如 "3 tools" 徽章），点击展开
- 折叠时显示工具摘要：`✓ Read 3 files, ✦ Wrote 2 files, ✎ Edited app.py`
- 参考 Notion/Figma 的折叠卡片设计：折叠状态下显示一个紧凑的"摘要条"，hover 时轻微放大，展开动画流畅

### 3. 思考过程（Thought Process）的优雅展示

**Cowork 的设计：** Cowork 将 AI 的思考过程展示为一个可展开/折叠的层级区域，采用半透明背景 + 左侧竖线 + 渐进式动画。

**MiWarp 现状：** `ChatMessage.svelte` 中已有 `thinkingText` 的折叠展示。`ChatThinkingPanel.svelte` 和 `ChatThinkingIndicator.svelte` 提供了独立的 thinking 面板。`useThinkingTimer` 跟踪思考耗时。

**改进建议：**
- **思考内容打字机效果**：thinking 文本渐入而不是直接出现，配合光标闪烁
- **思考耗时提示**：在 thinking 折叠按钮旁边显示 "思考中 · 12s"，让用户感知 AI 在工作
- **分层思考展示**：对于超长思考内容，可以折叠成多层级（如 "Phase 1: 分析需求 (2s)" → "Phase 2: 规划实现 (5s)"）
- 背景色使用深色主题下更柔和的渐变（MiWarp 已使用 `bg-deep`，可以考虑进一步区分 thinking 和普通内容区域）

### 4. 命令面板（Command Palette）的体验

**Cowork 的设计：** Cowork 的命令面板支持模糊搜索、命令分类、快捷键提示和使用频率排序。

**MiWarp 现状：** `CommandPalette.svelte` (705 行) 已经有非常完善的功能：
- fuzzy/basic 搜索模式切换
- 命令分类（chat/tools/navigation/settings/diagnostics）
- 使用频率统计（`miwarp:command-usage-stats` localStorage）
- Tab 预览功能
- 底部 Quick Actions Bar（工作流、技能、历史）

**改进建议：**
- **增加命令图标**：目前的命令只有 fallback search 图标，可以为每个命令添加语义化的 SVG 图标
- **命令搜索的高亮**：当前的 `highlightMatches` 来自 `$lib/utils/fuzzy`，但 UI 上没有显示高亮匹配
- **最近使用命令的置顶优化**：在最近命令section中使用频率统计，让常用命令更突出
- **Tab 预览优化**：预览信息可以更丰富，比如显示该命令会打开的具体页面/触发的具体动作

### 5. 工具卡片（Tool Card）的视觉层次

**Cowork 的设计：** Cowork 的工具执行结果采用卡片式展示，包含：状态图标、执行时间、输出预览、展开/折叠控制。

**MiWarp 现状：** `InlineToolCard.svelte` (1965 行) 是一个核心组件，包含：
- 状态图标 (`StatusIcon`)
- 工具详情 (`ToolDetailView`)
- 阶段指示器 (`PhaseIndicator`)
- 权限响应
- 任务通知

**改进建议：**
- **工具执行状态的微动画**：工具开始时有一个从左到右的进度条动画（类似 IDE 的 "索引中" 状态），完成后变为勾号
- **输出预览优化**：对于长输出的工具结果，前 3 行显示预览，后面折叠并显示 "展开 X 行输出"
- **工具色彩系统**：当前使用 `getToolColor` 获取工具颜色，可以考虑引入**工具类型图标**，让用户一眼区分 Read/Edit/Write/Bash 等操作
- **Phase 指示器**：MiWarp 已有 `PhaseIndicator` 和 `detectPhase`，但可以加强其视觉表达（如 "Planning" 阶段使用蓝色边框 + 虚线动画）

### 6. 侧边栏（Sidebar）的工具面板

**Cowork 的设计：** Cowork 的侧边栏提供文件树、工具历史、上下文使用情况等面板，通过胶囊式切换。

**MiWarp 现状：** `ToolActivity` 组件已实现了统一的工具面板，支持 `workspace`、`context`、`files`、`tasks` 等 tab。`toolPanelActiveTab` 和 `toolPanelIndicators` 管理 tab 状态。

**改进建议：**
- **面板切换动画**：当前 tab 切换是即时的，可以改为流畅的滑动过渡（300ms ease-out）
- **上下文使用指示器**：Cowork 的上下文利用率可视化值得借鉴。MiWarp 已有 `contextUtilization`、`contextWarningLevel`、`contextWindow`，但 `ContextWindowBar` 的展示可以更直观（如进度条 + 颜色编码）
- **工具活跃度指示器**：`toolPanelIndicators` 可以从简单的 boolean 升级为 `{ context: number, files: number, tasks: number }`，显示各面板的新增项目数badge

### 7. 团队协作与 Multi-Agent

**Cowork 的设计：** Cowork 支持团队成员在同一会话中协作，有实时的成员状态、评论和任务分配。

**MiWarp 现状：**
- `teams/+page.svelte` 实现了团队聊天室、TeamRun 历史监控
- `multi-agent/+page.svelte` 实现了多 Agent 并行执行，支持预设和自然语言配置
- `useTeamDispatch` 实现了团队派发功能

**改进建议：**
- **团队运行状态可视化**：当前 `activeTeamRuns` 只是数组，可以设计一个实时的 "团队任务面板"，显示每个 agent 的进度条和状态
- **并行 Agent 的交叉引用**：当多个 agent 在同一个项目中工作时，可以在工具卡片中显示 "由 @agent-name 执行"，方便追溯
- **团队 Dispatch 的 UI 改进**：`TeamDispatchConfirm` 可以增加更多预设的团队配置（如 "前端+后端"、"代码审查+测试"），让用户一键创建团队任务
- **Agent 身份展示**：`AgentIdentity` 可以更丰富，支持显示 agent 的头像/颜色/状态指示灯

### 8. 快捷键与键盘驱动交互

**Cowork 的设计：** Cowork 非常重视键盘驱动的工作流，快捷键覆盖了几乎所有常用操作。

**MiWarp 现状：** `KeybindingStore` 管理快捷键绑定，`KeybindingEditor` 提供编辑界面。`initLifecycleHandlers` 注册全局快捷键。`ChatInputDock` 和 `PromptInput` 处理输入相关的快捷键。

**改进建议：**
- **快捷键提示优化**：在命令面板底部显示 "↑↓ 导航 · Enter 执行 · Tab 预览"（已有），但可以在其他位置也显示相关快捷键，如：
  - 在 `ChatInputDock` 的发送按钮旁显示 `Cmd+Enter`
  - 在 `ChatToolbar` 的按钮上 hover 时显示快捷键
- **键盘导航增强**：当前方向键导航主要用于命令面板，可以扩展到消息列表（↑↓ 导航到上一条/下一条消息）
- **命令面板的 Cmd+K 快捷键**：当前 `ChatToolbar` 显示 `⌘K`，但没有在全局注册这个快捷键。可以考虑在 layout 中注册 `Cmd+K` 打开命令面板

### 9. 会话 Fork 与 Rewind

**MiWarp 独有且做得很好的功能：** Fork 和 Rewind 是 MiWarp 的核心差异化功能。

**Cowork 借鉴点：** Cowork 的版本历史和分支切换理念可以融入 Fork 的展示。MiWarp 的 `createForkOverlay` 和 `RewindModal` 已经相当完善，可以考虑以下增强：
- **Fork 分支可视化**：在会话顶部显示一个分支图，类似 git 的分支线，但更简洁（一个时间线 + 分叉点标记）
- **Fork 之间的快速切换**：通过快捷键 `Cmd+\` 在当前分支和 fork 分支之间快速切换
- **Rewind 的预览**：`RewindModal` 已经实现了预览，可以进一步显示 "rewind 后将丢失 X 条消息和 Y 个工具调用" 的警告

### 10. 欢迎屏幕（Welcome Screen）的个性化

**Cowork 的设计：** Cowork 根据用户的历史和当前项目状态，动态展示个性化的快捷操作和最近项目。

**MiWarp 现状：** `ChatWelcomeScreen.svelte` 提供了：
- Logo + 标题
- 继续上次会话按钮
- 快速操作（Analyze/Fix/Daily/Schedule）

**改进建议：**
- **基于最近历史的个性化提示**：如果用户最近在做代码审查，欢迎屏幕可以优先显示 "继续代码审查" 而不是通用的 "Quick Fix"
- **项目感知的快捷操作**：根据当前 `cwd` 检测项目类型（React/Node/Python），动态调整快捷操作列表。例如 Python 项目显示 "运行测试"，React 项目显示 "启动开发服务器"
- **"继续上次会话" 的信息增强**：除了显示相对时间，还可以显示会话的主题/标题（如 "继续：API 端点调试"）

---

## 三、技术架构层面的借鉴

### 1. Composable 架构的进一步深化

MiWarp 已经广泛使用 composable 模式（`createSendMessage`、`createChatActions`、`createTeamDispatch` 等），这是非常正确的方向。Cowork 同样采用高度模块化的 composable 架构。

**建议：**
- 将 `useTimelineState`、`useToolBurstCollapse`、`useConversationInsight` 等 composable 进一步抽象为标准模式（如统一的 `createXStore` 模式）
- Composable 之间的依赖通过显式的 `getter` 函数注入（MiWarp 已这样做），这使得测试和 mock 更容易

### 2. 事件中间件（Event Middleware）

**Cowork 的设计：** Cowork 通过事件中间件将 AI 的流式输出路由到正确的 UI 组件。

**MiWarp 现状：** `EventMiddleware` (`src/lib/stores/event-middleware.ts`) 已经实现了事件路由，`middleware.subscribeCurrent()` 在每个路由加载时调用。

**改进建议：**
- 考虑为不同类型的事件添加**优先级队列**（priority queue），确保高优先级事件（如权限请求）优先处理
- 添加事件去重机制（deduplication），避免网络波动导致的事件重复
- 事件处理的中间件链（middleware chain）可以更灵活，支持插件注册自己的事件处理器

### 3. 状态持久化策略

**Cowork 的设计：** 作为云端应用，Cowork 的状态持久化几乎是无感知的。

**MiWarp 的现状：** 混合策略 —— `localStorage` 用于 UI 状态（sidebar 宽度、主题），`~/.miwarp/` 用于数据持久化（运行历史、设置）。

**改进建议：**
- 可以引入一个统一的 `persistenceService`，将 localStorage 的键统一管理（避免 "ocv:" 前缀混乱）
- UI 状态（`sidebarCollapsed`、`toolPanelActiveTab`）应该能跨 session 保持
- 考虑为用户设置增加"导出/导入"功能，方便迁移

---

## 四、Cowork 特有但 MiWarp 可借鉴的理念

### 1. "对话即工作流" 的理念

Cowork 将每一次对话都视为一个可追溯的工作单元。对话历史不仅记录消息，还记录工具调用、文件变更、上下文变化。

**MiWarp 的落地：**
- 运行历史（`runs` 表）已经存储了丰富的信息。可以考虑增加"运行摘要"字段，由 AI 自动生成（如 "添加了 3 个 API 端点，修改了 5 个文件"）
- 运行历史列表可以增加"预览缩略图"——显示该运行中涉及的主要文件变更类型分布

### 2. 渐进式上下文加载

Cowork 通过虚拟滚动和按需加载处理长对话。

**MiWarp 的落地：**
- MiWarp 已有 `loadMoreEarlier` 机制（`useScrollNavigation`）
- 可以考虑在加载历史时显示一个进度指示器
- 对于超长会话（>1000 条 timeline 消息），可以建议用户使用 compact 或创建新会话

### 3. 权限模式的视觉一致性

Cowork 对不同权限级别有不同的视觉处理。

**MiWarp 的现状：** `permissionMode` 有 `default/acceptEdits/bypassPermissions/plan/auto/dontAsk` 等模式。`ChatMessage.svelte` 和 `ChatToolbar` 中已有体现。

**改进建议：**
- 为不同的 permission mode 设计专属的颜色/图标标识，让用户一眼识别当前权限级别
- 在 status bar 中显示权限模式指示器（当权限模式不是 default 时）

---

## 五、实施优先级建议

按从高到低的顺序：

1. **高优先级（快速提升体验）：**
   - 工具卡片的微动画和批次标识
   - 命令面板图标 + 搜索高亮
   - 欢迎屏幕的个性化增强
   - 快捷键在 UI 各处的可见性

2. **中优先级（提升沉浸感）：**
   - Thinking 过程的打字机效果和时长显示
   - 侧边栏面板切换动画
   - 上下文使用率的视觉化
   - 权限模式的视觉标识

3. **长期（架构改进）：**
   - Composable 标准化模式
   - 事件优先队列
   - 运行摘要自动生成
   - Fork 分支可视化

---

## 六、总结

Cowork 作为云端产品，其最大的设计优势在于**流畅的状态转换**、**精确的视觉反馈** 和 **协作友好的 UX**。MiWarp 作为本地桌面应用，已经具备了许多 Cowork 没有的能力（fork、rewind、离线运行、多 agent 并行），架构设计也相当扎实。

主要改进方向是：**将状态变化做得更有感知（微动画、视觉反馈）、将常用操作做得更快（快捷键、命令面板增强）、将团队协作做得更直观（并行 agent 可视化）**。

大部分改进都是纯 UI 层面的，不需要改变 Rust backend，投入产出比高。