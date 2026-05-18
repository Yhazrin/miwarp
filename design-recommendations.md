# MiWarp 设计改进建议报告

基于对 MiWarp 项目架构和 Codex Claude Cowork 设计理念的研究，以下是可在 MiWarp 中落地的设计改进建议。

## 一、核心交互设计

### 1.1 智能输入区域 (PromptInput)

**当前状态**: MiWarp 已有功能完善的 `PromptInput.svelte` (1496 行)，支持文件附件、@ 提及、斜杠命令、BTW 模式等。

**可改进的点**:

**增强的输入建议系统**: Codex Claude Cowork 风格的下拉建议在用户输入时实时出现，而非仅在触发 `/` 或 `@` 时。可考虑：

```typescript
// 在 PromptInput 中添加轻量级上下文建议
let contextSuggestions = $derived.by(() => {
  if (inputValue().length < 2) return [];
  // 基于最近的对话历史、打开的文件、选中的代码提供建议
  return getContextSuggestions(inputValue(), conversationHistory, openFiles);
});
```

**输入历史增强**: 当前已有 `input-history` 工具函数，可考虑增加：
- 基于语义相似性的历史搜索（输入 "修复 bug" 可找到之前相关的修复历史）
- 文件路径自动补全（当输入包含路径片段时）

### 1.2 消息展示 (ChatMessage)

**当前亮点**: MiWarp 的 `ChatMessage.svelte` 已支持动画、悬停操作（复制、回退、转发团队）、折叠长消息、思考过程显示。

**可参考的设计**:

**流式渐入效果**: 消息内容随流式输出逐渐显示，用户可提前阅读已输出的部分。可在 `MarkdownContent` 中添加逐行/逐段渲染动画。

**代码块交互增强**: 当前 `HighlightedCode.svelte` 已有代码高亮。可增加：
- 代码块一键复制（鼠标悬停时显示复制按钮）
- 多文件代码块支持（Claude 输出多个文件时）

### 1.3 命令面板 (CommandPalette)

**当前状态**: `CommandPalette.svelte` 已实现命令过滤、分组、Tab 预览、键盘导航。

**可改进的点**:

**模糊搜索**: 当前的 `filterCommands` 使用精确匹配，可考虑使用模糊匹配提升用户体验：

```typescript
function fuzzyMatch(query: string, candidate: string): boolean {
  const queryLower = query.toLowerCase();
  const candidateLower = candidate.toLowerCase();
  let qi = 0;
  for (const c of candidateLower) {
    if (c === queryLower[qi]) qi++;
  }
  return qi === queryLower.length;
}
```

**智能分类**: 根据用户最近使用模式动态调整命令优先级（最常用的命令优先显示）。

**快捷键覆盖提示**: 在命令面板中显示每个命令对应的快捷键（如果存在）。

## 二、会话管理

### 2.1 会话状态管理 (SessionStore)

**当前状态**: MiWarp 的 `SessionStore` (137KB, 137K 行) 是一个功能丰富的状态机，管理会话的完整生命周期。

**设计亮点可保留**:
- `SessionPhase` 状态机（empty → running → idle 等）
- `TurnUsage` 分段使用量统计
- 紧凑化 (`compact`) 和微紧凑 (`microcompact`) 机制

**可参考 Codex Claude Cowork 的改进**:

**会话书签**: 用户可以在长对话中标记重要节点，便于快速回溯。当前 `RewindModal` 已有回退功能，可扩展为书签系统：

```typescript
interface SessionBookmark {
  id: string;
  anchorId: string;      // 关联的时间线锚点
  label: string;          // 用户自定义标签
  createdAt: string;
}

// 在 SessionStore 中添加
bookmarks = $state<SessionBookmark[]>([]);
```

**会话分支视图**: 类似于 Git 的分支概念，用户可以查看当前会话的所有分支点。`session_actor.rs` 中的 fork 事件可用于实现此功能。

### 2.2 历史管理 (History)

**当前状态**: `ContextHistoryPanel.svelte` (17.6KB) 管理上下文历史。

**可改进的点**:

**时间线可视化**: 使用类似 GitHub 提交历史的可视化方式展示会话历史。`HeatmapCalendar.svelte` 可作为参考。

**语义搜索**: 用户可以搜索历史会话内容，而非仅按时间或项目过滤。可考虑集成轻量级搜索索引。

## 三、工具与权限系统

### 3.1 工具卡片 (InlineToolCard)

**当前状态**: `InlineToolCard.svelte` (85KB) 是 MiWarp 的核心组件之一，处理所有工具的展示。

**当前亮点**:
- 支持子时间线 (subTimeline)
- 延迟加载截断的工具结果
- 多种渲染级别 (verbose/summary/normal)
- 内联权限响应

**可改进的点**:

**工具执行时间线**: 显示工具的执行过程（类似 IDE 的后台任务面板），而非仅在完成后展示结果。

**工具预览增强**: 当工具涉及文件时，提供内联的差异预览（diff view）：

