# Codex Claude Cowork 设计模式学习与落地建议

## 一、概述

本次分析对比了 Codex Claude Cowork 的设计模式与 MiWarp 现有实现，旨在识别可借鉴的设计理念并提出落地建议。

---

## 二、Codex Claude Cowork 核心设计模式

### 1. 多步骤引导模式 (Step-by-Step Wizard)

**来源**: `setup-cowork` skill

**设计特点**:
- 清晰的步骤编号（Step 1、Step 2...）
- 每步聚焦单一任务
- 支持跳过（"Skips are fine"）
- 用户主动确认后才进入下一步
- 短消息原则（2-3 句话 + widget）

**关键原则**:
```
- One step at a time
- Skips are fine
- Keep each message short
- Two or three sentences plus the widget
```

**落地建议**:
- 在 MiWarp 中创建 `guided-wizard` 组件库
- 支持步骤状态持久化（可中途退出恢复）
- 增加跳过/返回导航

### 2. 角色引导系统 (Role-based Onboarding)

**来源**: `setup-cowork` Step 1

**设计特点**:
- 首次使用收集用户角色
- 根据角色推荐插件和技能
- 提供个性化起点

**落地建议**:
- 新增 `RolePicker` 组件
- 在 `~/.miwarp/settings.json` 中存储用户角色
- 基于角色过滤技能市场（类似 `plugin suggestions`）

### 3. 相位处理模式 (Phase-based Processing)

**来源**: `consolidate-memory` skill

**设计特点**:
- Phase 1: Take stock（盘点现有资源）
- Phase 2: Consolidate（整理合并）
- Phase 3: Tidy the index（清理索引）
- 每个 Phase 有明确的输入输出

**关键洞察**:
```
- Separate the durable from the dated
- Merge overlaps
- Fix time references
- Drop what's easy to re-find
```

**落地建议**:
- 在 MiWarp 中实现 `MemoryConsolidator` 服务
- 支持增量处理（可中断恢复）
- 提供 dry-run 预览模式

### 4. 自包含 Prompt 设计 (Self-contained Prompt)

**来源**: `schedule` skill

**设计特点**:
- Future runs will NOT have access to this session
- 禁止引用 "current conversation", "the above"
- 所有上下文必须内嵌在 prompt 中
- 支持 cron 表达式本地时区解析

**技术细节**:
```yaml
cronExpression: 评估在用户 LOCAL 时区，非 UTC
fireAt: ISO 8601 带时区偏移，拒绝 cron 做一次性任务
```

**落地建议**:
- 在 SkillEditor 中增加 "Self-contained" 校验
- 提供 prompt 自包含性检测工具
- 本地时区 cron 解析器

### 5. 插件-技能集成架构

**来源**: `setup-cowork` Step 2-3

**设计特点**:
- Plugin 捆绑多个 Skills
- Role 驱动插件发现
- Skills 通过 `/name` 触发
- 技能执行后可返回父流程

**MiWarp 现有对应**:
- `src-tauri/src/storage/plugins.rs` 已支持插件发现
- `src/lib/stores/skill-store.svelte.ts` 已实现技能存储
- 差距：缺少基于 Role 的推荐逻辑

**落地建议**:
- 扩展 `plugins.rs` 增加 `search_plugins_by_role(role)` 函数
- 实现插件评分算法（匹配度 + 安装量）
- 提供 "Try it" 按钮的 UI 模式

### 6. 连接器注册系统 (Connector Registry)

**来源**: `setup-cowork` Step 4

**设计特点**:
- 连接器是具体工具（邮件、日历、文档）
- 技能通过连接器获取真实上下文
- 支持按角色搜索连接器

**落地建议**:
- 新增 `ConnectorRegistry` 模型
- 定义标准连接器接口（OAuth、API key 等）
- 实现连接器发现与授权流程

---

## 三、MiWarp 当前实现评估

### 已具备的能力 ✅

| 功能 | 位置 | 评估 |
|------|------|------|
| 技能 CRUD | `src/lib/stores/skill-store.svelte.ts` | 基础完善 |
| 插件发现 | `src-tauri/src/storage/plugins.rs` | 较完整 |
| 定时任务 | `/scheduled-tasks` 页面 | 基础 UI 完成 |
| 前置元数据 | SKILL.md frontmatter | 格式支持 |

