# 从 Codex Claude Cowork 学习心得：MiWarp 落地建议

> 本报告基于对 MiWarp 现有架构分析和 Codex Claude Cowork 设计模式研究，提炼可落地的设计优化建议。

---

## 一、设计模式总结

### 1.1 核心设计理念

Codex Claude Cowork 展现了以下核心设计理念，这些与 MiWarp 的目标高度契合：

| 设计理念 | Codex 实现 | MiWarp 对应 | 建议 |
|----------|-----------|-------------|------|
| **步骤化执行** | Phase 1/2/3 分阶段引导 | Workflow 模板 | 增强 Phase 概念 |
| **干预级别控制** | MCP 工具调用实现分级干预 | InterventionLevel 枚举 | 扩展到 Skill 执行 |
| **自包含 Prompt** | 禁止引用会话上下文 | 当前无校验 | 增加自包含性检测 |
| **本地时区解析** | Cron 在 LOCAL 时区评估 | 当前 UTC | 统一为本地时区 |
| **角色化推荐** | Role-based 插件发现 | 当前无角色系统 | 新增用户角色配置 |
| **连接器抽象** | 统一工具接入层 | MCP Server | 统一连接器接口 |

### 1.2 成功的设计模式

**A. 多步骤向导模式 (Step-by-Step Wizard)**
```
- One step at a time
- Skips are fine
- Keep each message short
- Two or three sentences plus the widget
```

**B. 相位处理模式 (Phase Processing)**
```
Phase 1: Take stock（盘点）
Phase 2: Consolidate（合并）
Phase 3: Tidy the index（清理）
```

**C. 自包含 Prompt 设计**
```
Future runs will NOT have access to this session
禁止引用 "current conversation", "the above"
```

---

## 二、具体落地建议

### 2.1 Phase 增强（高优先级）

**当前问题**：Workflow 有 Step 概念，但缺少 Phase 层面的组织。

**建议**：
```typescript
// 新增 types/skill-phase.ts
export interface SkillPhase {
  id: string;
  title: string;
  description: string;
  steps: WorkflowStep[];
  estimatedDuration?: string;
  canSkip?: boolean;
  checkpoint?: boolean; // 可回滚点
}

export interface PhaseProgress {
  phaseId: string;
  currentStepIndex: number;
  completed: boolean;
  startedAt: string;
  completedAt?: string;
}
```

**落地位置**：`src/lib/types/workflow.ts`

---

### 2.2 干预级别设计（高优先级）

**当前问题**：缺少细粒度的执行控制。

**建议**：
```typescript
// 扩展现有 InterventionLevel
export type InterventionLevel = 
  | "autonomous"      // 完全自主执行
  | "pre-confirm"     // 执行前确认
  | "plan-approval"   // 需要审批计划
  | "full-handoff";   // 完整交接

export interface SkillExecutionPolicy {
  skillId: string;
  interventionLevel: InterventionLevel;
  maxAutonomousSteps?: number;
  requireApprovalAt?: string[]; // 特定步骤需确认
  highRiskActions?: string[];    // 高风险操作列表
}
```

**落地方案**：
1. 在 `src/lib/types/skill.ts` 添加 `SkillExecutionPolicy`
2. 高风险操作（文件删除、API 调用）自动提升干预级别
3. 在 Skill 编辑器 UI 增加干预级别选择器

---

### 2.3 自包含 Prompt 校验（中优先级）

**当前问题**：Skill prompt 可能引用会话上下文，导致定时执行时上下文丢失。

**建议**：
```typescript
// 新增 lib/utils/prompt-validator.ts
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
  
  // 检测禁止的引用模式
  // 检查外部变量使用
  // 返回校验结果
}
```

**落地方案**：
1. 新增 `src/lib/utils/prompt-validator.ts`
2. 在 `SkillEditor` 组件中集成实时校验
3. 创建 `/api/skills/validate` 端点

---

### 2.4 用户角色系统（中优先级）

**当前问题**：无个性化推荐能力。

