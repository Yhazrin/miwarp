# Claude Code / Cowork 设计模式学习报告

## 研究总结

基于 Claude Code CLI 和 Cowork 的设计模式分析，结合 MiWarp 当前实现，以下是可以落地的改进方案：

---

## 一、已实现的优秀设计（MiWarp 已覆盖）

MiWarp 已经很好地实现了以下 Claude Code 设计模式：

| 设计模式 | 状态 | 说明 |
|---------|------|------|
| Actor Model | ✅ | `session_actor.rs` - 每个 CLI session 一个 actor，通过 mpsc mailbox 顺序执行 |
| Turn Engine | ✅ | `turn_engine.rs` - 用户/内部 turn 分离，软/硬超时，activity-based deadline reset |
| Event Batching | ✅ | `event-middleware.ts` - 16ms microbatch，减少响应式更新 |
| Stream-JSON Parser | ✅ | `claude_protocol.rs` - 行式 JSON 解析，accumulator 状态管理 |
| Quarantine | ✅ | 进程卡死恢复机制 - interrupt → timeout → kill |
| Permission Routing | ✅ | 控制请求转发到前端，用户决定 |
| Forward Compatibility | ✅ | 未知事件作为 Raw 类型保留 |

---

## 二、改进方案

### 改进 1: 增强型命令面板 (Command Palette Pro)

**参考 Claude Code 的 `/` 快捷命令系统**

**当前问题**：
- CommandPalette 已有基础实现，但缺少：
  - 智能模糊搜索 (fuzzy search)
  - 命令分组和分类
  - 快捷键提示和预览
  - 最近使用记录
  - 上下文感知建议

**实施方案**：

1. **增强 Fuzzy 搜索**
```typescript
// 改进 fuzzy.ts
export function fuzzyMatch(query: string, candidates: CommandDef[]): CommandDef[]
```

2. **添加命令分类和图标**
```typescript
type CommandCategory = 
  | "navigation"    // 导航
  | "session"       // 会话控制
  | "tools"        // 工具执行
  | "settings"      // 设置
  | "agent"         // Agent 操作
```

3. **添加快捷键提示**
```typescript
interface CommandDef {
  shortcut?: string;  // 如 "Cmd+K"
  category: CommandCategory;
}
```

4. **实现最近命令**
```typescript
// 使用 localStorage 存储最近使用的命令
const RECENT_COMMANDS_KEY = "miwarp:recent-commands";
```

**文件改动**：
- `src/lib/components/CommandPalette.svelte` - 增强 UI
- `src/lib/utils/fuzzy.ts` - 改进搜索算法
- `src/lib/commands.ts` - 添加分类和元数据

---

### 改进 2: 智能上下文菜单 (Context-Aware Menu)

**参考 Claude Code 的 `@` 提及系统**

**参考 Claude Code 的快捷键系统**

**当前问题**：
- 没有上下文感知菜单
- 缺少文件/文件夹快速引用

**实施方案**：

1. **@ 文件提及**
```typescript
interface AtMentionMenu {
  items: FileItem[];
  fuzzySearch: boolean;
  showIcons: boolean;
}
```

2. **上下文感知过滤**
```typescript
function getContextAwareCommands(
  cwd: string,
  sessionState: SessionPhase,
  recentFiles: string[]
): CommandDef[]
```

3. **快速文件路径补全**
```typescript
// 在 PromptInput 中添加文件路径补全
function completeFilePath(input: string): Promise<string[]>
```

**文件改动**：
- `src/lib/components/AtMentionMenu.svelte` - 已有，增强功能
- `src/lib/utils/file-path.ts` - 文件路径补全工具

---

### 改进 3: 工作流模板 (Workflow Templates)

**参考 Claude Code 的 Skills 系统**

**当前问题**：
- Skills 系统已存在 (skill-store.svelte.ts)
- 但缺少预定义模板和工作流

**实施方案**：

1. **预定义工作流模板**
```typescript
const WORKFLOW_TEMPLATES = [
  {
    name: "Code Review",
    description: "Review code changes",
    steps: ["/review", "/feedback"],
    icon: "🔍"
  },
  {
    name: "Bug Fix",
    description: "Fix a bug with testing",
    steps: ["/test", "/review"],
    icon: "🐛"
  },
  {
    name: "Feature Development",
    description: "Develop a new feature",
    steps: ["/plan", "/implement", "/test"],
    icon: "✨"
  }
];
```

2. **模板执行器**
```typescript
async function executeWorkflow(
  template: WorkflowTemplate,
  context: { cwd: string; runId: string }
): Promise<void>
```

3. **自定义工作流**
```typescript
interface CustomWorkflow {
  id: string;
  name: string;
  commands: string[];
  createdAt: Date;
}
```