### 需要增强的领域 🔧

| 功能 | 优先级 | 说明 |
|------|--------|------|
| 自包含 Prompt 校验 | 高 | 防止技能运行时丢失上下文 |
| 多步骤向导组件 | 高 | 支持复杂引导流程 |
| 角色系统 | 中 | 支持个性化推荐 |
| 连接器注册 | 中 | 扩展工具集成 |
| 记忆整理服务 | 中 | 自动化记忆管理 |

---

## 四、具体实现建议

### 4.1 增强 Skill Executor

**文件**: `src/lib/services/skill-executor.ts`

**新增功能**:
```typescript
// 1. 自包含性检测
validateSelfContained(skill: Skill): ValidationResult

// 2. 步骤状态管理
interface WizardStep {
  id: string;
  title: string;
  completed: boolean;
  data: Record<string, any>;
}

// 3. 技能执行上下文注入
injectContext(skill: Skill, context: ExecutionContext): Skill
```

### 4.2 新增组件

**WizardFlow 组件**:
```svelte
<!-- src/lib/components/WizardFlow.svelte -->
<script lang="ts">
  interface WizardStep {
    id: string;
    title: string;
    component: Component;
    canSkip?: boolean;
  }
  
  let { steps, initialStep = 0 }: Props;
  let currentStep = $state(initialStep);
  let stepData = $state<Record<string, any>>({});
</script>
```

**RolePicker 组件**:
```svelte
<!-- src/lib/components/RolePicker.svelte -->
<script lang="ts">
  const roles = [
    { id: 'developer', name: 'Developer', icon: '💻' },
    { id: 'designer', name: 'Designer', icon: '🎨' },
    // ...
  ];
</script>
```

### 4.3 新增 Storage 模块

**文件**: `src-tauri/src/storage/connectors.rs`

```rust
pub struct Connector {
    pub id: String,
    pub name: String,
    pub type: ConnectorType,
    pub auth_method: AuthMethod,
    pub config: serde_json::Value,
}

pub fn list_connectors_by_role(role: &str) -> Vec<Connector> { ... }
pub fn authorize_connector(id: &str) -> Result<(), String> { ... }
```

### 4.4 增强 Cron 解析

**文件**: `src-tauri/src/utils/cron.rs`

```rust
// 支持本地时区的 Cron 解析
pub fn parse_local_cron(expr: &str, timezone: &TimeZone) -> CronSchedule { ... }

// 一次性任务（不使用 cron）
pub fn parse_fire_at(iso: &str) -> DateTime { ... }
```

---

## 五、建议实施路线

### Phase 1: 基础增强（1-2 周）
1. 实现 Skill 自包含性校验
2. 添加 WizardFlow 基础组件
3. 增强 Cron 解析（本地时区支持）

### Phase 2: 角色系统（2-3 周）
1. 新增 RolePicker 组件
2. 实现基于 Role 的技能推荐
3. 用户角色持久化存储

### Phase 3: 连接器集成（3-4 周）
1. 定义 Connector 接口规范
2. 实现基础连接器注册表
3. OAuth/API Key 授权流程

### Phase 4: 高级功能（4-6 周）
1. Memory Consolidator 服务
2. 插件推荐算法
3. 技能执行上下文注入

---

## 六、附录

### A. Codex Skill 文件格式参考

```markdown
---
name: {skill-name}
description: "{一句话描述}"
---

# Skill Title

## Phase 1 — {阶段名称}
- 具体任务 1
- 具体任务 2

## Phase 2 — {阶段名称}
- 具体任务...
```

### B. MiWarp 当前 Frontmatter 格式

```markdown
---
name: {skill-name}
description: "{一句话描述}"
category: {category}
icon: {emoji}
---
```

### C. 建议的统一格式

```markdown
---
name: {skill-name}
description: "{一句话描述}"
category: {category}
icon: {emoji}
author: {optional}
tags: [{optional}]
phases:
  - id: phase-1
    title: "{阶段标题}"
    description: "{阶段描述}"
---
```

---

*报告生成时间: 2026-05-14*