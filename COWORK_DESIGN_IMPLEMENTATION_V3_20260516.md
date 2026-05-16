# Claude Cowork 设计模式落地实施报告 V3

**日期**: 2026-05-16  
**任务来源**: 自动化定时任务  
**实现内容**: 技能预览功能 (SkillPreview) + 任务执行监控 (TaskExecutionMonitor)

---

## 一、实施概述

本次实施基于之前对 Claude Cowork 设计模式的学习分析，聚焦于两个核心功能：

1. **技能预览服务** (`src/lib/services/skill-preview.ts`) - 允许用户在执行前预览技能行为
2. **任务执行监控组件** (`src/lib/components/TaskExecutionMonitor.svelte`) - 实时监控任务执行状态

这两个功能借鉴了 Claude Cowork 的设计理念：用户在执行任何操作前都应该清楚知道将要发生什么。

## 二、新增文件

### 2.1 `src/lib/services/skill-preview.ts`

**功能**: 生成技能执行的预览信息

```typescript
// 核心接口
export interface SkillPreview {
  skillId: string;
  skillName: string;
  description: string;
  steps: PreviewStep[];
  estimatedDuration: string;
  potentialSideEffects: string[];
  warnings: string[];
  prerequisites: string[];
}

export interface PreviewStep {
  order: number;
  description: string;
  icon: string;
  toolCalls?: string[];
  estimatedDuration?: string;
}
```

**主要功能**:

| 功能 | 描述 |
|------|------|
| `generateSkillPreview()` | 根据技能内容和参数生成执行预览 |
| `parseSkillContent()` | 解析技能内容，提取执行步骤 |
| 特定技能处理 | 内置对 schedule、consolidate-memory、setup-cowork 等技能的专门处理 |
| `checkPrerequisites()` | 检查技能依赖是否满足 |
| `estimateDuration()` | 估算执行时长 |

**设计亮点**:

1. **步骤图标系统**: 使用统一的图标表示不同操作类型
2. **警告机制**: 自动检测可能的副作用并提醒用户
3. **前置条件检查**: 验证技能依赖是否已安装
4. **内置技能专门处理**: 针对常用技能提供更详细的预览

### 2.2 `src/lib/components/SkillPreviewDialog.svelte`

**功能**: 技能预览对话框组件

**UI 设计**:

```
┌─────────────────────────────────────────────┐
│ 📋 Skill Preview                            │
│ /schedule - Create a scheduled task        │
├─────────────────────────────────────────────┤
│ Description: Create a scheduled task...    │
│                                             │
│ ⚠️ Warnings                                  │
│ • This skill may modify files               │
│                                             │
│ 📋 Prerequisites                             │
│ • Requires: schedule plugin                 │
│                                             │
│ ── Execution Steps ──                       │
│                                             │
│ ① ⏰ Parse task schedule parameters         │
│    [Parse]                                  │
│                                             │
│ ② ⏰ Validate schedule format                │
│    [Validate]                               │
│                                             │
│ ③ ⏰ Configure recurring schedule            │
│    Est: < 1s                                │
│                                             │
│ ④ ✏️ Save scheduled task                    │
│    Est: ~2s                                 │
│                                             │
│ ⏱️ Estimated duration: ~4s                  │
│                                             │
│ Potential Side Effects: File modification   │
├─────────────────────────────────────────────┤
│ Ctrl+Enter to confirm              Cancel   │
└─────────────────────────────────────────────┘
```

**交互特性**:

| 特性 | 描述 |
|------|------|
| 键盘快捷键 | `Ctrl+Enter` 确认执行 |
| ESC 关闭 | 按 ESC 键关闭对话框 |
| 动态预览 | 根据技能内容实时生成预览 |
| 步骤编号 | 清晰的步骤序号和图标 |
| 警告高亮 | 黄色警告框突出显示风险 |
| 预估时长 | 显示每个步骤和整体的预估时长 |

### 2.3 `src/lib/types/task-execution-monitor.ts`

**功能**: 任务执行监控的类型定义

