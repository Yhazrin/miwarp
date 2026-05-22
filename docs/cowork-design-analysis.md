# MiWarp × Claude Code Cowork 设计对标分析

## 一、项目现状概览

### MiWarp 架构特点
| 层级 | 技术选型 | 说明 |
|------|---------|------|
| 框架 | Tauri v2 | Rust 后端 + WebView 前端 |
| 前端 | Svelte 5 + SvelteKit | 全面采用 runes (`$state`, `$derived`, `$effect`) |
| 状态管理 | SessionStore (145KB+) | 单例模式，事件驱动的状态机 |
| Agent 系统 | Rust session_actor.rs | tokio actor 模型，mpsc 邮箱 |
| 团队协作 | team-store.svelte.ts | 轮询 + 监听器双重刷新 |
| Skill 系统 | skill-store.svelte.ts | 内置 3 个 skill，支持 CRUD |
| 多 Agent | multi-agent-service.ts | 预设 + 自然语言分解 |

### 现有痛点
1. **SessionStore 过大** - 145KB 单文件难以维护
2. **团队协作浅** - 仅支持 @team 触发，无实时协作
3. **Skill 系统弱** - 内置 skill 有限，缺少技能市场
4. **Memory 割裂** - 各 session 独立，无跨会话记忆
5. **多 Agent 初级** - 预设固定，无智能任务分解

---

## 二、Cowork 设计模式分析

### 2.1 核心设计原则

```
┌─────────────────────────────────────────────────────────┐
│                    Cowork Architecture                   │
├─────────────────────────────────────────────────────────┤
│  ┌──────────┐    ┌──────────┐    ┌──────────┐           │
│  │ Claude A │    │ Claude B │    │ Claude C │   ...     │
│  └────┬─────┘    └────┬─────┘    └────┬─────┘           │
│       │              │              │                  │
│       └──────────────┼──────────────┘                  │
│                      ▼                                 │
│            ┌─────────────────┐                         │
│            │   Shared State  │                         │
│            │  ┌───────────┐  │                         │
│            │  │ Memory    │  │  ← Cross-session memory │
│            │  │ Skills    │  │  ← Skill marketplace   │
│            │  │ Context   │  │  ← Shared context      │
│            │  └───────────┘  │                         │
│            └─────────────────┘                         │
└─────────────────────────────────────────────────────────┘
```

### 2.2 关键设计模式

#### Pattern 1: 插件化架构 (Plugin Architecture)
```typescript
// Cowork 使用插件封装工作流
interface Plugin {
  id: string;
  name: string;
  skills: Skill[];           // 技能集合
  commands: Command[];       // 可用命令
  connectors: Connector[];  // 外部连接器 (Slack, Asana, etc.)
  onInstall?: () => void;
}

// 示例: sales plugin
{
  id: "sales",
  name: "Sales",
  skills: ["deal-review", "pipeline-sync", "contract-draft"],
  commands: ["/deals", "/pipeline"],
  connectors: ["salesforce"]
}
```

**MiWarp 可借鉴**:
- 现有 `plugin-store.svelte.ts` 基础良好
- 需增强 `skills` 属性 (当前为空)
- 需添加 `connectors` 支持 (Slack/Asana 等)

#### Pattern 2: 技能市场 (Skill Marketplace)
```typescript
// Skill 完整结构
interface Skill {
  id: string;
  name: string;              // kebab-case: "meeting-notes-to-jira"
  description: string;       // 一行描述触发场景
  content: string;           // SKILL.md 内容
  category: string;          // "automation" | "integration" | "productivity"
  source: string;            // "community" | "builtin" | "custom"
  triggers: string[];        // 触发关键词
  icon?: string;
  isInstalled: boolean;
}
```

**MiWarp 可借鉴**:
- 当前 `skill-store.svelte.ts` 缺少 `triggers` 和 `source`
- 需实现技能市场 UI (`SkillMarketplace.svelte` 已存在)
- 需添加社区技能发现机制

#### Pattern 3: 实时上下文共享 (Real-time Context Sharing)
```typescript
// Session 间的上下文同步
interface SharedContext {
  sessionId: string;
  cwd: string;                // 工作目录
  recentFiles: string[];      // 最近访问的文件
  activeTasks: Task[];        // 进行中的任务
  memory: MemoryItem[];       // 共享记忆
}

// 事件流
context-updated: { type: "file", path: "src/main.ts", action: "edit" }
memory-added: { content: "用户偏好 dark mode", ttl: "24h" }
task-created: { id: "T-123", assignee: "Claude B" }
```

