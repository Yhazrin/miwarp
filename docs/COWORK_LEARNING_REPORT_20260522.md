# MiWarp 从 Codex Claude Cowork 学习心得报告

> 本报告基于 2026-05-22 的定时任务自动执行生成，综合分析了 MiWarp 当前架构和 Codex Claude Cowork 的设计模式。

---

## 一、Codex Claude Cowork 核心设计模式总结

### 1.1 多 Agent 并行执行模式

Cowork 支持多个 AI Agent 并行工作，处理复杂任务：

- **预设任务模式**：通过正则表达式匹配用户输入，自动选择 Agent 组合
- **依赖管理**：Agent 之间声明依赖关系（如 `dependsOn: ["frontend"]`）
- **实时进度跟踪**：每个 Agent 的执行状态实时更新
- **自然语言解析**：用户用自然语言描述任务，系统自动解析为 Agent 配置

### 1.2 Skill 自包含设计

- **前置验证**：确保 Skill 包含必要的元数据
- **禁止引用检查**：检测 Skill 中是否存在会话级引用（如 "current conversation"）
- **预览生成**：执行前生成执行步骤预览
- **依赖声明**：支持 Skill 之间的依赖关系

### 1.3 任务执行监控

- **多状态支持**：queued / running / paused / completed / failed / cancelled
- **日志流式输出**：实时显示执行日志
- **资源使用追踪**：CPU、内存、执行时长、Token 消耗
- **步骤分解**：将复杂任务分解为多个可追踪的步骤

### 1.4 定时任务增强

- **Cron 表达式支持**：灵活的调度配置
- **依赖配置**：任务可以依赖其他任务的完成状态
- **事件触发**：支持文件变化、任务完成等事件触发
- **重试配置**：支持线性、指数、固定三种退避策略

### 1.5 记忆系统自动整理 (consolidate-memory)

Codex Cowork 提供的 `consolidate-memory` skill 实现记忆文件自动整理：
- 扫描记忆文件
- 分析重复和过期条目
- 合并重复条目
- 删除过期条目
- 更新交叉引用

核心规则：
- "Separate the durable from the dated"
- "Merge overlaps"
- "Fix time references"
- "Drop what's easy to re-find"
- "One line per entry, under ~150 chars"

---

## 二、MiWarp 当前实现状态

### 2.1 已完成的功能 ✅

| 功能 | 实现位置 | 状态 |
|------|----------|------|
| 多 Agent 服务 | `src/lib/services/multi-agent-service.ts` | ✅ 完整实现 |
| Skill 预览服务 | `src/lib/services/skill-preview.ts` | ✅ 完整实现 |
| Skill 预览对话框 | `src/lib/components/SkillPreviewDialog.svelte` | ✅ 完整实现 |
| PhaseProcessor | `src/lib/utils/phase-processor.ts` | ✅ 完整实现 |
| 增强执行类型 | `src/lib/types/skill-execution.ts` | ✅ 完整实现 |
| 定时任务类型 | `src/lib/types/scheduled-task.ts` | ✅ 完整实现 |
| Skill 验证器 | `src/lib/utils/skill-validator.ts` | ✅ 完整实现 |
| Skill 编辑器 | `src/lib/components/SkillEditor.svelte` | ✅ 完整实现 |
| MCP 插件系统 | `src/lib/stores/plugin-store.svelte.ts` | ✅ 完整实现 |
| 上下文窗口可视化 | `src/lib/components/ContextWindowBar.svelte` | ✅ 完整实现 |

### 2.2 部分实现的功能 🔄

| 功能 | 实现位置 | 状态 |
|------|----------|------|
| 任务执行日志面板 | `src/lib/components/TaskExecutionMonitor.svelte` | 🔄 部分实现 |
| 定时任务编辑器 | `src/lib/components/ScheduledTaskEditorPanel.svelte` | 🔄 部分实现 |
| Skill 市场 | `src/lib/services/plugin-marketplace.ts` | 🔄 部分实现 |
| 社区 Skills 同步 | `src-tauri/src/skill_sources/` | 🔄 部分实现 |

### 2.3 待实现的功能 ❌

| 功能 | 建议实现位置 | 优先级 |
|------|-------------|--------|
| Prompt 自包含校验 | `src/lib/utils/prompt-validator.ts` | 高 |
| 用户角色系统 | `src/lib/types/user-role.ts` | 中 |
| 统一连接器接口 | `src/lib/types/connector.ts` | 中 |
| 事件总线系统 | `src/lib/events/` | 中 |
| 记忆自动整理服务 | `src/lib/services/memory-grooming-service.ts` | 中 |
| 实时日志流 | `src/lib/components/ExecutionLogPanel.svelte` | 高 |

---

## 三、具体落地建议

