# Claude Code / Cowork 学习报告 - 落地到 MiWarp

## 一、Cowork 核心设计分析

### 1.1 Skill 系统 (从 Cowork 代码中提取)

Cowork 的 skill 系统是一个**引导式工作流引擎**，具有以下特点：

#### 1.1.1 Step-Based Workflow (步骤式工作流)

```typescript
interface SkillStep {
  id: string;
  title: string;
  description: string;
  action?: string;
  command?: string;
  skills?: { name: string; desc: string }[];
  widget?: string;
}

interface WorkflowState {
  currentStepId: string;
  completedSteps: string[];
  stepData: Map<string, any>;
}
```

**特点**：
- 每个 skill 可以包含多个步骤 (Step/Phase)
- 步骤之间可以跳转 (`--step <step-id>`)
- 每个步骤可以有对应的 widget 支持 (progress, form, list, confirm)
- 支持步骤间的数据传递 (stepData Map)

#### 1.1.2 Widget 系统 (嵌入式 UI 组件)

```typescript
interface WidgetSpec {
  type: "progress" | "form" | "list" | "confirm";
  data: Record<string, any>;
}
```

- **progress**: 显示步骤进度条，适合多步骤任务
- **form**: 收集用户输入，适合创建任务/配置
- **list**: 显示列表结果，适合搜索/发现
- **confirm**: 确认对话框，适合危险操作

#### 1.1.3 Skill Handler 模式

```typescript
interface SkillHandler {
  name: string;
  canHandle: (skill: Skill, args: string) => boolean;
  execute: (skill: Skill, args: string, context?: SkillExecutionContext) => Promise<ExecutionResult>;
}
```

**特点**：
- 注册式 handler，可扩展
- 每个 skill 有专门的 handler 处理
- 支持参数解析 (`--key value` 风格)
- 返回结构化的 ExecutionResult

### 1.2 命令面板设计 (从 PromptInput 分析)

Claude Code 的命令面板有以下特色：

#### 1.2.1 命令分类与层级

```typescript
export type CommandCategory = "chat" | "tools" | "navigation" | "settings" | "diagnostics" | "system";
export type CommandAction = "send_prompt" | "navigate" | "ipc_command" | "toggle_state" | "open_modal" | "panel:multi-agent" | "preset:fullstack" | ...;
```

#### 1.2.2 模糊搜索与关键字

```typescript
interface CommandDef {
  id: string;
  name: string;
  description: string;
  category: CommandCategory;
  agent: CommandAgent;
  shortcut?: string;
  action: CommandAction;
  payload?: string;
  fuzzyKeywords?: string[];  // 额外的模糊匹配关键字
  usageCount?: number;       // 使用统计，用于排序
  icon?: string;
  preview?: (payload?: string) => Promise<string>;  // 预览功能
}
```

#### 1.2.3 命令预览 (Tab 触发)

```typescript
// Tab 键触发预览
if (e.key === "Tab" && hoveredCmdId) {
  showCommandPreview(flatList.find(c => c.id === hoveredCmdId) || flatList[selectedIndex]);
}
```

预览内容根据 action 类型动态生成：
- `navigate`: 显示导航目标
- `send_prompt`: 显示要发送的提示
- `ipc_command`: 显示 IPC 命令名称
- `open_modal`: 显示要打开的模态框

#### 1.2.4 使用统计与排序

```typescript
// 记录命令使用
export function recordCommandUsage(commandId: string): void {
  const stats = getCommandUsageStats();
  stats[commandId] = (stats[commandId] || 0) + 1;
  localStorage.setItem(USAGE_STATS_KEY, JSON.stringify(stats));
}

// 优先显示最近使用的命令
let showRecent = $derived(!query && recentCommands.length > 0);
let flatList = $derived(showRecent ? [...recentCommands, ...filtered] : filtered);
```

### 1.3 Multi-Agent 服务设计

从 multi-agent-service.ts 分析，MiWarp 已有预设系统：