**建议**：
```typescript
// 新增 types/user-role.ts
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

export const USER_ROLES: UserRole[] = [
  {
    id: "frontend-dev",
    name: "Frontend Developer",
    description: "Web apps, components, UI/UX",
    icon: "💻",
    recommendedProviders: ["anthropic", "deepseek"],
    suggestedSkills: ["code-review", "component-gen", "test-write"],
    defaultPermissions: ["file:read", "file:write"],
    tags: ["web", "ui", "react", "svelte"],
  },
  {
    id: "backend-dev",
    name: "Backend Developer",
    description: "APIs, services, infrastructure",
    icon: "⚙️",
    recommendedProviders: ["anthropic", "zhipu"],
    suggestedSkills: ["api-design", "db-migrate", "deploy-config"],
    defaultPermissions: ["file:read", "file:write", "terminal"],
    tags: ["api", "database", "devops"],
  },
  {
    id: "fullstack",
    name: "Full Stack Developer",
    description: "End-to-end application development",
    icon: "🚀",
    recommendedProviders: ["anthropic", "deepseek", "zhipu"],
    suggestedSkills: ["fullstack-dev", "code-review", "test-write"],
    defaultPermissions: ["file:read", "file:write", "terminal"],
    tags: ["web", "api", "database", "ui"],
  },
  {
    id: "data-engineer",
    name: "Data Engineer",
    description: "Data pipelines, ETL, analytics",
    icon: "📊",
    recommendedProviders: ["anthropic", "kimi"],
    suggestedSkills: ["data-pipeline", "sql-review", "etl-template"],
    defaultPermissions: ["file:read", "file:write", "terminal"],
    tags: ["data", "sql", "pipeline"],
  },
];

export interface UserPreferences {
  roleId?: string;
  projectPaths: string[];
  selectedProvider?: string;
  theme: "light" | "dark" | "system";
}
```

**落地方案**：
1. 新增 `src/lib/types/user-role.ts`
2. 在 `settings.json` 中存储用户角色
3. 创建 `RolePicker` 组件
4. 基于角色过滤技能市场推荐

---

### 2.5 统一连接器接口（中优先级）

**当前问题**：MCP Server、Browser、Provider 连接分散。

**建议**：
```typescript
// 新增 types/connector.ts
export type ConnectorType = "mcp" | "api" | "browser" | "file" | "custom";

export interface Connector {
  id: string;
  name: string;
  type: ConnectorType;
  description: string;
  status: "connected" | "disconnected" | "error" | "connecting";
  capabilities: string[];
  config: Record<string, unknown>;
  lastChecked?: string;
  errorMessage?: string;
}

export interface ConnectorTestResult {
  success: boolean;
  latency?: number;
  message: string;
  capabilities?: string[];
}

export interface ConnectorRegistry {
  connectors: Connector[];
  
  register(connector: Connector): void;
  unregister(id: string): void;
  test(id: string): Promise<ConnectorTestResult>;
  getByType(type: ConnectorType): Connector[];
  getByStatus(status: Connector["status"]): Connector[];
}
```

**落地方案**：
1. 新增 `src/lib/types/connector.ts`
2. 统一现有 Provider、MCP、Browser 连接状态管理
3. 创建连接器仪表板 UI

---

### 2.6 本地时区 Cron 增强（低优先级）

**当前已有**：CRON_PRESETS 和 ScheduledTask 类型支持 `cronExpression`。

**建议增强**：
```typescript
// 扩展 scheduled-task.ts
export interface ScheduledTask {
  // ... 现有字段
  
  // 新增
  timezone?: string;  // 明确指定时区，默认本地时区
  localTimezone?: boolean;  // 是否使用本地时区
}
```

**落地方案**：
1. 更新 Cron 解析逻辑使用本地时区
2. 在 UI 显示下次执行的具体本地时间
3. 添加时区选择器（高级选项）

---

### 2.7 记忆系统自动整理（低优先级）

**借鉴 Codex 的 consolidate-memory 设计**：

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

export interface GroomingReport {
  scannedFiles: number;
  duplicateEntries: number;
  staleEntries: number;
  mergedEntries: number;
  deletedEntries: number;
  newIndexLines: number;
  errors: string[];
}