**文件改动**：
- `src/lib/stores/workflow-store.svelte.ts` - 新建
- `src/lib/components/WorkflowTemplate.svelte` - 新建

---

### 改进 4: 增强型终端体验 (Enhanced Terminal)

**参考 Claude Code 的终端集成**

**当前问题**：
- TerminalPane 已实现基础功能
- 缺少高级功能

**实施方案**：

1. **终端主题同步**
```typescript
// 与主应用主题同步
function syncTerminalTheme(theme: "light" | "dark"): void
```

2. **快捷命令执行**
```typescript
interface TerminalShortcut {
  key: string;
  description: string;
  action: string;
}
```

3. **输出过滤和搜索**
```typescript
interface TerminalSearch {
  query: string;
  caseSensitive: boolean;
  regex: boolean;
}
```

4. **输出折叠**
```typescript
interface CollapsibleOutput {
  id: string;
  startLine: number;
  endLine: number;
  collapsed: boolean;
}
```

**文件改动**：
- `src/lib/components/TerminalPane.svelte` - 增强

---

### 改进 5: 多 Session 管理面板

**参考 Claude Code 的多工作区支持**

**当前问题**：
- 多 session 支持但缺乏统一管理界面

**实施方案**：

1. **Session 概览面板**
```typescript
interface SessionOverview {
  activeSessions: SessionInfo[];
  recentSessions: SessionInfo[];
  pinnedSessions: SessionInfo[];
}
```

2. **Session 切换**
```typescript
interface SessionSwitcher {
  sessions: SessionInfo[];
  currentIndex: number;
  onSwitch: (index: number) => void;
}
```

3. **Session 状态监控**
```typescript
interface SessionMonitor {
  cpu: number;
  memory: number;
  tokenUsage: number;
  cost: number;
}
```

**文件改动**：
- `src/lib/components/CliSessionBrowser.svelte` - 已有，增强
- `src/routes/multi-agent/+page.svelte` - 已有，增强

---

## 三、优先级建议

| 优先级 | 改进 | 工作量 | 价值 |
|-------|------|--------|------|
| P0 | 增强型命令面板 | 中 | 高 |
| P1 | 智能上下文菜单 | 中 | 高 |
| P2 | 工作流模板 | 小 | 中 |
| P3 | 增强型终端 | 大 | 中 |
| P4 | 多 Session 管理 | 大 | 低 |

---

## 四、实施计划

### Phase 1: 增强型命令面板 (本周)
1. 改进 fuzzy 搜索算法
2. 添加命令分类和图标
3. 实现最近命令功能
4. 添加快捷键提示

### Phase 2: 智能上下文菜单 (下周)
1. 增强 AtMentionMenu
2. 实现文件路径补全
3. 添加上下文感知建议

### Phase 3: 工作流模板 (下下周)
1. 定义预置模板
2. 实现模板执行器
3. 添加自定义模板

---

## 五、技术细节

### Fuzzy 搜索算法改进

```typescript
// 当前实现简单匹配，改为评分制
function fuzzyScore(pattern: string, text: string): number {
  // 评分规则：
  // - 连续匹配 +2
  // - 单词边界匹配 +1
  // - 大写匹配 +0.5
  // - 顺序保持 +1
  // - 总分越高匹配越好
}
```

### 命令分类系统

```typescript
const CATEGORY_META: Record<CommandCategory, {
  label: string;
  icon: string;
  color: string;
  order: number;
}> = {
  navigation: { label: "导航", icon: "🧭", color: "blue", order: 1 },
  session: { label: "会话", icon: "💬", color: "green", order: 2 },
  tools: { label: "工具", icon: "🔧", color: "purple", order: 3 },
  settings: { label: "设置", icon: "⚙️", color: "gray", order: 4 },
  agent: { label: "Agent", icon: "🤖", color: "orange", order: 5 }
};
```

### 上下文感知

```typescript
function getContextCommands(
  phase: SessionPhase,
  cwd: string,
  recentFiles: string[]
): CommandDef[] {
  const base = getBaseCommands();
  
  // 根据 session 状态过滤
  if (phase === "running") {
    return base.filter(c => c.showDuringRun);
  }
  
  // 添加上下文特定命令
  return [...base, ...getContextSpecificCommands(cwd)];
}
```

---

## 六、预期效果

1. **用户体验提升**: 更快的命令查找，更智能的建议
2. **效率提升**: 减少输入，提高操作速度
3. **学习成本降低**: 通过快捷键和预览降低学习门槛
4. **一致性**: 与 Claude Code 类似的操作体验

---

## 七、风险评估

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 搜索性能 | 中 | 使用防抖 + 虚拟列表 |
| 兼容性问题 | 低 | 保持向后兼容 |
| 用户习惯 | 低 | 提供可自定义配置 |