# MiWarp 架构设计学习与优化建议

## 学习目标
从 Codex Claude Cowork 设计中提取有价值的设计模式，落地到 MiWarp 项目。

---

## 一、当前 MiWarp 架构分析

### 现有优势

**1. 清晰的类型系统**
- `Skill` 类型定义了完整的元数据结构（id, name, description, content, category, source, isBuiltIn, tags, icon）
- `ScheduledTask` 支持 cron 表达式和一次性任务（fireAt）
- `WorkflowTemplate` + `WorkflowInstance` 实现了工作流模板和实例分离
- `ExecutionResult` 统一了执行结果格式

**2. 服务层抽象**
```
stores/ → services/ → transport/
```
- Store 层负责 UI 状态（scheduled-tasks-store.svelte.ts）
- Service 层封装 MCP 通信（scheduled-tasks-service.ts）
- Transport 层统一 IPC（tauri.ts, websocket.ts）

**3. Svelte 5 响应式设计**
- 使用 `$state` 声明式状态
- Computed properties 通过 getter 实现
- 单例模式导出 store 实例

**4. 内置 Skill 内容嵌入**
- 三个内置 Skill 的完整内容直接存储在代码中
- 简化了静态资源配置

---

## 二、可借鉴的 Codex Claude Cowork 设计

### 1. Skill Pipeline 模式

**当前问题**：Skill 执行后结果直接返回，没有后续处理链。

**建议实现**：
```typescript
// 新增 types/skill-pipeline.ts
export interface SkillPipeline {
  id: string;
  name: string;
  description: string;
  stages: PipelineStage[];
  enabled: boolean;
}

export interface PipelineStage {
  id: string;
  skillId: string;
  condition?: string;
  retryPolicy?: RetryPolicy;
  onFailure: "stop" | "skip" | "fallback";
}

export interface RetryPolicy {
  maxAttempts: number;
  backoffMs: number;
  exponential?: boolean;
}
```

**应用场景**：
- 定时任务失败自动重试
- 多阶段 Skill 串联（如 setup-cowork 的步骤流）
- 条件分支执行

---

### 2. 更丰富的 Skill 执行状态

**当前**：`ExecutionStatus = "pending" | "running" | "completed" | "failed" | "cancelled"`

**建议扩展**：
```typescript
export interface SkillExecution {
  id: string;
  skillId: string;
  skillName: string;
  args: string;
  status: ExecutionStatus;
  startedAt: string;
  completedAt?: string;
  result?: string;
  error?: string;
  sessionId?: string;

  // 新增字段
  progress?: number;
  currentStep?: string;
  logs?: ExecutionLog[];
  outputFiles?: string[];
  parentExecutionId?: string;
}

export interface ExecutionLog {
  timestamp: string;
  level: "info" | "warn" | "error";
  message: string;
  context?: Record<string, unknown>;
}
```

---

### 3. Skill 市场集成

**当前**：Marketplace 服务已存在，但 Skill 下载后没有完整的生命周期管理。

**建议增强**：
```typescript
export interface MarketplaceSkill {
  manifest: SkillManifest;
  downloads: number;
  rating: number;
  reviews: SkillReview[];
  compatibility: string[];
  lastUpdated: string;
  changelog?: string;
}

export interface SkillReview {
  author: string;
  rating: number;
  content: string;
  createdAt: string;
}
```

---

### 4. 团队协作支持

**建议参考 Codex 的团队模式**：
```typescript
export interface TeamWorkspace {
  id: string;
  name: string;
  members: TeamMember[];
  sharedSkills: SharedSkill[];
  sharedSchedules: SharedScheduledTask[];
  activityFeed: ActivityEvent[];
}

export interface SharedSkill {
  skill: Skill;
  permissions: "view" | "execute" | "edit";
  sharedBy: string;
  sharedAt: string;
}

export interface ActivityEvent {
  id: string;
  type: "skill_executed" | "task_completed" | "member_joined";
  actor: string;
  target: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}
```

---

### 5. 事件驱动架构

**建议增强**：引入事件总线
```typescript
// 新增 lib/events.ts
export const events = {
  skill: new EventEmitter<SkillEvent>(),
  task: new EventEmitter<TaskEvent>(),
  ui: new EventEmitter<UIEvent>(),
};

export type SkillEvent =
  | { type: "execution_start"; execution: SkillExecution }
  | { type: "execution_complete"; execution: SkillExecution }
  | { type: "error"; source: string; error: Error };
```

**应用场景**：
- Skill 执行时在 UI 显示实时进度
- 任务完成时发送系统通知
- 跨组件通信

---

### 6. 高级调度能力

