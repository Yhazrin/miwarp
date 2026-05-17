# 从 Codex Claude Cowork 学习心得 - 落地到 MiWarp

> 调研日期: 2026/05/17

## 一、调研情况

未能在本地找到 Codex Claude Cowork 代码库，但 MiWarp 项目中已包含多个受 Cowork 启发的设计模式，同时还有大量可进一步优化的空间。

---

## 二、已实现的 Cowork 风格设计

### 1. Step-Based 引导式工作流 (setup-wizard-service.ts)

MiWarp 已实现完整的分步引导流程：

```typescript
export type SetupStepId = "role" | "plugin" | "try-skill" | "connectors" | "wrap";
```

**关键特性:**
- 状态追踪: `completedSteps`, `currentStep`
- 步骤跳转: `jumpToStep()` 支持跳转到任意步骤
- Widget 系统: 支持 progress、list、form、confirm 类型

**参考价值:** 可将此模式扩展到其他场景，如项目初始化、团队设置等。

---

### 2. Skill 系统 (skill-store.svelte.ts, skill-executor.ts)

```typescript
export interface SkillStep {
  id: string;
  title: string;
  description: string;
  action?: string;
  command?: string;
  skills?: { name: string; desc: string }[];
  widget?: WidgetSpec;
}
```

**当前内置 Skills:**
- `setup-cowork` - 引导设置
- `consolidate-memory` - 记忆整合
- `review` - 代码审查
- `security-review` - 安全审查
- `init` - 项目初始化

**参考价值:** Skill 系统已相当成熟，可考虑增加更多垂直领域的 Skill。

---

### 3. 事件中间件模式 (event-middleware.ts)

```typescript
// 16ms microbatching 减少响应式更新
setTimeout(() => this.flushBatch(), 16);
```

**参考价值:** 这是一个很好的性能优化模式，可考虑应用到其他高频事件场景。

---

### 4. Transport 抽象层

```typescript
// 支持桌面端 (TauriTransport) 和浏览器端 (WsTransport)
export const getTransport = () => isDesktop() ? new TauriTransport() : new WsTransport();
```

**参考价值:** 统一的传输层设计使跨平台适配变得简单。

---

## 三、可借鉴但尚未充分实现的设计

### 1. 更智能的 Command Palette

**当前实现:**
- 模糊搜索
- Tab 预览
- 使用统计排序
- 分类分组

**可增强方向:**
- 基于上下文的命令建议 (如在 Chat 页面推荐不同命令)
- 命令组合/宏功能
- 自然语言命令解析

---

### 2. 增强的多 Agent 协作

**当前实现 (MultiAgentPanel):**
```typescript
export interface AgentDefinition {
  id: string;
  name: string;
  prompt: string;
  priority?: number;
  dependsOn?: string[];  // 依赖执行
}
```

**可增强方向:**
- 实时协作状态可视化
- Agent 间消息传递机制
- 共享上下文池
- 并行/串行执行可视化

---

### 3. 更丰富的 Widget 系统

**当前 Widget 类型:** progress, form, list, confirm

**可增强方向:**
- 表格 Widget (数据展示)
- 图表 Widget (recharts 集成)
- 代码编辑器 Widget
- 对话式 Widget (多轮交互)

---

### 4. 记忆和上下文管理

**当前 MemoryStore:** 基础实现

**可增强方向:**
- 向量语义搜索
- 自动记忆摘要
- 跨会话上下文继承
- 显式遗忘机制

---

## 四、建议优先落地的功能

| 优先级 | 功能 | 描述 | 复杂度 |
|--------|------|------|--------|
| P0 | Command Palette 上下文感知 | 根据当前页面/状态推荐不同命令 | 中 |
| P1 | 增强 Widget 类型 | 添加表格、图表 Widget | 低 |
| P2 | 记忆搜索增强 | 基于嵌入的语义搜索 | 高 |
| P3 | Agent 可视化协作 | 实时状态图/流程图 | 高 |

---

## 五、关键技术细节

### Svelte 5 Runes 最佳实践

```typescript
// 使用 $state, $derived, $effect 替代 legacy stores
export class SessionStore {
  running = $state(false);
  pendingTasks = $derived.by(() => this.tasks.filter((t) => t.status === "pending"));
  
  $effect(() => {
    // 自动追踪依赖
    void this.sessionId;
    this.fetchTimeline();
  });
}
```

### 性能优化模式

```typescript
// microbatching 批量处理
private pendingEvents: Event[] = [];
private flushBatch() {
  const events = this.pendingEvents.splice(0);
  events.forEach(e => this.dispatch(e));
}
```

---

## 六、参考文件

- `/src/lib/services/setup-wizard-service.ts` - 引导流程实现
- `/src/lib/services/skill-executor.ts` - Skill 执行器
- `/src/lib/stores/skill-store.svelte.ts` - Skill 状态管理
- `/src/lib/components/CommandPalette.svelte` - 命令面板
- `/src/lib/stores/event-middleware.ts` - 事件中间件
- `~/.claude/skills/setup-cowork/SKILL.md` - Cowork Setup Skill 原型

---

## 七、结论

MiWarp 已经在核心架构上吸收了 Cowork 的重要设计理念，特别是：
- Step-Based 工作流
- Skill 系统
- 事件中间件
- Transport 抽象

建议下一步重点关注：
1. Command Palette 的智能化增强
2. Widget 系统的丰富化
3. 多 Agent 协作的可视化