```typescript
export interface MultiAgentConfig {
  name: string;
  description: string;
  agents: AgentDefinition[];
}

export interface AgentDefinition {
  id: string;
  name: string;
  prompt: string;
  priority?: number;
  dependsOn?: string[];  // 依赖关系
}
```

**已有预设**：
- fullstack (前端 + 后端 + 数据库)
- review (安全 + 性能 + 风格)
- upgrade (多模块并行)
- test (单元 + 集成 + E2E)
- docs (API + README + CHANGELOG)

**依赖执行逻辑**：
```typescript
// 检查依赖是否满足
if (agent.dependsOn && agent.dependsOn.length > 0) {
  const depsMet = agent.dependsOn.every((depId) => {
    const dep = results.find((r) => r.agentId === depId);
    return dep?.status === "completed";
  });
}
```

### 1.4 Team 协作模式

从 team-store.svelte.ts 分析：

- **事件驱动更新**: watcher (team-update, task-update)
- **轮询 fallback**: 每 60s 刷新团队列表
- **冷却机制**: 避免重复刷新 (10s cooldown)

---

## 二、落地建议

### 2.1 增强 Skill 系统

#### 2.1.1 添加 Widget 渲染支持

在 `src/lib/components/` 中创建新组件：

```svelte
<!-- SkillWidget.svelte -->
<script lang="ts">
  import type { WidgetSpec } from "$lib/services/skill-executor";
  
  let { widget }: { widget: WidgetSpec } = $props();
</script>

{#if widget.type === "progress"}
  <ProgressWidget data={widget.data} />
{:else if widget.type === "form"}
  <FormWidget data={widget.data} />
{:else if widget.type === "list"}
  <ListWidget data={widget.data} />
{:else if widget.type === "confirm"}
  <ConfirmWidget data={widget.data} />
{/if}
```

#### 2.1.2 实现步骤导航

```typescript
// skill-executor.ts 中增强
async executeWithSteps(skill: Skill, context?: SkillExecutionContext) {
  const steps = this.parseSteps(skill.content);
  // 支持 --step <id> 跳转
  // 支持步骤间的数据传递
}
```

#### 2.1.3 添加新 Skill 类型

参考现有 skill，新添加：

| Skill | 来源 | 功能 |
|-------|------|------|
| review | Cowork | PR 代码审查 |
| security-review | Cowork | 安全漏洞扫描 |
| init | Cowork | 新项目初始化 |

### 2.2 增强命令面板

#### 2.2.1 添加命令预览功能

当前 `CommandPalette.svelte` 已经有 preview 逻辑，可以进一步完善：

```typescript
// preview 函数示例
const previewGenerators: Record<CommandAction, (payload?: string) => string> = {
  navigate: (path) => `导航到: ${path}`,
  send_prompt: (prompt) => `发送: ${prompt?.slice(0, 60)}...`,
  ipc_command: (cmd) => `执行: ${ipcNames[cmd] || cmd}`,
  toggle_state: (state) => `切换: ${stateNames[state] || state}`,
  open_modal: (modal) => `打开: ${modalNames[modal] || modal}`,
};
```

#### 2.2.2 实现使用频率排序

```typescript
// 在 filterCommands 中加入使用统计排序
function filterCommands(query: string, agent: string): CommandDef[] {
  let results = allCommands.filter(cmd =>
    cmd.agent === agent && fuzzyMatch(query, cmd)
  );
  
  // 使用频率加权
  results.sort((a, b) => {
    const aCount = getCommandUsageCount(a.id);
    const bCount = getCommandUsageCount(b.id);
    return bCount - aCount;
  });
  
  return results;
}
```

#### 2.2.3 添加 Tab 预览触发

当前已实现 `hoveredCmdId` 状态，可增强为：
- 鼠标悬停显示预览
- Tab 键快速执行预览命令

### 2.3 增强 Multi-Agent 服务

#### 2.3.1 实现自然语言解析

当前 `parseNaturalLanguage` 只是简单模式匹配，可以增强：