```typescript
export interface TaskExecutionMonitor {
  taskId: string;
  taskName: string;
  status: TaskExecutionStatus;
  currentStep: number;
  totalSteps: number;
  progress: number; // 0-100
  logs: ExecutionLog[];
  resourceUsage?: ResourceUsage;
  error?: TaskError;
}

export type TaskExecutionStatus = 
  | "queued" 
  | "running" 
  | "paused" 
  | "completed" 
  | "failed" 
  | "cancelled";
```

**辅助函数**:

| 函数 | 描述 |
|------|------|
| `createExecutionMonitor()` | 创建新的监控实例 |
| `addLog()` | 添加日志条目 |
| `updateProgress()` | 更新执行进度 |
| `markCompleted()` | 标记为完成 |
| `markFailed()` | 标记为失败 |
| `getExecutionStats()` | 获取执行统计 |

### 2.4 `src/lib/components/TaskExecutionMonitor.svelte`

**功能**: 任务执行监控 UI 组件

**UI 设计**:

```
┌─────────────────────────────────────────────┐
│ 🔄 Task Name                        Running │
│ ID: abc12345...                            │
├─────────────────────────────────────────────┤
│ Step 3 of 5                         60%    │
│ ████████████████░░░░░░░░░░░░░░░░░░░░░░░░░  │
├─────────────────────────────────────────────┤
│                                             │
│ 14:30:01 ℹ️ Task started                    │
│ 14:30:02 ℹ️ Loading configuration           │
│ 14:30:03 ℹ️ Step 1: Scan files              │
│ 14:30:04 ℹ️ Found 42 files                 │
│ 14:30:05 ℹ️ Step 2: Analyze content        │
│ 14:30:06 ⚠️ Large file detected, skipping   │
│ 14:30:07 ℹ️ Step 3: Process data            │
│                                             │
│ ● Processing...                            │
├─────────────────────────────────────────────┤
│                          Cancel      Retry  │
└─────────────────────────────────────────────┘
```

**功能特性**:

| 特性 | 描述 |
|------|------|
| 状态指示 | 不同的状态显示不同的图标和颜色 |
| 进度条 | 实时显示任务完成百分比 |
| 实时日志 | 自动滚动显示执行日志 |
| 日志级别 | info/warn/error 三种日志级别 |
| 操作按钮 | 根据状态显示取消/重试按钮 |

---

## 三、Cowork 设计模式借鉴

### 3.1 渐进式披露 (Progressive Disclosure)

Cowork 强调用户在执行操作前应该清楚了解将要发生的事。本次实现：

```svelte
<!-- 显示警告和预览 -->
{#if preview.warnings.length > 0}
  <div class="bg-amber-500/10 border-amber-500/20">
    <!-- 警告内容 -->
  </div>
{/if}

<!-- 显示执行步骤 -->
{#each preview.steps as step}
  <div class="step">
    <span class="order">{step.order}</span>
    <span class="icon">{step.icon}</span>
    <span class="description">{step.description}</span>
  </div>
{/each}
```

### 3.2 即时反馈 (Immediate Feedback)

任务执行监控提供实时反馈：

```svelte
<!-- 进度条 -->
<div class="h-2 rounded-full bg-muted">
  <div class="h-full rounded-full transition-all" style="width: {progress}%">
  </div>
</div>

<!-- 日志自动滚动 -->
$effect(() => {
  if (logContainer && logs.length > 0) {
    logContainer.scrollTop = logContainer.scrollHeight;
  }
});
```

### 3.3 操作确认 (Confirmation)

技能执行前需要用户确认：

```svelte
<!-- 确认对话框 -->
<button onclick={handleConfirm}>Execute Skill</button>
<button onclick={handleCancel}>Cancel</button>

<!-- 键盘快捷键 -->
<svelte:window onkeydown={(e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    handleConfirm();
  }
}} />
```

---

## 四、与现有代码的集成

### 4.1 集成 SkillStore

