# Codex CLI 设计模式学习总结与 MiWarp 落地指南

> 生成日期: 2026/05/17 | 来源: Codex CLI / Claude Code Cowork 设计模式研究

---

## 核心设计模式概览

| 模式 | 来源 | MiWarp 适用场景 |
|------|------|----------------|
| Phase-based execution | Codex | Workflow 多阶段执行 |
| Self-contained prompts | Cowork | 定时任务 Prompt 验证 |
| Intervention levels | Cowork | 执行权限分级控制 |
| Dual-signal status | Claude Code | 状态指示器（颜色+形状） |
| View modes | Claude Code | 消息视图切换 |
| Context visualization | Claude Code | Token 消耗可视化 |
| Checkpoint timeline | Cursor/Cline | 会话快照与恢复 |
| Role-based recommendation | Cowork | 用户角色系统 |

---

## 1. Phase-Based 执行引擎 (Codex)

### 设计理念
Codex 的 Skills 采用 Phase 分层设计，每个 Phase 包含多个 Step，强调"一步一步执行"的原则。

### MiWarp 当前实现
```typescript
// src/lib/components/workflow/skill.ts
export interface SkillPhase {
  id: string;
  title: string;
  description: string;
  steps: WorkflowStep[];
  canSkip?: boolean;       // 可跳过
  checkpoint?: boolean;   // 回滚点
}
```

### 改进建议

**1.1 添加 Phase 转换钩子**
```typescript
export interface PhaseTransition {
  from: string;
  to: string;
  onEnter?: () => Promise<void>;
  onExit?: () => Promise<void>;
}

export interface SkillExecutionContext {
  role: UserRole;
  projectPath: string;
  variables: Record<string, string>;
  currentPhaseIndex: number;
}
```

**1.2 实现 Phase 状态持久化**
```rust
// src-tauri/src/agent/turn_engine.rs 增强
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum UserTurnKind {
    Normal { auto_ctx_id: u32 },
    Slash { command: String },
    PhaseStep { phase_id: String, step_index: u32 }  // 新增
}
```

**1.3 Phase 执行可视化**
- 进度条分段显示
- 当前 Step 高亮
- Phase 间切换动画
- Skip/Resume 按钮

---

## 2. Self-Contained Prompt 验证 (Cowork)

### 设计理念
定时任务没有会话上下文，所有信息必须内嵌在 Prompt 中。

### 验证规则

```typescript
// src/lib/utils/prompt-validator.ts
const FORBIDDEN_PATTERNS = [
  /current conversation/i,
  /the above/i,
  /as mentioned (previously|before)/i,
  /刚才|之前|上面(提到|说)/i  // 中文
];

const REQUIRED_PATTERNS = [
  /项目路径|project.*path/i,  // 必须包含上下文路径
  /任务目标|goal/i            // 必须包含明确目标
];

export interface PromptValidationResult {
  isValid: boolean;
  issues: PromptIssue[];
  warnings: string[];
}

export function validateSelfContained(prompt: string): PromptValidationResult {
  // 1. 检测禁止引用
  const forbiddenMatches = FORBIDDEN_PATTERNS
    .filter(p => p.test(prompt));
  
  // 2. 检测必需元素
  const hasPath = REQUIRED_PATTERNS[0].test(prompt);
  const hasGoal = REQUIRED_PATTERNS[1].test(prompt);
  
  // 3. 检测外部依赖
  const hasVariable = /\$\{[\w.]+\}/.test(prompt);
  
  return {
    isValid: forbiddenMatches.length === 0 && hasPath && hasGoal,
    issues: [...],
    warnings: hasVariable ? ["包含外部变量，可能在独立运行中失效"] : []
  };
}
```

### 落地位置
- `src/lib/stores/scheduler-store.svelte` - 创建定时任务时验证
- `src-tauri/src/scheduler/` - 保存前二次验证

---

## 3. Intervention Levels (Cowork)