```typescript
// 使用 LLM 解析用户意图，生成 Agent 配置
async parseNaturalLanguage(input: string): Promise<MultiAgentConfig | null> {
  // 调用 Claude 解析用户意图
  const response = await invoke("parse_multiagent_intent", { input });
  return response as MultiAgentConfig;
}
```

#### 2.3.2 添加预设管理 UI

在 `MultiAgentPanel.svelte` 中添加：
- 预设创建/编辑
- 预设导入/导出
- 预设分享

#### 2.3.3 实时状态跟踪

```typescript
// 增强 MultiAgentResult
interface MultiAgentResult {
  agentId: string;
  status: "pending" | "running" | "completed" | "failed";
  result?: string;
  error?: string;
  duration?: number;
  outputTokens?: number;
  inputTokens?: number;
  startTime?: number;
  logs?: string[];
}
```

### 2.4 增强 Team 协作

#### 2.4.1 添加团队任务依赖

```typescript
interface TeamTask {
  id: string;
  title: string;
  dependsOn?: string[];  // 依赖的其他任务
  status: "pending" | "in_progress" | "completed" | "blocked";
}
```

#### 2.4.2 实现任务状态可视化

```typescript
// 在 TeamStore 中计算任务的依赖关系
getBlockedTasks(): TeamTask[] {
  return this.tasks.filter(t => {
    if (!t.dependsOn) return false;
    return t.dependsOn.some(depId => {
      const dep = this.tasks.find(task => task.id === depId);
      return dep?.status !== "completed";
    });
  });
}
```

### 2.5 增强 Skill Store

#### 2.5.1 添加 Skill 依赖解析

```typescript
// skill-dependency-resolver.ts 已存在，可增强
interface SkillDependency {
  skillName: string;
  version: string;
  required: boolean;
}

// 实现依赖安装和版本管理
async resolveDependencies(skill: Skill): Promise<void>;
```

#### 2.5.2 添加 Skill 市场搜索

```typescript
// 增强 searchSkills 功能
async searchSkills(query: string, filters?: {
  category?: SkillCategory;
  source?: "builtin" | "community" | "custom";
  tags?: string[];
}): Promise<Skill[]>;
```

---

## 三、优先级建议

### P0 (立即实现)
1. **命令预览功能** - 提升用户体验
2. **使用统计排序** - 让常用命令更容易找到

### P1 (下一版本)
3. **Skill Widget 渲染** - 丰富 skill 输出展示
4. **步骤式 Skill 执行** - 支持复杂多步骤任务

### P2 (后续版本)
5. **Multi-Agent 自然语言解析** - 降低使用门槛
6. **Team 任务依赖系统** - 增强团队协作能力

---

## 四、关键文件

| 文件 | 用途 |
|------|------|
| `src/lib/services/skill-executor.ts` | Skill 执行引擎 |
| `src/lib/commands.ts` | 命令定义 |
| `src/lib/components/CommandPalette.svelte` | 命令面板 UI |
| `src/lib/stores/skill-store.svelte.ts` | Skill 状态管理 |
| `src/lib/services/multi-agent-service.ts` | 多 Agent 服务 |
| `src/lib/stores/team-store.svelte.ts` | 团队状态管理 |
| `src/routes/chat/+page.svelte` | 主聊天页面 (120KB) |

---

## 五、架构参考

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (Svelte)                     │
├─────────────────────────────────────────────────────────┤
│  CommandPalette  │  SkillPanel  │  MultiAgentPanel      │
│       ↓              ↓              ↓                   │
│  commands.ts    skill-store.ts   multi-agent-service.ts │
│       ↓              ↓              ↓                   │
│  prompt-input   skill-executor    team-dispatcher        │
└─────────────────────────────────────────────────────────┘
                          ↓
                ┌─────────────────┐
                │  Transport Layer │
                │  (Tauri IPC / WS)│
                └─────────────────┘
                          ↓
                ┌─────────────────┐
                │  Tauri Commands  │
                │  (Rust backend)  │
                └─────────────────┘
```

---

*报告生成时间: 2026-05-17*