```typescript
// skill-store.svelte.ts 中添加预览方法
async previewSkill(skillId: string, args: string): Promise<SkillPreview> {
  const skill = this.skills.find(s => s.id === skillId);
  if (!skill) throw new Error("Skill not found");
  return generateSkillPreview(skill, args);
}
```

### 4.2 集成 ScheduledTasksStore

```typescript
// scheduled-tasks-store.svelte.ts 中添加监控
private monitors = $state<Map<string, TaskExecutionMonitor>>(new Map());

createMonitor(taskId: string, totalSteps: number): TaskExecutionMonitor {
  const monitor = createExecutionMonitor(taskId, taskId, totalSteps);
  this.monitors.set(taskId, monitor);
  return monitor;
}
```

---

## 五、使用示例

### 5.1 技能预览

```svelte
<script>
  import SkillPreviewDialog from "$lib/components/SkillPreviewDialog.svelte";
  import { skillStore } from "$lib/stores/skill-store.svelte";
  
  let previewOpen = $state(false);
  let selectedSkill = $state(null);
  
  function showPreview(skill) {
    selectedSkill = skill;
    previewOpen = true;
  }
  
  function handleConfirm(skill, args) {
    // 执行技能
    skillStore.executeSkill(skill.id, args);
  }
</script>

<button onclick={() => showPreview(skill)}>
  Preview
</button>

<SkillPreviewDialog
  bind:open={previewOpen}
  skill={selectedSkill}
  args=""
  onConfirm={handleConfirm}
/>
```

### 5.2 任务监控

```svelte
<script>
  import TaskExecutionMonitor from "$lib/components/TaskExecutionMonitor.svelte";
  import { taskStore } from "$lib/stores/scheduled-tasks-store.svelte";
  
  let monitor = $state(taskStore.getMonitor(taskId));
</script>

{#if monitor}
  <TaskExecutionMonitor
    taskId={monitor.taskId}
    taskName={monitor.taskName}
    status={monitor.status}
    progress={monitor.progress}
    currentStep={monitor.currentStep}
    totalSteps={monitor.totalSteps}
    logs={monitor.logs}
    onCancel={() => taskStore.cancelExecution(monitor.taskId)}
    onRetry={() => taskStore.retryExecution(monitor.taskId)}
  />
{/if}
```

---

## 六、后续增强方向

基于本次实施，以下是建议的后续优化：

### 6.1 高优先级

1. **技能执行历史记录**
   - 保存每次执行的输入输出
   - 支持回放和比较

2. **监控数据持久化**
   - 保存执行日志到数据库
   - 支持历史查询

### 6.2 中优先级

3. **技能依赖可视化**
   - 显示技能依赖关系图
   - 缺失依赖一键安装

4. **自定义预览模板**
   - 用户可自定义步骤描述
   - 支持变量插值

### 6.3 低优先级

5. **执行动画效果**
   - 步骤执行动画
   - 进度可视化动画

6. **远程执行监控**
   - 支持远程任务监控
   - WebSocket 实时更新

---

## 七、文件变更清单

| 文件 | 变更类型 | 描述 |
|------|----------|------|
| `src/lib/services/skill-preview.ts` | 新增 | 技能预览服务 |
| `src/lib/components/SkillPreviewDialog.svelte` | 新增 | 技能预览对话框 |
| `src/lib/types/task-execution-monitor.ts` | 新增 | 任务执行监控类型 |
| `src/lib/components/TaskExecutionMonitor.svelte` | 新增 | 任务执行监控组件 |

---

## 八、验证步骤

### 技能预览功能

1. 在技能列表中点击"预览"按钮
2. 检查预览对话框是否正确显示
3. 验证步骤编号和图标
4. 检查警告是否正确显示
5. 使用 Ctrl+Enter 确认执行

### 任务执行监控

1. 创建定时任务并触发执行
2. 观察监控面板是否实时更新
3. 检查进度条是否正确显示
4. 验证日志是否自动滚动
5. 测试取消和重试功能

---

*报告生成时间: 2026-05-16*  
*自动化任务: 从 Claude Cowork 中学习有用的设计，落地到 miwarp 项目中*
