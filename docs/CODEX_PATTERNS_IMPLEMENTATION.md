# Codex Claude Cowork 设计模式落地报告

**生成日期**: 2026-05-20  
**来源**: Codex Claude Cowork 与 MiWarp 对比分析

---

## 一、核心发现

MiWarp 已经实现了 Claude Code 的大部分核心设计模式，特别是在：
- Transport 通信抽象 ✅
- Event 处理与微批处理 ✅
- Command Palette 模糊搜索 ✅
- Keybinding 管理 ✅
- Session 状态机 ✅

以下是基于 Codex Claude Cowork 的设计模式，针对 MiWarp 的具体落地建议。

---

## 二、High-Priority 落地建议

### 2.1 多步骤向导组件 (WizardFlow)

**来源**: `setup-cowork` skill 的步骤引导模式

Codex 的关键原则：
- One step at a time
- Skips are fine
- Keep each message short (2-3 sentences + widget)

**实现文件**: `src/lib/components/WizardFlow.svelte`

```svelte
<script lang="ts">
  interface WizardStep {
    id: string;
    title: string;
    description: string;
    component: Component;
    canSkip?: boolean;
    validation?: () => boolean;
  }

  let { 
    steps, 
    initialStep = 0,
    onComplete,
    onSkip 
  }: Props;

  let currentStep = $state(initialStep);
  let stepData = $state<Record<string, any>>({});
  let completed = $state(new Set<string>());

  const current = $derived(steps[currentStep]);
  const progress = $derived((currentStep / steps.length) * 100);
</script>
```

**使用场景**:
- 新用户引导流程
- 插件安装向导
- 技能创建流程

---

### 2.2 Phase-based Processing 模式

**来源**: `consolidate-memory` skill 的阶段性处理

```
Phase 1: Take stock（盘点现有资源）
Phase 2: Consolidate（整理合并）
Phase 3: Tidy the index（清理索引）
```

**实现建议**: 在 `src/lib/services/` 下新增 `PhaseProcessor.ts`

```typescript
export interface Phase {
  id: string;
  name: string;
  description: string;
  execute: (ctx: PhaseContext) => Promise<PhaseResult>;
  dryRun?: boolean;
}

export class PhaseProcessor {
  private phases: Phase[];
  private currentIndex = 0;

  async run(ctx: PhaseContext, options?: { dryRun?: boolean }): Promise<PhaseResult[]> {
    const results: PhaseResult[] = [];
    
    for (let i = 0; i < this.phases.length; i++) {
      this.currentIndex = i;
      const phase = this.phases[i];
      
      if (options?.dryRun && phase.dryRun) {
        results.push(await phase.dryRun(ctx));
      } else {
        results.push(await phase.execute(ctx));
      }
      
      // Check for abort signal
      if (ctx.abort) break;
    }
    
    return results;
  }

  canResume(): boolean {
    return this.currentIndex < this.phases.length;
  }
}
```

**应用场景**:
- 记忆整理服务（MemoryConsolidator）
- 插件批量安装
- 定时任务执行

---

### 2.3 Skill 自包含性校验

**来源**: `schedule` skill 的设计原则

Codex 关键要求：
```
Future runs will NOT have access to this session
禁止引用 "current conversation", "the above"
所有上下文必须内嵌在 prompt 中
```

**实现文件**: `src/lib/utils/skill-validator.ts`

```typescript
import type { Skill } from "$lib/stores/skill-store.svelte";

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  code: string;
  message: string;
  location?: string;
}

export function validateSelfContained(skill: Skill): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  
  // Check for forbidden references
  const forbiddenPatterns = [
    /current conversation/i,
    /the above/i,
    /previous message/i,
    /as mentioned earlier/i,
    /from the context/i,
  ];
  
  for (const pattern of forbiddenPatterns) {
    if (pattern.test(skill.prompt)) {
      errors.push({
        code: "FORBIDDEN_REFERENCE",
        message: `Skill prompt contains forbidden reference: "${pattern.source}"`,
      });
    }
  }
  
  // Check for required context variables
  const requiredFields = ["taskId", "description"];
  for (const field of requiredFields) {
    if (!skill.frontmatter[field]) {
      errors.push({
        code: "MISSING_FIELD",
        message: `Skill frontmatter missing required field: ${field}`,
      });
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
```

---

### 2.4 角色引导系统 (Role-based Onboarding)

**来源**: `setup-cowork` Step 1

```typescript
const roles = [
  { id: 'developer', name: 'Developer', icon: '💻', keywords: ['code', 'debug', 'refactor'] },
  { id: 'designer', name: 'Designer', icon: '🎨', keywords: ['ui', 'css', 'design'] },
  { id: 'devops', name: 'DevOps', icon: '🔧', keywords: ['deploy', 'ci', 'docker'] },
  { id: 'manager', name: 'Manager', icon: '📊', keywords: ['report', 'analytics'] },
];
```

**实现文件**: `src/lib/components/RolePicker.svelte`

```svelte
<script lang="ts">
  import { getContext } from "svelte";
  
  interface Role {
    id: string;
    name: string;
    icon: string;
    description: string;
    suggestedSkills: string[];
    suggestedPlugins: string[];
  }

  let { onSelect }: Props;
  let selected = $state<string | null>(null);

  const roles: Role[] = [/* ... */];
</script>

<div class="role-picker">
  {#each roles as role}
    <button 
      class="role-card"
      class:selected={selected === role.id}
      onclick={() => { selected = role.id; onSelect(role); }}
    >
      <span class="icon">{role.icon}</span>
      <span class="name">{role.name}</span>
      <span class="desc">{role.description}</span>
    </button>
  {/each}
</div>
```