```typescript
// 在工具结果中检测文件差异
let diffPreview = $derived.by(() => {
  if (tool.tool_name === "Edit" && tool.tool_use_result) {
    return renderDiff(tool.tool_use_result);
  }
  return null;
});
```

### 3.2 权限面板 (PermissionsModal, PermissionPanel)

**当前状态**: MiWarp 已有完整的权限管理流程。

**可参考的设计**:

**智能权限建议**: 根据用户的历史授权行为自动建议权限模式：

```typescript
function suggestPermissionMode(
  tool: BusToolItem,
  history: PermissionHistory
): PermissionSuggestion {
  const patterns = analyzePatterns(history);
  if (patterns.autoApproves.includes(tool.tool_name)) {
    return { mode: "acceptEdits", confidence: "high" };
  }
  return { mode: "default", confidence: "low" };
}
```

**权限使用统计**: 在权限面板中显示各工具的权限使用频率，帮助用户理解哪些工具需要频繁授权。

## 四、Agent 系统

### 4.1 Agent 管理面板 (AgentsPanel)

**当前状态**: `AgentsPanel.svelte` (23KB) 管理内置和自定义 Agent。

**当前亮点**:
- 内置 Agent 列表 (Explore, Plan, General Purpose, Claude Code Guide, Statusline Setup)
- 支持创建、编辑、重命名、删除自定义 Agent

**可改进的点**:

**Agent 市场**: 类似于 `SkillMarketplace.svelte`，可构建一个 Agent 市场，用户可以分享和发现社区创建的 Agent。

**Agent 对比视图**: 当用户选择多个 Agent 时，提供并排的对比视图，展示各 Agent 的特点、可用工具、模型配置等。

### 4.2 内置 Agent 增强

**当前内置 Agent**:
- `Explore`: 代码库探索
- `Plan`: 软件架构规划
- `General Purpose`: 通用任务
- `Claude Code Guide`: Claude Code 使用指南
- `Statusline Setup`: 状态栏配置

**可添加的内置 Agent**:

```typescript
const enhancedBuiltInAgents: AgentDefinitionSummary[] = [
  {
    file_name: "code-review",
    name: "Code Review",
    description: "代码审查专家，专注于发现代码中的问题、性能优化机会和安全漏洞。",
    model: "sonnet",
    tools: ["Read", "Grep", "Glob", "Read"],
    scope: "built-in"
  },
  {
    file_name: "test-generator",
    name: "Test Generator",
    description: "根据代码生成测试用例，支持单元测试和集成测试。",
    model: "sonnet",
    tools: ["Read", "Write", "Glob"],
    scope: "built-in"
  },
  {
    file_name: "docs-writer",
    name: "Documentation Writer",
    description: "自动生成代码文档，包括 API 文档、README、使用指南。",
    model: "sonnet",
    tools: ["Read", "Write", "Glob"],
    scope: "built-in"
  }
];
```

## 五、调度任务系统

### 5.1 定时任务管理 (ScheduledTaskEditor, ScheduledTaskCard)

**当前状态**: `ScheduledTaskEditor.svelte` (27KB) 和 `ScheduledTaskCard.svelte` (8KB) 已实现完整的调度任务管理。

**当前亮点**:
- 友好的调度构建器 (FrequencyType: minutely, hourly, daily, weekly, monthly, custom_cron)
- Cron 表达式解析
- 单次执行和循环执行支持
- 执行监控 (`TaskExecutionMonitor`)

**可改进的点**:

**任务模板市场**: 用户可以分享和使用预定义的调度任务模板：

```typescript
const TASK_TEMPLATES = [
  {
    id: "daily-standup",
    name: "每日站会",
    description: "每天早上自动运行，汇总昨天的进展和今天的计划",
    prompt: "请总结昨天的工作进展和今天的计划...",
    schedule: { frequency: "daily", hour: 9, minute: 0 }
  },
  {
    id: "weekly-report",
    name: "每周总结",
    description: "每周五下午生成工作报告",
    prompt: "请分析本周的工作，生成一份简洁的报告...",
    schedule: { frequency: "weekly", weekday: 5, hour: 17, minute: 0 }
  }
];
```

**任务链**: 支持将多个任务串联执行，一个完成后自动触发下一个：

```typescript
interface TaskChain {
  id: string;
  name: string;
  tasks: ScheduledTask[];
  continueOnError: boolean;
}
```

**执行日历视图**: 使用日历组件 (可参考 `HeatmapCalendar`) 展示调度任务的执行计划。

## 六、UI/UX 增强

### 6.1 状态栏 (SessionStatusBar)

**当前状态**: `SessionStatusBar.svelte` (38KB) 提供了丰富的状态信息。

**当前亮点**:
- 模型选择器
- Token 使用统计
- MCP 服务器状态
- 上下文窗口使用率
- 工作目录显示
- 权限模式指示器

**可改进的点**:

**可折叠设计**: 当前已有 `ocv:statusbar-expanded` 状态保存，可考虑支持多个折叠级别（紧凑/详细/最小化）。

**实时性能指标**: 在状态栏显示当前会话的响应时间、Token 生成速度等性能指标。