### 3.1 高优先级：Prompt 自包含校验器

**问题**：Skill prompt 可能引用会话上下文，导致定时执行时上下文丢失。

**建议实现**：`src/lib/utils/prompt-validator.ts`

```typescript
export interface PromptValidationResult {
  isValid: boolean;
  issues: PromptIssue[];
  suggestions: string[];
}

export interface PromptIssue {
  type: "forbidden_reference" | "missing_context" | "unresolved_variable";
  message: string;
  position?: { line: number; column: number };
}

export function validateSelfContained(prompt: string): PromptValidationResult {
  const forbiddenPatterns = [
    /current conversation/i,
    /the above/i,
    /as mentioned (previously|before)/i,
    /earlier (in this|we)/i,
  ];
  // ... 实现检测逻辑
}
```

**应用场景**：
- Skill 编辑器中实时校验
- 定时任务创建前验证
- 执行前再次检查

### 3.2 高优先级：实时执行日志面板

**问题**：当前 Skill 执行没有实时日志流，用户无法看到执行进度。

**建议实现**：`src/lib/components/ExecutionLogPanel.svelte`

功能：
- 显示 SkillExecutionEnhanced.logs 的实时更新
- 支持 info/warn/error 不同级别过滤
- 时间戳显示
- 可折叠的上下文详情

### 3.3 中优先级：用户角色系统

**问题**：无个性化推荐能力。

**建议实现**：`src/lib/types/user-role.ts`

```typescript
export interface UserRole {
  id: string;
  name: string;
  description: string;
  icon: string;
  recommendedProviders: string[];
  suggestedSkills: string[];
  defaultPermissions: string[];
  tags: string[];
}
```

**落地方案**：
1. 新增类型文件
2. 在 settings 中存储用户角色
3. 基于角色过滤技能市场推荐

### 3.4 中优先级：事件总线系统

**问题**：组件之间耦合度高，缺乏统一的事件通信机制。

**建议实现**：`src/lib/events/skill-events.ts`

```typescript
import { createEventEmitter } from "$lib/utils/events";

export const skillEvents = createEventEmitter<{
  executing: { skillId: string; args: string };
  progress: { executionId: string; progress: number; message: string };
  completed: { executionId: string; result: string };
  failed: { executionId: string; error: string };
}>();
```

**应用场景**：
- Skill 执行时在 UI 显示实时进度
- 任务完成时发送系统通知
- 跨组件通信

### 3.5 中优先级：记忆自动整理服务

**借鉴 Codex 的 consolidate-memory 设计**

```typescript
// 新增 services/memory-grooming-service.ts
export interface MemoryGroomingConfig {
  maxFileSize: number;        // 默认 25KB
  maxIndexEntries: number;    // 默认 100 条
  maxEntryLength: number;     // 默认 150 字符
  autoMergeDuplicates: boolean;
  staleThresholdDays: number;
  dryRun: boolean;
}
```

---

## 四、架构改进建议

### 4.1 PhaseProcessor 集成

当前 `src/lib/utils/phase-processor.ts` 已实现，但尚未在多 Agent 执行中广泛使用。建议在 `multi-agent-service.ts` 中使用：

```typescript
const processor = new PhaseProcessor(phases);
const results = await processor.run(context, { continueOnError: true });
```

### 4.2 统一的任务执行框架

建议将定时任务和即时任务统一到一个执行框架中：

```
TaskExecutionFramework
├── Scheduler (定时调度)
├── EventTrigger (事件触发)
├── PhaseProcessor (多阶段执行)
├── SkillExecutor (Skill 执行)
└── NotificationService (通知服务)
```

### 4.3 状态管理优化

当前使用 Svelte 5 的 `$state` 响应式系统，建议：
1. 将 TaskExecutionMonitor 相关状态提取到独立 store
2. 使用 `$derived` 优化计算属性
3. 增加持久化支持，支持页面刷新后恢复执行状态

---

## 五、结论

MiWarp 已经具备了良好的架构基础，从 Codex Claude Cowork 借鉴的核心设计模式已在项目中得到部分实现：

- ✅ 多 Agent 并行执行服务
- ✅ Skill 预览和验证系统
- ✅ PhaseProcessor 多阶段执行引擎
- ✅ 增强的执行状态追踪
- ✅ 定时任务依赖和重试配置

建议下一步优先实现：

1. **Prompt 自包含校验器** — 防止定时执行失败
2. **实时执行日志面板** — 提升用户体验
3. **事件总线系统** — 解耦组件通信

这些改进都是渐进式的，建议按优先级逐步落地。

---

*报告生成时间：2026-05-22*
*基于 docs/cowork-design-lessons.md、docs/cowork-design-learning.md、docs/CODEX_LEARNING_SUMMARY.md 综合分析*