# Codex/Claude Code 设计心得与 MiWarp 落地建议

## 概述

本文档从 Codex/Claude Code 的设计模式中提取可借鉴的元素，结合 MiWarp 当前架构提出具体落地建议。

---

## 一、架构层面的借鉴

### 1.1 Session Actor 模式 (已实现 - 优秀)

**现状**: MiWarp 已实现 `session_actor.rs`，使用 tokio actor + mpsc mailbox 管理会话生命周期。

**可增强的点**:

```
┌─────────────────────────────────────────────────────────────┐
│  当前: 单 Actor 管理单个 CLI session                         │
│  建议: 引入 Supervisor Actor 层级                             │
└─────────────────────────────────────────────────────────────┘

// 建议的扩展模式
struct Supervisor {
    children: HashMap<String, ActorRef<SessionCommand>>,
    restart_policy: RestartPolicy,
}

enum RestartPolicy {
    OneForOne,      // 一个失败，只重启那个
    OneForAll,      // 一个失败，全部重启
    RestForOne,     // 失败的影响链重启
}
```

**落地步骤**:
1. 在 `src-tauri/src/agent/` 添加 `supervisor.rs`
2. 实现子 actor 生命周期管理
3. 添加进程崩溃自动恢复逻辑

### 1.2 Transport 抽象层 (已实现 - 优秀)

**现状**: MiWarp 有完善的 `getTransport()` 抽象，支持 Tauri IPC 和 WebSocket。

**借鉴**: 可参考 Codex 的连接池模式

```typescript
// 当前: 每次 invoke 新建连接
// 建议: 引入连接池 + 复用

class TransportPool {
    private pool: Map<string, TransportConnection>;
    private maxConnections: number;
    
    async acquire(key: string): Promise<TransportConnection> {
        // 复用已有连接，连接池满时排队
    }
}
```

---

## 二、事件系统的增强

### 2.1 Microbatch 优化 (已实现 - 优秀)

MiWarp 的 `EventMiddleware` 已实现 16ms microbatching。

**可进一步优化**:

```typescript
// 当前: 固定 16ms batch
// 建议: 自适应 batch 策略

private _adaptiveBatch(): void {
    const now = Date.now();
    const load = this._estimateReactivityLoad();
    
    // 高负载时增大 batch interval，减少 UI 更新
    if (load > HIGH_THRESHOLD) {
        this._BATCH_INTERVAL = 32;  // 降频
    } else if (load < LOW_THRESHOLD) {
        this._BATCH_INTERVAL = 8;   // 升频
    }
}
```

### 2.2 事件优先级队列

**借鉴 Codex 的分级事件处理**:

```typescript
interface PriorityEvent {
    priority: 'high' | 'normal' | 'low';
    event: BusEvent;
    timestamp: number;
}

// 高优先级: permission_request, hook_event
// 正常: message_delta, tool_call
// 低优先级: usage_update, heartbeat

class PriorityEventQueue {
    private queues: Map<string, PriorityEvent[]>;
    
    flush(): BusEvent[] {
        // 按优先级顺序返回，保证高优先级事件先处理
        return [
            ...this.queues.get('high') || [],
            ...this.queues.get('normal') || [],
            ...this.queues.get('low') || []
        ];
    }
}
```

---

## 三、多 Agent 系统增强

### 3.1 当前的 Multi-Agent Service

MiWarp 已有 `multi-agent-service.ts`，但功能较基础。

**可增强的方向**:

#### 3.1.1 引入 Agent 协作协议

```typescript
// 建议的新接口
interface AgentProtocol {
    // Agent 间通信
    sendMessage(to: string, message: AgentMessage): Promise<void>;
    
    // 状态同步
    syncState(): Promise<AgentState>;
    
    // 资源共享
    shareContext(key: string, value: any): void;
    getContext(key: string): any;
}

// Agent 消息类型
type AgentMessage = 
    | { type: 'task_request'; payload: TaskPayload }
    | { type: 'task_result'; payload: ResultPayload }
    | { type: 'dependency_ready'; deps: string[] }
    | { type: 'resource_request'; resource: string };
```

#### 3.1.2 依赖感知调度

```typescript
// 当前: 简单的 dependsOn 数组
// 建议: 动态依赖解析 + 并行优化

class DependencyResolver {
    resolve(agents: AgentDefinition[]): ExecutionPlan {
        // 1. 构建依赖图
        // 2. 拓扑排序
        // 3. 识别可并行的层级
        // 4. 生成执行计划
    }
}

interface ExecutionPlan {
    stages: Stage[];
    estimatedDuration: number;
}

interface Stage {
    parallel: boolean;
    agents: string[];
    waitFor: string[] | null;
}
```

#### 3.1.3 Agent 生命周期管理