### 6.2 侧边栏 (Sidebar)

**当前状态**: `Sidebar.svelte` (9KB) 和相关组件管理项目和会话导航。

**可改进的点**:

**虚拟化列表**: 当项目或会话数量较多时，使用虚拟滚动提升性能。已有 `VirtualList.svelte` (2KB)，可在更多场景中使用。

**拖拽排序**: 用户可以自定义侧边栏中项目或会话的顺序。

### 6.3 主题系统

**当前状态**: `ThemeEditor.svelte` (7KB) 和 `background-store.svelte.ts` (5KB) 管理主题配置。

**可改进的点**:

**预设主题市场**: 用户可以分享和使用社区创建的主题。

**动态主题**: 根据时间（白天/黑夜）或用户活动自动切换主题。

## 七、团队协作

### 7.1 团队运行 (TeamRunCard, TeamDispatchConfirm)

**当前状态**: `TeamRunCard.svelte` (8.7KB) 和 `TeamDispatchConfirm.svelte` (7KB) 管理团队协作。

**可改进的点**:

**实时协作视图**: 当多个用户同时参与同一会话时，显示各用户的活动状态和输入光标位置。

**角色管理**: 为团队成员分配不同角色（如 Reviewer, Approver, Executor），实现更细粒度的权限控制。

## 八、性能优化

### 8.1 虚拟化与懒加载

**当前状态**: MiWarp 已使用多种优化策略：
- 懒加载标签页 (`mountedTabs`)
- 延迟加载工具结果
- `VirtualList.svelte`

**可进一步优化**:

**消息虚拟化**: 对于长对话，使用虚拟列表而非渲染所有消息。当前 `ChatMessage.svelte` 组件在会话长度增加时可能遇到性能问题。

```typescript
// 使用 VirtualList 包装消息列表
<VirtualList
  items={messages}
  itemHeight={estimatedMessageHeight}
  visibleItems={20}
  renderItem={(msg) => ChatMessage({ message: msg })}
/>
```

**图片懒加载**: 当前 `FileAttachment` 已有图片支持，可增加Intersection Observer 实现的懒加载。

### 8.2 性能监控

**当前状态**: `fpsCounter` 和 `isPerfEnabled` 工具函数已存在。

**可改进的点**:

**性能面板**: 添加一个调试面板，显示关键性能指标：
- 消息渲染时间
- 工具卡片展开/折叠时间
- 侧边栏响应时间
- 内存使用情况

## 九、i18n 与本地化

### 9.1 当前状态

MiWarp 已使用 `src/lib/i18n/` 实现国际化，支持英文和中文。

### 9.2 可改进的点

**自动检测系统语言**: 在首次启动时自动检测用户系统语言并选择相应翻译。

**翻译贡献工作流**: 为社区翻译提供贡献指南和工作流。

## 十、安全与隐私

### 10.1 当前安全特性

MiWarp 已实现：
- OAuth 登录
- API Key 管理
- 权限模式控制
- MCP 服务器安全验证

### 10.2 可增强的安全特性

**会话加密**: 在本地存储会话数据时进行加密保护。

**隐私模式**: 用户可选择不在会话中记录特定敏感操作。

**审计日志**: 记录所有重要操作的审计日志，便于安全审查。

## 十一、插件系统

### 11.1 当前状态

`PluginCard.svelte` (9.3KB) 和 `PluginInstaller.svelte` (15KB) 已实现插件管理。

### 11.2 可改进的点

**插件市场**: 构建一个插件市场，用户可以发现和安装社区插件。

**插件沙箱**: 为第三方插件提供安全的执行环境，防止恶意代码影响主应用。

**插件市场评价**: 用户可以对已安装的插件进行评分和评论。

## 十二、可访问性 (A11y)

### 12.1 当前状态

MiWarp 使用 Tailwind CSS 和语义化 HTML。

### 12.2 可改进的点

**ARIA 标签**: 为所有交互元素添加完整的 ARIA 标签支持。

**键盘导航**: 确保所有功能可通过键盘完整操作，特别是命令面板和模态框。

**屏幕阅读器支持**: 测试主要功能在屏幕阅读器下的可用性。

## 十三、总结

MiWarp 已经是一个功能丰富的 Tauri 桌面应用，涵盖了 AI 代码助手的大部分核心功能。基于 Codex Claude Cowork 的设计理念，以下是最值得优先实施的改进：

**高优先级**:
1. 消息虚拟化（性能优化）
2. 智能输入建议系统（交互增强）
3. 会话书签功能（会话管理）
4. 模糊搜索（搜索体验）

**中优先级**:
5. 工具执行时间线（工具展示）
6. 调度任务模板市场（生态扩展）
7. Agent 市场（生态扩展）
8. 性能监控面板（调试体验）

**低优先级（可作为长期规划）**:
9. 实时协作视图（团队协作）
10. 插件沙箱系统（安全性）
11. 可访问性审计（A11y）
12. 动态主题系统（个性化）

---

*报告生成时间: 2026-05-17*
*基于 MiWarp 项目架构分析*