**MiWarp 可借鉴**:
- 现有 `memory-store.svelte.ts` 需增强跨 session 同步
- 需添加 WebSocket 实时推送 (已在 `web_server/` 中)
- 需实现 `context-updated` 事件类型

#### Pattern 4: 智能任务分解 (Intelligent Task Decomposition)
```typescript
// 自然语言 → 任务结构
interface DecomposedTask {
  name: string;
  subTasks: {
    id: string;
    description: string;
    priority: number;
    dependsOn: string[];
    assignedTo?: string;
  }[];
  estimatedDuration?: string;
}

// 示例: "帮我审查这个 PR 并更新文档"
{
  name: "PR审查+文档更新",
  subTasks: [
    { id: "1", description: "代码审查", priority: 1 },
    { id: "2", description: "安全检查", priority: 1, dependsOn: ["1"] },
    { id: "3", description: "更新 CHANGELOG", priority: 2, dependsOn: ["1"] },
    { id: "4", description: "更新 API 文档", priority: 2, dependsOn: ["2"] }
  ]
}
```

**MiWarp 可借鉴**:
- 现有 `multi-agent-service.ts` 的 `parseNaturalLanguage` 过于简单
- 需集成 LLM 进行智能分解
- 需支持任务依赖图 (DAG)

#### Pattern 5: 多 Agent 协调 (Multi-Agent Coordination)
```typescript
// Agent 协作协议
interface AgentProtocol {
  // 状态同步
  broadcastState(state: AgentState): void;
  
  // 任务分发
  dispatch(task: Task, agent: Agent): Promise<TaskResult>;
  
  // 结果聚合
  aggregate(results: TaskResult[]): AggregatedResult;
  
  // 冲突解决
  resolveConflict(a: AgentState, b: AgentState): Resolution;
}

// Agent 状态
interface AgentState {
  agentId: string;
  status: "idle" | "thinking" | "working" | "blocked";
  currentTask?: string;
  progress: number;           // 0-100
  blockers: string[];
  output: string;
}
```

**MiWarp 可借鉴**:
- 现有 `team-dispatcher.ts` 需增强状态广播
- 需实现 Agent 状态 UI (`TeamDispatchConfirm.svelte` 已存在)
- 需添加 `progress` 实时更新

---

## 三、落地建议 (按优先级)

### P0 - 立即可落地 (1-2周)

#### 1. 增强 Skill 系统
```typescript
// src/lib/types/skill.ts 扩展
interface Skill {
  // 新增字段
  triggers: string[];        // 触发词
  source: "builtin" | "local" | "community";
  matchedCapabilities?: string[];  // 匹配的能力
}

// src/lib/stores/skill-store.svelte.ts 扩展
class SkillStore {
  // 新增方法
  async searchCommunitySkills(query: string): Promise<Skill[]>;
  async installSkill(skill: Skill): Promise<void>;
  async getSkillRecommendations(context: Context): Promise<Skill[]>;
}
```

**改动点**:
- `src/lib/types/skill.ts` - 添加 triggers/source
- `src/lib/stores/skill-store.svelte.ts` - 添加市场方法
- `src/lib/components/SkillMarketplace.svelte` - 完善 UI

#### 2. 增强多 Agent 任务分解
```typescript
// src/lib/services/multi-agent-service.ts 改进
class MultiAgentService {
  // 新增: LLM 驱动的任务分解
  async decomposeWithLLM(task: string, context: Context): Promise<MultiAgentConfig>;
  
  // 新增: 依赖图支持
  buildDependencyGraph(tasks: Task[]): DAG;
  
  // 新增: 任务执行可视化
  getExecutionProgress(runId: string): AgentProgress[];
}
```

**改动点**:
- `src/lib/services/multi-agent-service.ts` - 重写任务分解逻辑
- `src/routes/multi-agent/+page.svelte` - 添加执行进度 UI

#### 3. 添加跨 Session 记忆
```typescript
// src/lib/stores/memory-store.svelte.ts 扩展
interface SharedMemory {
  sessionId: string;
  content: string;
  tags: string[];
  createdAt: Date;
  expiresAt?: Date;          // TTL 支持
  sharingLevel: "private" | "team" | "public";
}

// 新增方法
class MemoryStore {
  async shareMemory(item: MemoryItem, level: SharingLevel): Promise<void>;
  async getTeamMemory(teamId: string): Promise<MemoryItem[]>;
  async searchMemory(query: string, filters: MemoryFilters): Promise<MemoryItem[]>;
}
```

