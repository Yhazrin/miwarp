# MiWarp 设计改进报告
**日期**: 2026-05-16
**任务**: 从 Claude Cowork 学习有用的设计，落地到 MiWarp

---

## 一、MiWarp 现有设计亮点

MiWarp 已经具备很多优秀的设计模式，以下是值得保留和加强的部分：

### 1. Session Actor 模式 (Rust)
```rust
// session_actor.rs - 一个 actor 绑定一个 run_id，通过 bounded mpsc mailbox 保证顺序执行
```
**优点**: 无锁并发，状态一致性高

### 2. Event Middleware 微批处理
```typescript
// 16ms 批处理窗口减少响应式更新
private _BATCH_INTERVAL = 16;
```
**优点**: 性能优化，避免过度渲染

### 3. Phase 状态机
```typescript
// 替代 3 个布尔值的组合
type SessionPhase = "empty" | "loading" | "ready" | "spawning" | "running" | "idle" | "completed" | "failed" | "stopped";
```
**优点**: 清晰的状态转换，易于调试

### 4. Transport 抽象层
```typescript
// 统一 Tauri IPC 和 WebSocket 接口
getTransport().invoke<T>()
```
**优点**: 桌面端和浏览器端代码共享

### 5. OpGuard 操作守卫
```typescript
class OpGuard {
  acquire(): boolean { if (this._active) return false; ... }
}
```
**优点**: 防止重复操作和竞态条件

---

## 二、可借鉴的设计模式 (来自 Claude Cowork 等工具)

### 1. 智能上下文管理

**现状**: 基本的 context history
**改进方向**:
- 自动上下文分块 (Context Chunking)
- 记忆层级 (Working Memory → Project Memory → Global Memory)
- 语义检索而非线性历史

```
建议文件: src/lib/stores/memory-hierarchy.ts
```

### 2. Agent 间结构化通信

**现状**: Team dispatch 基于自然语言
**改进方向**:
- 预定义消息协议 (TaskResult, StatusUpdate, ResourceRequest)
- 结构化任务委派 (TaskSpec with constraints, deadlines)
- 共享上下文空间 (SharedWorkspace)

```typescript
// 建议的新类型
interface AgentMessage {
  type: 'task' | 'status' | 'resource' | 'checkpoint';
  from: string;
  to: string;
  payload: TaskSpec | StatusUpdate | ResourceRequest;
  correlationId: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
}
```

### 3. 可视化工作流构建

**现状**: WorkflowPanel 较简单
**改进方向**:
- 节点编辑器 (拖拽式节点连接)
- 条件分支可视化
- 执行进度动画

```
建议: src/lib/components/WorkflowBuilder.svelte
```

### 4. 交互式调试体验

**改进方向**:
- 断点标记在代码编辑区
- 变量状态面板
- 执行历史回放

```
建议: src/lib/components/DebugPanel.svelte
```

### 5. 会话分支可视化

**现状**: Rewind 功能已实现
**改进方向**:
- Git 分支风格的时间线视图
- 分支间差异高亮
- 一键切换/合并

```typescript
// 建议的类型
interface SessionBranch {
  id: string;
  parentId: string | null;
  createdAt: string;
  messageCount: number;
  diffSummary: string[];
}
```

### 6. 主动建议系统

**改进方向**:
- 基于项目模式的上下文提示
- 重构机会识别
- 测试覆盖率建议

```typescript
// 建议的服务
class SuggestionEngine {
  analyze(timeline: TimelineEntry[]): Suggestion[];
  getPatterns(projectCwd: string): ProjectPattern[];
}
```

### 7. 智能错误恢复

**现状**: 基本错误分类
**改进方向**:
- 错误原因链分析
- 建议修复步骤
- 自动重试策略配置

```typescript
interface RecoveryPlan {
  causes: string[];
  steps: RecoveryStep[];
  estimatedSuccessRate: number;
  autoRecoverable: boolean;
}
```

### 8. 成本优化面板

**改进方向**:
- Token 消耗实时图表
- 优化建议 (缓存利用率、上下文压缩)
- 预算告警配置

```
建议: src/lib/components/CostOptimizer.svelte
```

---

## 三、实施优先级建议

### P0 (立即实现)
1. **增强记忆层级** - memory-hierarchy.ts
   - 现有 memoryStore 可扩展
   - 用户感知价值高

2. **结构化 Agent 消息协议**
   - 改进 team-dispatcher.ts
   - 提升多 Agent 协作可靠性

### P1 (下一版本)
3. **分支可视化时间线**
   - 基于现有 rewind 功能扩展
   - 用户体验提升明显

4. **成本优化面板**
   - 已有 usage 数据基础
   - 帮助用户控制费用

### P2 (规划中)
5. 可视化工作流构建器
6. 交互式调试面板
7. 主动建议引擎

---

## 四、技术债务清理建议

### 1. 组件拆分
```javascript
// 超大组件需要拆分
PromptInput.svelte (80,279 行) → 多个子组件
InlineToolCard.svelte (85,466 行) → 工具卡片组件库
ToolActivity.svelte (69,301 行) → 面板化
```

### 2. 命令模块化
```rust
// 大型 Rust 命令拆分
session.rs (94,039 行) → 子模块
diagnostics.rs (60,735 行) → 子模块
```

### 3. 事件缓冲区优化
```typescript
// 魔数提取为配置
_MAX_BUFFER_SIZE = 500 → 运行时可配置
```

---

## 五、推荐的文件结构变更

```
src/lib/
├── services/
│   ├── memory-hierarchy.ts      # 新增: 记忆层级服务
│   ├── suggestion-engine.ts     # 新增: 主动建议引擎
│   └── agent-protocol.ts        # 新增: Agent 通信协议
├── components/
│   ├── WorkflowBuilder.svelte   # 新增: 可视化工作流
│   ├── BranchTimeline.svelte    # 新增: 分支时间线
│   └── CostOptimizer.svelte     # 新增: 成本优化
└── stores/
    └── memory-hierarchy.ts      # 新增: 记忆层级 Store
```

---

## 六、总结

MiWarp 的核心架构已经非常扎实，采用了现代化的 Svelte 5 响应式系统和 Rust 高性能后端。主要改进方向集中在：

1. **智能化** - 让系统更懂用户意图
2. **可视化** - 让复杂状态易于理解
3. **结构化** - 让 Agent 协作更可靠
4. **可观测** - 让成本和性能透明

建议从 P0 级别的记忆层级和 Agent 协议开始迭代，逐步完善整体体验。