```typescript
interface AgentLifecycle {
    onStart(agentId: string): void;
    onProgress(agentId: string, progress: number): void;
    onComplete(agentId: string, result: any): void;
    onError(agentId: string, error: Error): void;
    onCancel(agentId: string): void;
}

// 使用观察者模式
class AgentManager {
    private observers: AgentLifecycle[] = [];
    
    subscribe(observer: AgentLifecycle): void;
    unsubscribe(observer: AgentLifecycle): void;
    
    private notify(event: AgentEvent): void {
        this.observers.forEach(o => o[event.method]?.(event.payload));
    }
}
```

### 3.2 Skill 与 Agent 协同

**借鉴 Codex 的 skill 调用模式**:

```typescript
// 建议: Skill 作为 Agent 的能力扩展

interface SkillCapability {
    skill: Skill;
    agent: string;
    autoInvoke: boolean;
    triggerCondition?: (ctx: AgentContext) => boolean;
}

// 扩展 SkillStore
class EnhancedSkillStore extends SkillStore {
    capabilities: SkillCapability[] = [];
    
    // 根据 Agent 上下文自动推荐 skill
    suggestSkills(context: AgentContext): Skill[] {
        return this.capabilities
            .filter(c => c.triggerCondition?.(context) ?? false)
            .map(c => c.skill);
    }
}
```

---

## 四、Workflow 系统的增强

### 4.1 当前状态

MiWarp 的 `workflow-store.svelte.ts` 有基础模板系统。

### 4.2 可借鉴的设计

#### 4.2.1 工作流版本控制

```typescript
interface WorkflowVersion {
    version: string;
    createdAt: string;
    steps: WorkflowStep[];
    changelog?: string;
}

class VersionedWorkflow {
    private versions: WorkflowVersion[] = [];
    private currentVersion: string;
    
    update(newSteps: WorkflowStep[]): void;
    rollback(version: string): void;
    diff(v1: string, v2: string): WorkflowDiff;
}
```

#### 4.2.2 条件分支

```typescript
// 当前: 线性步骤
// 建议: 支持条件分支

interface ConditionalStep {
    condition: (context: WorkflowContext) => boolean;
    then: WorkflowStep[];
    else?: WorkflowStep[];
}

interface WorkflowStep {
    type: "slash_command" | "prompt" | "custom" | "conditional";
    value: string;
    condition?: (ctx: WorkflowContext) => boolean;
    then?: WorkflowStep[];
    else?: WorkflowStep[];
}
```

#### 4.2.3 工作流市场

```typescript
// 建议: 社区工作流分享

interface CommunityWorkflow {
    id: string;
    name: string;
    author: string;
    downloads: number;
    rating: number;
    tags: string[];
    steps: WorkflowStep[];
    requiredContext: string[];
}

class WorkflowMarketplace {
    async fetchTrending(): Promise<CommunityWorkflow[]>;
    async publish(workflow: WorkflowTemplate): Promise<string>;
    async rate(id: string, rating: number): void;
}
```

---

## 五、Memory 系统的增强

### 5.1 当前状态

MiWarp 有 `memory-store.svelte.ts`，支持 memory 文件管理。

### 5.2 可借鉴的设计

#### 5.2.1 语义记忆

```typescript
// 建议: 向量存储 + 语义搜索

interface SemanticMemory {
    embeddings: Map<string, number[]>;  // path -> embedding
    index: VectorIndex;
}

class SemanticSearch {
    async search(query: string, topK: number): Promise<MemoryFileCandidate[]>;
    async index(file: string, content: string): Promise<void>;
}
```

#### 5.2.2 自动记忆整理

```typescript
// 借鉴 Codex 的 auto-context

interface AutoMemoryConfig {
    triggerOnTurn: number;      // 每 N 轮触发
    minEntriesToCompact: number;
    similarityThreshold: number;
}

class AutoMemoryService {
    private config: AutoMemoryConfig;
    
    async analyze(): Promise<ConsolidationResult>;
    async compact(entries: MemoryEntry[]): Promise<void>;
    async suggest(turnContext: TurnContext): Promise<MemoryEntry[]>;
}
```

---

## 六、Team 协作增强

### 6.1 当前状态

MiWarp 有 `TeamStore` + watcher 事件驱动。

### 6.2 可借鉴的设计

#### 6.2.1 实时协作状态

```typescript
// 建议: 协作光标 + 状态同步

interface TeamPresence {
    agent: string;
    cursor: { line: number; column: number };
    currentTask?: string;
    lastActivity: string;
}

class TeamPresenceService {
    private presence: Map<string, TeamPresence>;
    
    updatePresence(agent: string, state: Partial<TeamPresence>): void;
    broadcast(): void;
    onPresenceChange(callback: (p: TeamPresence[]) => void): void;
}
```

#### 6.2.2 任务依赖链

```typescript
// 建议: 任务依赖可视化

interface TaskDependency {
    taskId: string;
    dependsOn: string[];
    status: 'blocked' | 'ready' | 'in_progress' | 'completed';
}

class DependencyGraph {
    addTask(task: TaskDependency): void;
    getReadyTasks(): string[];     // 无阻塞的任务
    getBlockedTasks(): string[];   // 被阻塞的任务
    visualize(): GraphvizOutput;
}
```