**改动点**:
- `src/lib/stores/memory-store.svelte.ts` - 添加共享方法
- Rust backend: `src-tauri/src/storage/` - 添加 team memory 表

### P1 - 中期改进 (1个月)

#### 4. 插件架构增强
```typescript
// 插件市场数据结构
interface Plugin {
  id: string;
  name: string;
  description: string;
  skills: Skill[];
  commands: Command[];
  connectors: {
    type: "slack" | "asana" | "github" | "salesforce";
    config: Record<string, string>;
  }[];
  matchedCapabilities: string[];
}

// 插件搜索
interface PluginSearchResult {
  plugin: Plugin;
  matchScore: number;
  matchedCapabilities: string[];
}
```

**改动点**:
- `src/lib/stores/plugin-store.svelte.ts` - 重构数据结构
- `src/lib/components/SkillMarketplace.svelte` - 复用为插件市场
- Rust: 新增 plugin registry 命令

#### 5. 实时状态同步
```typescript
// WebSocket 事件扩展
type RealtimeEvent = 
  | { type: "agent-state"; agentId: string; state: AgentState }
  | { type: "task-progress"; taskId: string; progress: number }
  | { type: "memory-update"; memoryId: string; action: "create" | "update" }
  | { type: "context-sync"; files: string[] };

// 状态广播器
class StateBroadcaster {
  broadcast(event: RealtimeEvent): void;
  subscribe(callback: (event: RealtimeEvent) => void): Unsubscribe;
}
```

**改动点**:
- `src-tauri/src/web_server/` - 增强 WebSocket 协议
- `src/lib/stores/event-middleware.ts` - 添加实时事件路由
- `src/lib/components/` - 添加实时状态 UI

#### 6. 智能团队协调
```typescript
// 团队协调器
interface TeamCoordinator {
  // 智能任务分配
  assignTask(task: Task, agents: Agent[]): Promise<Assignment>;
  
  // 冲突检测与解决
  detectConflicts(): Conflict[];
  resolveConflict(conflict: Conflict): Resolution;
  
  // 结果聚合
  aggregateResults(results: TaskResult[]): Summary;
}
```

**改动点**:
- `src/lib/services/team-dispatcher.ts` - 重写协调逻辑
- `src/routes/teams/+page.svelte` - 添加协调 UI
- Rust: 新增 team_coordinator 模块

### P2 - 长期演进 (2-3个月)

#### 7. Cowork Mode 集成
```typescript
// 与 Claude Code Cowork 的互操作
interface CoworkIntegration {
  // 注册为 Cowork 插件
  registerAsPlugin(): Promise<void>;
  
  // 暴露技能给 Cowork
  exposeSkills(skills: Skill[]): void;
  
  // 接收 Cowork 指令
  onCoworkCommand(command: CoworkCommand): void;
}

// 命令类型
type CoworkCommand = 
  | { type: "delegate-task"; task: Task; callback: string }
  | { type: "share-memory"; memory: MemoryItem }
  | { type: "invoke-skill"; skillId: string; args: any };
```

#### 8. 工作流自动化
```typescript
// 工作流定义
interface Workflow {
  id: string;
  name: string;
  steps: WorkflowStep[];
  triggers: Trigger[];
  conditions?: Condition[];
}

interface WorkflowStep {
  id: string;
  type: "skill" | "agent" | "http" | "condition";
  config: Record<string, any>;
  onSuccess?: string;    // 下一步
  onFailure?: string;    // 失败处理
}
```

---

## 四、具体实现示例

### 示例 1: 智能 Skill 推荐
```typescript
// src/lib/chat/use-skill-recommendation.svelte.ts
export function createSkillRecommender(ctx: {
  store: SessionStore;
  getTimeline: () => TimelineEntry[];
}) {
  let recommendations = $state<Skill[]>([]);
  
  // 基于上下文的推荐
  $effect(() => {
    const context = analyzeContext(ctx.getTimeline());
    recommendations = ctx.store.availableSkills
      .map(skillId => ctx.store.getSkill(skillId))
      .filter(skill => matchContext(skill, context))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  });
  
  function analyzeContext(timeline: TimelineEntry[]): Context {
    // 分析最近对话，提取意图和需求
    const recent = timeline.slice(-10);
    const hasSecurity = recent.some(e => e.kind === "tool" && e.name === "read_file");
    const hasApi = recent.some(e => e.content?.includes("API"));
    return { hasSecurity, hasApi, intent: "review" };
  }
  
  return { recommendations };
}
```