### 设计理念
按操作风险自动提升干预级别，而非固定权限。

### 类型定义

```typescript
// src/lib/types/execution.ts
export type InterventionLevel = 
  | "autonomous"      // 完全自主执行
  | "pre-confirm"     // 执行前确认
  | "plan-approval"   // 需要审批计划
  | "full-handoff";   // 完全交接

export interface ExecutionPolicy {
  defaultLevel: InterventionLevel;
  overrides: {
    [action: string]: InterventionLevel;
  };
}

// 高风险操作自动升级
export const HIGH_RISK_ACTIONS = [
  "git.push",
  "file.delete",
  "file.replace_all",
  "exec.destructive",
  "mcp.tool_delete"
];

export function getRequiredLevel(
  action: string, 
  policy: ExecutionPolicy
): InterventionLevel {
  if (policy.overrides[action]) {
    return policy.overrides[action];
  }
  
  if (HIGH_RISK_ACTIONS.includes(action)) {
    return "pre-confirm";
  }
  
  return policy.defaultLevel;
}
```

### 落地位置
- `src/lib/stores/session-store.svelte` - SessionStore 添加 policy 字段
- `src-tauri/src/agent/session_actor.rs` - 执行前检查权限
- UI 层添加确认对话框组件

---

## 4. Dual-Signal 状态指示器 (Claude Code)

### 设计理念
颜色表示状态，形状表示进程类型。

### 实现

```typescript
// src/lib/components/shared/StatusIndicator.svelte
interface StatusConfig {
  color: "running" | "waiting" | "idle" | "completed" | "failed";
  shape: "active" | "exited" | "sleeping";
  pulse?: boolean;
}

const STATUS_STYLES = {
  running: {
    color: "emerald",
    description: "运行中"
  },
  waiting: {
    color: "amber",
    description: "等待输入"
  },
  idle: {
    color: "gray",
    description: "空闲"
  },
  completed: {
    color: "blue",
    description: "已完成"
  },
  failed: {
    color: "red",
    description: "失败"
  }
};

const SHAPE_ICONS = {
  active: "●",    // 实心圆 - 活跃进程
  exited: "○",    // 空心圆 - 已退出
  sleeping: "◈"   // 菱形 - 休眠中
};

export function getStatusIndicator(state: SessionState, processType: ProcessType): StatusConfig {
  return {
    color: getColorForState(state),
    shape: getShapeForProcessType(processType),
    pulse: state === "running"
  };
}
```

### 状态映射

| 状态 | 颜色 | 形状 | 含义 |
|------|------|------|------|
| running + active | emerald | ● | 正在执行命令 |
| running + sleeping | amber | ◈ | 等待 AI 回复 |
| idle | gray | ○ | 空闲待命 |
| completed | blue | ○ | 任务完成 |
| failed | red | ● | 执行失败 |

---

## 5. View Modes (Claude Code)

### 设计理念
三档视图满足不同用户需求：新手用 Summary，高手用 Detailed，日常用 Normal。

### 实现

```typescript
// src/lib/types/view.ts
export type ViewMode = "summary" | "normal" | "detailed";

export interface ViewModeConfig {
  showToolCalls: boolean;
  collapseToolCalls: boolean;
  showIntermediateSteps: boolean;
  showFileReads: boolean;
  maxMessageLength: number;
}

export const VIEW_MODES: Record<ViewMode, ViewModeConfig> = {
  summary: {
    showToolCalls: false,
    collapseToolCalls: false,
    showIntermediateSteps: false,
    showFileReads: false,
    maxMessageLength: 200
  },
  normal: {
    showToolCalls: true,
    collapseToolCalls: true,
    showIntermediateSteps: false,
    showFileReads: true,
    maxMessageLength: -1  // 不限制
  },
  detailed: {
    showToolCalls: true,
    collapseToolCalls: false,
    showIntermediateSteps: true,
    showFileReads: true,
    maxMessageLength: -1
  }
};
```