---

## 七、权限与安全

### 7.1 当前状态

MiWarp 有 `permissionMode` 管理 (`auto-accept-all`, `manual`, `bypassPermissions`)。

### 7.2 可借鉴的设计

#### 7.2.1 权限策略模板

```typescript
interface PermissionPolicy {
    id: string;
    name: string;
    rules: PermissionRule[];
}

interface PermissionRule {
    tool?: string;           // 工具名，空=全部
    filePattern?: RegExp;    // 文件匹配
    action: 'allow' | 'deny' | 'ask';
    reason?: string;
}

// 内置策略
const BUILT_IN_POLICIES: PermissionPolicy[] = [
    {
        id: 'dev-only',
        name: '开发模式',
        rules: [
            { action: 'allow', reason: '开发模式' },
        ]
    },
    {
        id: 'prod-readonly',
        name: '生产只读',
        rules: [
            { action: 'deny', filePattern: /\/prod\//, reason: '禁止修改生产环境' },
            { action: 'ask', reason: '其他操作需确认' }
        ]
    }
];
```

#### 7.2.2 权限审计日志

```typescript
interface PermissionAuditEntry {
    timestamp: string;
    tool: string;
    file?: string;
    action: 'allow' | 'deny' | 'ask';
    decidedBy: 'user' | 'policy' | 'auto';
    responseTime?: number;
}

class PermissionAudit {
    log(entry: PermissionAuditEntry): void;
    query(filter: AuditFilter): Promise<PermissionAuditEntry[]>;
    export(start: Date, end: Date): Promise<Report>;
}
```

---

## 八、性能优化

### 8.1 当前瓶颈分析

根据代码分析，以下是潜在性能瓶颈:

| 组件 | 潜在问题 | 建议优化 |
|------|----------|----------|
| SessionStore | 143KB+ 文件，状态量大 | 拆分为更小的子 store |
| EventMiddleware | 16ms batch 可调整 | 自适应 batch |
| Timeline | 持续累积 | 更激进的 compaction |

### 8.2 具体优化建议

#### 8.2.1 Store 拆分

```typescript
// 当前: 单一 SessionStore
// 建议: 领域分离

class SessionStore {
    // 核心状态
    phase: SessionPhase;
    run: TaskRun | null;
    
    // 分离的子状态
    timelineStore: TimelineStore;      // 时间线管理
    usageStore: UsageStore;            // 用量追踪
    toolStore: ToolStore;              // 工具调用
    hookStore: HookStore;              // Hook 事件
}

class TimelineStore {
    entries: TimelineEntry[];
    compact(threshold: number): void;
}
```

#### 8.2.2 虚拟化长列表

```typescript
// 对于 timeline 渲染，考虑虚拟滚动

class VirtualTimeline {
    private visibleRange: { start: number; end: number };
    private rowHeight: number;
    
    scrollTo(index: number): void;
    getVisibleEntries(): TimelineEntry[];
}
```

---

## 九、测试与可靠性

### 9.1 当前测试覆盖

- `session-store.test.ts` (174KB)
- `event-middleware.test.ts`
- `keybindings.test.ts`
- `file-classification.test.ts`

### 9.2 可增强的测试

#### 9.2.1 协议级测试

```typescript
// 模拟各种 CLI 响应，测试 actor 行为

class ProtocolFuzzer {
    async fuzz(session: SessionStore): Promise<FuzzResult>;
}
```

#### 9.2.2 集成测试

```typescript
// 模拟完整会话流程

describe('Full Session Flow', () => {
    it('handles complex multi-turn conversation', async () => {
        const store = new SessionStore();
        await store.sendMessage('Hello');
        // ... 更多步骤
    });
});
```

---

## 十、优先级建议

根据实施难度和收益，建议优先级如下:

### 高优先级 (立即实施)
1. **Store 拆分** - 降低 SessionStore 复杂度
2. **自适应 Microbatch** - 提升响应性能
3. **权限策略模板** - 增强安全管控

### 中优先级 (1-2个月)
4. **工作流版本控制** - 支持协作
5. **Agent 协作协议** - 增强多 Agent 能力
6. **依赖感知调度** - 优化并行执行

### 低优先级 (长期规划)
7. **语义记忆** - 需要向量存储基础设施
8. **实时协作状态** - 需要 WebSocket 增强
9. **社区工作流市场** - 需要服务端支持

---

## 总结

MiWarp 已经有了扎实的架构基础，特别是在:
- Session Actor 模式
- Transport 抽象
- Event Middleware
- Skill 系统

通过本文档的建议，可以进一步:
1. 提升性能和可维护性
2. 增强多 Agent 协作能力
3. 完善安全和权限管理
4. 支持更复杂的 Workflow

建议从 **Store 拆分** 和 **自适应 Microbatch** 开始，这两个改动风险低但收益明显。