### 示例 2: 多 Agent 进度可视化
```typescript
// src/lib/components/MultiAgentProgress.svelte
<script lang="ts">
  interface Props {
    runId: string;
  }
  let { runId }: Props = $props();
  
  let agents = $state<AgentState[]>([]);
  let progress = $derived(
    agents.reduce((sum, a) => sum + a.progress, 0) / agents.length
  );
  
  // 实时订阅
  onMount(() => {
    return subscribeToAgentUpdates(runId, (state) => {
      agents = agents.map(a => a.id === state.id ? state : a);
    });
  });
</script>

<div class="flex flex-col gap-2">
  <div class="text-sm text-muted-foreground">
    Overall: {progress.toFixed(0)}%
  </div>
  
  {#each agents as agent (agent.id)}
    <div class="flex items-center gap-3">
      <StatusIcon status={agent.status} />
      <span class="text-sm">{agent.name}</span>
      <div class="flex-1 h-2 bg-muted rounded overflow-hidden">
        <div 
          class="h-full bg-primary transition-all"
          style="width: {agent.progress}%"
        />
      </div>
      <span class="text-xs text-muted-foreground">
        {agent.progress}%
      </span>
    </div>
  {/each}
</div>
```

### 示例 3: 跨 Session 记忆同步
```typescript
// src/lib/stores/shared-memory.svelte.ts
class SharedMemoryStore {
  memories = $state<SharedMemory[]>([]);
  
  async shareToTeam(memory: MemoryItem, teamId: string) {
    const shared: SharedMemory = {
      id: uuid(),
      sessionId: this.currentSessionId,
      content: memory.content,
      tags: memory.tags,
      createdAt: new Date(),
      sharingLevel: "team"
    };
    
    // 持久化
    await api.saveSharedMemory(teamId, shared);
    
    // 广播给其他 session
    this.broadcast({
      type: "memory-shared",
      memory: shared
    });
  }
  
  async getTeamMemories(teamId: string): Promise<SharedMemory[]> {
    const cached = this.memories.filter(m => 
      m.sharingLevel === "team" && m.teamId === teamId
    );
    
    if (cached.length > 0) return cached;
    
    // 从后端获取
    const fresh = await api.getTeamMemories(teamId);
    this.memories = [...this.memories, ...fresh];
    return fresh;
  }
}
```

---

## 五、技术债务清理建议

### 1. SessionStore 拆分
```
当前: session-store.svelte.ts (145KB+)
目标: 按职责拆分
├── session-state.ts      # 状态定义
├── session-reducers.ts   # 状态更新逻辑
├── session-effects.ts    # $effect 副作用
└── session-commands.ts   # 命令处理
```

### 2. 统一事件总线
```
当前: event-middleware.ts (13KB) + 散落各处的监听
目标: 统一事件总线
├── EventBus.ts           # 单例事件总线
├── events/               # 事件类型定义
│   ├── agent-events.ts
│   ├── memory-events.ts
│   └── team-events.ts
└── middleware/           # 中间件
    ├── logger.ts
    └── analytics.ts
```

### 3. 组件库整理
```
当前: 50+ 组件散落
目标: 按功能分类
├── chat/                 # 聊天相关
├── team/                 # 团队协作
├── skill/                # 技能相关
├── settings/            # 设置相关
└── common/               # 通用组件
```

---

## 六、总结

MiWarp 已有良好的架构基础，特别是:
- ✅ Svelte 5 runes 现代化
- ✅ Rust actor 模型稳定
- ✅ 团队系统初具雏形
- ✅ Skill 系统基础完备

Cowork 模式的核心价值在于**跨 Agent 协作**和**智能任务编排**，MiWarp 需要:

1. **短期**: 增强 Skill 推荐、任务分解、跨 Session 记忆
2. **中期**: 完善插件架构、实时同步、团队协调
3. **长期**: 集成 Cowork 生态、实现工作流自动化

建议从 **P0** 优先级开始，选择 1-2 个模块试点，积累经验后再推广。