// 核心规则（来自 Codex）
// - Separate the durable from the dated
// - Merge overlaps  
// - Fix time references
// - Drop what's easy to re-find
// - One line per entry, under ~150 chars
```

---

## 三、实施路线图

### Phase 1: 基础增强（1-2 周）

| 功能 | 文件 | 说明 |
|------|------|------|
| Phase 类型定义 | `src/lib/types/workflow.ts` | 扩展 Step 支持 Phase |
| 自包含校验 | `src/lib/utils/prompt-validator.ts` | 新增工具函数 |
| 本地时区 Cron | `src/lib/types/scheduled-task.ts` | 默认使用本地时区 |

### Phase 2: 角色系统（2-3 周）

| 功能 | 文件 | 说明 |
|------|------|------|
| 用户角色类型 | `src/lib/types/user-role.ts` | 新增类型文件 |
| RolePicker 组件 | `src/lib/components/RolePicker.svelte` | 角色选择 UI |
| 角色存储 | `src-tauri/src/storage/settings.rs` | 持久化用户角色 |
| 角色化推荐 | `src/lib/stores/skill-store.svelte.ts` | 基于角色推荐技能 |

### Phase 3: 连接器统一（3-4 周）

| 功能 | 文件 | 说明 |
|------|------|------|
| 连接器类型 | `src/lib/types/connector.ts` | 统一接口定义 |
| 连接器注册表 | `src/lib/services/connector-registry.ts` | 连接器管理服务 |
| 连接器仪表板 | `src/routes/settings/connectors/+page.svelte` | 连接器管理 UI |

### Phase 4: 高级功能（4-6 周）

| 功能 | 文件 | 说明 |
|------|------|------|
| 记忆整理服务 | `src/lib/services/memory-grooming-service.ts` | 自动化记忆管理 |
| 干预级别扩展 | `src/lib/types/skill-execution-policy.ts` | 细粒度执行控制 |
| 技能执行引擎重构 | `src/lib/services/skill-engine.ts` | 统一执行入口 |

---

## 四、代码示例

### 4.1 统一 Skill 执行引擎

```typescript
// src/lib/services/skill-engine.ts
export class SkillEngine {
  private executor: SkillExecutor;
  private scheduler: TaskScheduler;
  private notifier: NotificationService;
  private validator: PromptValidator;

  async execute(
    skill: Skill,
    context: ExecutionContext
  ): Promise<ExecutionResult> {
    // 1. 验证 Prompt 自包含性
    const validation = this.validator.validateSelfContained(skill.content);
    if (!validation.isValid) {
      return {
        success: false,
        output: "",
        error: `Prompt issues: ${validation.issues.map(i => i.message).join(", ")}`,
      };
    }

    // 2. 确定干预级别
    const policy = this.determinePolicy(skill, context);

    // 3. 执行技能
    if (policy.interventionLevel === "autonomous") {
      return this.executor.execute(skill, context);
    }

    // 其他干预级别处理...
  }

  private determinePolicy(
    skill: Skill,
    context: ExecutionContext
  ): SkillExecutionPolicy {
    // 高风险操作自动提升干预级别
    // 基于用户配置确定级别
  }
}
```

### 4.2 Phase 感知的 Workflow 渲染

```svelte
<!-- src/lib/components/PhaseStepper.svelte -->
<script lang="ts">
  import type { SkillPhase } from "$lib/types/workflow";
  
  let { phases }: { phases: SkillPhase[] } = $props();
  let currentPhaseIndex = $state(0);
  
  const currentPhase = $derived(phases[currentPhaseIndex]);
  const progress = $derived(((currentPhaseIndex + 1) / phases.length) * 100);
</script>

<div class="phase-stepper">
  <div class="progress-bar">
    <div class="progress-fill" style="width: {progress}%"></div>
  </div>
  
  <div class="phase-header">
    <span class="phase-number">Phase {currentPhaseIndex + 1}</span>
    <span class="phase-title">{currentPhase.title}</span>
  </div>
  
  <div class="step-list">
    {#each currentPhase.steps as step, i}
      <StepCard {step} active={i === currentPhase.currentStepIndex} />
    {/each}
  </div>
  
  <div class="phase-actions">
    {#if currentPhase.canSkip}
      <button class="btn-secondary" onclick={skipPhase}>Skip Phase</button>
    {/if}
    <button class="btn-primary" onclick={nextPhase}>
      {currentPhaseIndex === phases.length - 1 ? "Complete" : "Next Phase"}
    </button>
  </div>
</div>
```

---

## 五、总结

MiWarp 已经具备了完善的基础架构，从 Codex Claude Cowork 可以借鉴的核心设计：

1. **Phase 增强** — 将工作流组织为 Phase > Step 层级，提供更清晰的执行指引
2. **自包含校验** — 确保定时任务不会因引用会话上下文而失败
3. **用户角色系统** — 实现个性化推荐和配置
4. **干预级别** — 细粒度控制 Skill 执行中的用户介入程度
5. **连接器统一** — 标准化工具接入层
6. **本地时区** — Cron 表达式默认在本地时区评估

这些改进都是渐进式的，建议按 Phase 1-4 逐步落地，优先实现基础增强，再根据实际需求推进后续功能。

---

*报告生成时间: 2026-05-14*
*基于 docs/cowork-design-learning.md、docs/cowork-design-analysis.md、docs/CODEX_DESIGN_PATTERNS.md 综合分析*