### UI 组件
- 快捷键: `Ctrl+O` 切换视图模式
- 状态栏显示当前模式
- Tab 栏或下拉菜单选择

---

## 6. Context Window 可视化 (Claude Code)

### 设计理念
分段显示 Token 消耗，让用户主动管理上下文。

### 实现

```typescript
// src/lib/components/chat/ContextProgress.svelte
interface ContextSegment {
  name: string;
  tokens: number;
  color: string;
  expandable: boolean;
}

const CONTEXT_SEGMENTS: ContextSegment[] = [
  { name: "System", tokens: systemTokens, color: "#6366f1", expandable: false },
  { name: "CLAUDE.md", tokens: claudeMdTokens, color: "#8b5cf6", expandable: true },
  { name: "File Reads", tokens: fileReadTokens, color: "#06b6d4", expandable: true },
  { name: "Tool Outputs", tokens: toolOutputTokens, color: "#f59e0b", expandable: true },
  { name: "Messages", tokens: messageTokens, color: "#10b981", expandable: true }
];

export const MAX_CONTEXT_TOKENS = 200000;

export function calculatePercentage(segments: ContextSegment[]): number {
  const total = segments.reduce((sum, s) => sum + s.tokens, 0);
  return Math.min((total / MAX_CONTEXT_TOKENS) * 100, 100);
}
```

### 警告阈值
- 70%: 黄色警告
- 85%: 橙色警告 + 建议清理
- 95%: 红色警告 + 自动触发上下文摘要

---

## 7. Checkpoint Timeline (Cursor/Cline)

### 设计理念
主要操作前自动保存快照，支持选择性恢复。

### 数据结构

```rust
// src-tauri/src/storage/checkpoint.rs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Checkpoint {
    pub id: String,
    pub session_id: String,
    pub created_at: DateTime<Utc>,
    pub trigger: CheckpointTrigger,
    pub files: Vec<FileSnapshot>,
    pub task_state: Option<TaskState>,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum CheckpointTrigger {
    BeforeEdit,           // 编辑前
    BeforeBulkOperation,   // 批量操作前
    Manual,               // 手动创建
    Periodic,             // 定期自动
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileSnapshot {
    pub path: String,
    pub content_hash: String,
    pub content_preview: String,
}
```

### API

```rust
#[tauri::command]
async fn create_checkpoint(
    session_id: String,
    trigger: CheckpointTrigger,
    description: Option<String>
) -> Result<Checkpoint, Error>;

#[tauri::command]
async fn list_checkpoints(
    session_id: String,
    limit: Option<u32>
) -> Result<Vec<CheckpointSummary>, Error>;

#[tauri::command]
async fn restore_checkpoint(
    checkpoint_id: String,
    restore_mode: RestoreMode  // FilesOnly, TaskOnly, Both
) -> Result<RestoreResult, Error>;
```

---

## 8. Role-Based 用户角色系统 (Cowork)

### 设计理念
首次使用时收集用户角色，提供个性化推荐。

### 实现

```typescript
// src/lib/types/user.ts
export interface UserRole {
  id: string;
  name: string;
  icon: string;
  recommendedProviders: string[];
  suggestedSkills: string[];
  defaultPermissions: InterventionLevel[];
}

export const USER_ROLES: UserRole[] = [
  {
    id: "frontend-dev",
    name: "前端开发",
    icon: "🎨",
    recommendedProviders: ["claude-sonnet-4"],
    suggestedSkills: ["react-patterns", "css-optimization"],
    defaultPermissions: ["autonomous", "pre-confirm"]
  },
  {
    id: "backend-dev",
    name: "后端开发",
    icon: "⚙️",
    recommendedProviders: ["claude-opus-3"],
    suggestedSkills: ["api-design", "database-optimization"],
    defaultPermissions: ["pre-confirm", "plan-approval"]
  },
  {
    id: "full-stack",
    name: "全栈开发",
    icon: "🚀",
    recommendedProviders: ["claude-sonnet-4"],
    suggestedSkills: ["full-stack-debug", "deployment"],
    defaultPermissions: ["autonomous", "pre-confirm"]
  },
  {
    id: "data-engineer",
    name: "数据工程师",
    icon: "📊",
    recommendedProviders: ["claude-opus-3"],
    suggestedSkills: ["sql-optimization", "data-pipeline"],
    defaultPermissions: ["pre-confirm", "plan-approval"]
  }
];
```