**建议增强**：
```typescript
export interface AdvancedSchedule {
  dependsOn?: string[];
  
  triggerCondition?: {
    type: "file_changed" | "time_range" | "webhook" | "custom";
    config: Record<string, unknown>;
  };
  
  executionWindow?: {
    startHour: number;
    endHour: number;
    timezone: string;
  };
  
  failureHandling: {
    maxRetries: number;
    retryDelay: number;
    onMaxRetriesExceeded: "disable" | "notify" | "fallback_task";
  };
  
  notifications: {
    onStart?: boolean;
    onComplete?: boolean;
    onFailure?: boolean;
    channels: ("app" | "email" | "webhook")[];
  };
}
```

---

### 7. 上下文感知 Skill

```typescript
export interface SkillContext {
  projectPath?: string;
  projectType?: "svelte" | "react" | "node" | "python" | "rust";
  relevantFiles: string[];
  currentBranch?: string;
  recentCommits?: string[];
  activeSessions?: string[];
  conversationHistory?: Message[];
  recentErrors?: string[];
  timeOfDay: "morning" | "afternoon" | "evening" | "night";
  dayOfWeek: "weekday" | "weekend";
}

export interface ContextAwareSkill extends Skill {
  contexts: SkillContextRequirement[];
  autoInvoke?: {
    enabled: boolean;
    triggerPatterns: string[];
  };
}
```

---

### 8. Skill 版本控制

```typescript
export interface SkillVersion {
  version: string;
  changelog: string;
  releasedAt: string;
  breakingChanges: boolean;
  migrations?: string[];
}

export interface VersionedSkill extends Skill {
  currentVersion: string;
  versions: SkillVersion[];
  autoUpdate?: boolean;
  channel: "stable" | "beta" | "alpha";
}
```

---

## 三、具体落地建议

### Phase 1: 基础增强（1-2 周）

1. **扩展 Skill Execution 状态**
   - 添加 progress、logs、currentStep 字段
   - 更新 skill-store.svelte.ts 显示执行进度

2. **增强事件系统**
   - 创建 events.ts 事件总线
   - 在 Skill 执行关键节点 emit 事件

3. **改进 Skill 编辑器**
   - 添加 YAML frontmatter 实时验证
   - 提供模板选择器

### Phase 2: 功能增强（2-4 周）

4. **Skill Pipeline**
   - 实现 PipelineStage 类型
   - 添加 pipeline execution engine
   - 支持条件分支和重试

5. **高级调度**
   - 添加 dependsOn 依赖链
   - 实现 executionWindow
   - 添加通知配置

### Phase 3: 生态建设（4+ 周）

6. **Marketplace 增强**
   - 评分和评论系统
   - 版本兼容性检测
   - 自动更新机制

7. **团队协作**
   - 共享 Skill 功能
   - 活动事件流
   - 权限控制

---

## 四、代码示例

### 事件驱动的 Skill 执行

```typescript
// lib/events/skill-events.ts
import { createEventEmitter } from "$lib/utils/events";

export const skillEvents = createEventEmitter<{
  executing: { skillId: string; args: string };
  progress: { executionId: string; progress: number; message: string };
  completed: { executionId: string; result: string };
  failed: { executionId: string; error: string };
}>();
```

### 上下文感知的 Skill 执行器

```typescript
// services/context-aware-executor.ts
export class ContextAwareExecutor {
  async execute(skill: Skill, args: string, context: SkillContext): Promise<ExecutionResult> {
    if (skill.contexts) {
      for (const req of skill.contexts) {
        if (!this.validateContext(req, context)) {
          return {
            success: false,
            output: "",
            error: `Context requirement not met: ${req.type}`
          };
        }
      }
    }

    skillEvents.emit("executing", { skillId: skill.id, args });

    try {
      const result = await this.executeInternal(skill, args, context);

      if (result.success) {
        skillEvents.emit("completed", { executionId: skill.id, result: result.output });
      }

      return result;
    } catch (e) {
      skillEvents.emit("failed", { executionId: skill.id, error: e.message });
      throw e;
    }
  }
}
```

---

## 五、结论

MiWarp 已经具备了良好的架构基础，Codex Claude Cowork 的设计模式可以作为以下方向的发展指引：

1. **更丰富的执行状态和反馈** — 让用户实时了解 Skill/任务执行情况
2. **Pipeline 和依赖管理** — 支持复杂的多步骤工作流
3. **事件驱动架构** — 解耦组件，提高可维护性
4. **上下文感知** — 让 Skill 根据环境自动适配
5. **版本化和生态化** — 支撑 Skill 市场长期发展

建议按 Phase 逐步落地，优先实现 Phase 1 的基础增强，再根据实际需求推进后续功能。