---

### 2.5 Connector 注册系统

**来源**: `setup-cowork` Step 4

**Rust 实现**: `src-tauri/src/storage/connectors.rs`

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Connector {
    pub id: String,
    pub name: String,
    pub connector_type: ConnectorType,
    pub auth_method: AuthMethod,
    pub config: serde_json::Value,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ConnectorType {
    Email,
    Calendar,
    Documents,
    Slack,
    GitHub,
    Custom(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AuthMethod {
    ApiKey(String),
    OAuth { client_id: String, scopes: Vec<String> },
    Bearer(String),
}

pub fn list_connectors_by_role(role: &str) -> Vec<Connector> {
    // 基于角色过滤可用连接器
}

pub fn authorize_connector(id: &str, auth: AuthMethod) -> Result<(), String> {
    // 处理连接器授权
}
```

**前端实现**: `src/lib/stores/connector-store.svelte.ts`

```typescript
export class ConnectorStore {
  connectors = $state<Connector[]>([]);
  
  async authorize(id: string, auth: AuthMethod): Promise<void> {
    await api.call("connectors_authorize", { id, auth });
  }
  
  filteredByRole(role: string): Connector[] {
    return this.connectors.filter(c => c.roles?.includes(role));
  }
}
```

---

### 2.6 Cron 本地时区支持增强

**来源**: `schedule` skill

Codex 强调：
```
cronExpression: 评估在用户 LOCAL 时区，非 UTC
fireAt: ISO 8601 带时区偏移，拒绝 cron 做一次性任务
```

**实现文件**: `src-tauri/src/utils/cron.rs`

```rust
use chrono::{Local, NaiveDateTime};

pub struct CronSchedule {
    pub minute: u8,
    pub hour: u8,
    pub day_of_month: Option<u8>,
    pub month: Option<u8>,
    pub day_of_week: Option<u8>,
}

impl CronSchedule {
    /// Parse cron expression in LOCAL timezone
    pub fn parse_local(expr: &str) -> Result<Self, String> {
        // Implementation
    }
    
    /// Describe cron in human-readable format
    pub fn describe(&self) -> String {
        match (self.day_of_week, self.hour, self.minute) {
            (Some(dow), hour, 0) if dow >= 1 && dow <= 5 => {
                format!("Weekdays at {}:00", hour)
            }
            (_, hour, 0) => format!("Daily at {}:00", hour),
            _ => format!("At {}:{:02}", self.hour, self.minute),
        }
    }
}

/// Parse one-time fireAt (ISO 8601 with timezone offset)
pub fn parse_fire_at(iso: &str) -> Result<DateTime<Local>, String> {
    // Implementation
}
```

---

## 三、Medium-Priority 增强

### 3.1 Command Palette 增强

基于 Codex 的设计，在现有基础上增强：

```typescript
// 新增：快速操作分类
interface CommandCategory {
  id: string;
  name: string;
  icon: string;
  commands: Command[];
}

// 新增：使用频率跟踪
interface CommandUsage {
  commandId: string;
  lastUsed: Date;
  useCount: number;
  score: number; // 用于排序
}
```

### 3.2 Skill Frontmatter 扩展

建议扩展 MiWarp 的 SKILL.md 格式：

```markdown
---
name: skill-name
description: 一句话描述
category: category-name
icon: emoji
author: author-name
tags: [tag1, tag2]
phases:  # 来自 Codex 的启发
  - id: phase-1
    title: 阶段标题
    description: 阶段描述
  - id: phase-2
    title: 阶段标题
    description: 阶段描述
---
```

---

## 四、实施路线图

### Phase 1: 基础增强（1 周）

1. ✅ 实现 Skill 自包含性校验 (`skill-validator.ts`)
2. ✅ 添加 WizardFlow 基础组件
3. ✅ 增强 Cron 解析（本地时区支持）

### Phase 2: 角色系统（2 周）

1. ✅ 新增 RolePicker 组件
2. ✅ 实现基于 Role 的技能推荐
3. ✅ 用户角色持久化存储

### Phase 3: 连接器集成（2-3 周）

1. ✅ 定义 Connector 接口规范
2. ✅ 实现基础连接器注册表
3. ✅ OAuth/API Key 授权流程

---

## 五、关键文件位置

| 功能 | 文件路径 |
|------|----------|
| Session 状态机 | `src/lib/stores/types.ts` |
| Skill Store | `src/lib/stores/skill-store.svelte.ts` |
| Event Middleware | `src/lib/stores/event-middleware.ts` |
| Command Palette | `src/lib/components/CommandPalette.svelte` |
| Fuzzy 搜索 | `src/lib/utils/fuzzy.ts` |
| 定时任务 | `src-tauri/src/scheduler/` |

---

## 六、总结

MiWarp 的架构设计已经相当成熟，借鉴了 Claude Code 的多个核心模式。基于 Codex Claude Cowork 的分析，建议优先实现：

1. **WizardFlow 组件** - 提升引导流程体验
2. **Skill 自包含性校验** - 保障定时任务可靠性
3. **PhaseProcessor** - 支持复杂多阶段任务
4. **Role 系统** - 个性化用户体验

这些增强将进一步提升 MiWarp 的专业性和用户体验。

---

*报告生成时间: 2026-05-20*