### 落地位置
- Settings → Profile → 选择角色
- 新建会话时根据角色推荐 Skill
- Team 创建时预配置权限模板

---

## 9. Connector Registry 模式 (Cowork)

### 设计理念
统一接口管理所有外部工具集成。

### 实现

```typescript
// src/lib/types/connector.ts
export type ConnectorType = "mcp" | "api" | "browser" | "file" | "git";

export interface Connector {
  id: string;
  name: string;
  type: ConnectorType;
  status: "connected" | "disconnected" | "error" | "loading";
  capabilities: string[];
  config: Record<string, unknown>;
  lastSync?: Date;
}

export interface ConnectorCapability {
  id: string;
  name: string;
  description: string;
  inputSchema: JSONSchema;
  outputSchema: JSONSchema;
}

// 连接器能力注册表
export const CONNECTOR_CAPABILITIES: Record<string, ConnectorCapability> = {
  "mcp-file-read": {
    id: "mcp-file-read",
    name: "读取文件",
    description: "通过 MCP 协议读取项目文件",
    inputSchema: { type: "object", properties: { path: { type: "string" } } },
    outputSchema: { type: "object", properties: { content: { type: "string" } } }
  }
};
```

### UI 组件
- 连接器状态卡片
- 连接/断开按钮
- 能力列表展示
- 配置编辑弹窗

---

## 10. Real-Time Summary (Haiku)

### 设计理念
后台模型生成 15 秒摘要，让非技术用户也能跟进进度。

### 实现

```typescript
// src/lib/stores/summary-store.svelte
interface ResponseSummary {
  id: string;
  generatedAt: Date;
  summary: string;
  keyActions: string[];
  pendingDecisions: string[];
  confidence: number;  // 0-1
}

export class SummaryStore {
  private summaries = $state<Map<string, ResponseSummary>>(new Map());
  private generator: SummaryGenerator;
  
  async generateSummary(sessionId: string, events: BusEvent[]): Promise<ResponseSummary> {
    const summary = await this.generator.generate(events);
    this.summaries.set(sessionId, summary);
    return summary;
  }
  
  getSummary(sessionId: string): ResponseSummary | undefined {
    return this.summaries.get(sessionId);
  }
}

// 流式更新: 每个 turn 完成后触发摘要生成
```

---

## 实施优先级

### Phase 1: 高价值快速落地
1. **View Modes** - UI 改动小，用户感知价值高
2. **Dual-Signal Status** - 增强现有状态显示
3. **Prompt Validator** - 提升定时任务可靠性

### Phase 2: 核心功能增强
4. **Phase-Based Execution** - 完善 Workflow 功能
5. **Checkpoint Timeline** - 会话安全保护
6. **Context Visualization** - Token 消耗监控

### Phase 3: 个性化与智能化
7. **User Role System** - 个性化推荐
8. **Real-Time Summary** - 摘要生成
9. **Intervention Levels** - 权限分级

---

## 参考文件

- `src/lib/types/` - 类型定义目录
- `src/lib/stores/` - Svelte 5 响应式状态
- `src-tauri/src/agent/turn_engine.rs` - Turn 状态机
- `src/lib/components/workflow/` - Workflow 组件
- `src-tauri/src/scheduler/` - 定时任务后端

---

*本文档根据 Codex CLI、Claude Code Cowork、Cursor、Cline 等项目的设计模式分析生成*