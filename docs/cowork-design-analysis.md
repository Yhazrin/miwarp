# MiWarp × Cowork 设计对比与改进建议

> 基于 Claude Code Cowork 模式的学习与 MiWarp 落地建议

---

## 一、Cowork 核心设计模式总结

### 1. Skill 系统 (技能系统)

Cowork 的技能系统采用简洁的 SKILL.md 格式，特点如下：

- **自包含**: 每个 skill 包含完整指令，不依赖外部上下文
- **触发式调用**: 通过 `/name` 命令调用
- **结构化元数据**: 包含 `name`、`description`、`location`
- **分步骤引导**: 使用编号步骤引导用户完成复杂任务

示例结构：
```markdown
---
name: schedule
description: "创建或更新定时任务..."
---

# Schedule

## Step 1 — 分析会话
...

## Step 2 — 编写提示
...
```

### 2. Plugin 系统 (插件系统)

Cowork 的插件是 skills 的打包容器：

- **领域聚合**: 一个插件包含多个相关 skills
- **市场发现**: 通过 `search_plugins` 发现和安装
- **快速试用**: 安装后可直接点击 "Try it" 体验
- **Connector 集成**: 插件可关联外部工具（邮件、日历、文档等）

### 3. Scheduled Task (定时任务)

Cowork 的定时任务系统特点：

- **cron 表达式**: 本地时区的 5 字段 cron 格式
- **一次性触发**: `fireAt` 支持单次未来时刻
- **自包含提示**: 每次运行使用完整 prompt，无会话记忆
- **完成通知**: 可选的通知机制

### 4. Memory Consolidation (记忆整合)

Cowork 的记忆整合模式：

- **定期整理**: 主动合并重复、修复过时信息
- **分区索引**: 使用 MEMORY.md 作为入口
- **实用优先**: 保留难重推导的信息，删除易重查的内容
- **时间引用规范化**: 将相对时间转为绝对日期

### 5. Setup Wizard (引导设置)

Cowork 的设置向导采用分步引导：

- **角色选择**: 通过 UI 组件让用户选择工作角色
- **插件推荐**: 基于角色推荐匹配插件
- **技能试用**: 让用户亲自体验技能
- **Connector 连接**: 引导连接实际工具

---

## 二、MiWarp 现有能力评估

| 功能 | MiWarp 实现情况 | 对标 Cowork |
|------|----------------|------------|
| Skill 系统 | ✅ 有 `src/routes/skills` 和 `SkillStore` | 80% 覆盖 |
| Plugin 系统 | ✅ 有 `src/routes/plugins` 和插件市场 | 70% 覆盖 |
| Scheduled Tasks | ✅ 有完整的后端调度 + 前端管理 UI | 90% 覆盖 |
| Memory Store | ✅ 有 `memory-store.svelte.ts` | 60% 覆盖 |
| Multi-Agent | ✅ 有 `multi-agent-service.ts` | 85% 覆盖 |
| Setup Wizard | ✅ 有 `SetupWizard.svelte` | 50% 覆盖 |

---

## 三、具体改进建议

### P0 — 立即可实施

#### 1. 增强 Skill 的自包含性

**现状**: MiWarp 的 skill 依赖外部 store 和上下文
**改进**: 参考 Cowork 的 SKILL.md 格式，让 skill 提示完全自包含

建议新增: `src/lib/skills/skill-template.ts`
- 提供标准 skill 元数据接口
- 包含步骤引导和错误处理提示
- 支持 `{{cwd}}`、`{{agent}}` 等占位符

#### 2. 添加 Memory Consolidation 功能

**现状**: MiWarp 有 `memory-store.svelte.ts` 但无定期整合机制
**改进**: 添加 `consolidate-memory` skill，支持：
- 合并重复记忆
- 修复过时引用
- 保持索引精简（< 200 行）

建议新增: `src/lib/skills/consolidate-memory.ts`
- Phase 1: 盘点现有记忆文件
- Phase 2: 合并重叠、删除过时
- Phase 3: 更新索引

#### 3. 增强 Setup Wizard 交互性

**现状**: MiWarp 的 setup 是单页表单
**改进**: 改为分步向导，类似 Cowork：
1. 角色选择 → 推荐插件
2. 插件安装 → 试用技能
3. Connector 连接 → 完成

建议改进: `src/lib/components/SetupWizard.svelte`
- 添加步骤进度指示
- 集成插件市场推荐
- 添加技能试用环节

### P1 — 短期优化

#### 4. 提升 Skill 执行器的健壮性

**现状**: `skill-executor.ts` 相对简单
**改进**: 参考 Cowork 的 skill 执行模式：
- 完整的状态管理（idle → running → completed/failed）
- 详细的执行日志
- 支持中断和重试

#### 5. 增强 Scheduled Task 的 Skill 集成

**现状**: Scheduled Task 使用独立 prompt
**改进**: 支持从 Skill 模板创建任务：
- 选择 skill → 自动填充 prompt
- 支持参数化（`{{date}}`、`{{project}}`）
- Skill 市场直接创建定时任务

建议改进: `src/lib/services/scheduled-tasks-service.ts`
- 添加 createFromSkill() 方法
- 支持参数模板解析

#### 6. 增强 Multi-Agent 与 Skill 的协同

**现状**: Multi-agent 有 presets 但不能使用 Skills
**改进**: Multi-agent 配置可引用 Skills：
- 选择多个 Skills 并行执行
- Skills 共享上下文
- 结果聚合输出

建议改进: `src/lib/services/multi-agent-service.ts`
- 添加 useSkills() 配置选项
- 支持 skill 间的上下文传递

### P2 — 中期增强

#### 7. 添加 Plugin 的快速试用机制

**现状**: 安装插件后需要手动探索
**改进**: 插件安装后显示 "Try it" 按钮：
- 点击直接进入 skill 引导
- 示例输入预填充
- 结果预览

#### 8. 增强 Context Usage 可视化

**现状**: MiWarp 有 `ContextUsageGrid.svelte` 但较基础
**改进**: 参考 Claude Code 的彩色比例条：
- 分段着色：系统 / 环境 / CLAUDE.md / 文件 / 工具输出
- 实时刷新
- 溢出警告

建议改进: `src/lib/components/ContextUsageGrid.svelte`
- 添加分段着色
- 集成到 SessionStatusBar
- 添加 token 计数

#### 9. 添加转录视图模式切换

**现状**: 工具调用显示方式固定
**改进**: 添加三种密度模式：
- 普通：工具折叠为摘要
- 详细：每个步骤展开
- 摘要：仅最终响应

建议新增: `src/lib/stores/view-mode-store.svelte.ts` (已存在)
- 完善三种模式的切换逻辑
- 集成到 ToolActivity 组件

### P3 — 长期愿景

#### 10. 云端 Agent 支持（参考 Cursor）

- 远程 agent 产出截图/视频/日志
- Web / Desktop / API 多入口
- 制品交付与验收

#### 11. Flow 感知（参考 Windsurf）

- 从隐式信号推断用户意图
- 主动建议下一步操作
- 上下文预测

---

## 四、实施优先级建议

优先级 | 改进项 | 工作量 | 用户感知
------- | ------ | ------ | --------
P0 | 增强 Skill 自包含性 | 小 | 高
P0 | 添加 Memory Consolidation | 中 | 中
P0 | 增强 Setup Wizard | 中 | 高
P1 | 提升 Skill 执行器健壮性 | 小 | 中
P1 | Task ↔ Skill 集成 | 中 | 高
P1 | Multi-Agent ↔ Skill 协同 | 中 | 高
P2 | Plugin 快速试用 | 小 | 高
P2 | Context 可视化增强 | 中 | 中
P2 | 转录视图模式 | 小 | 高

---

## 五、总结

MiWarp 的核心架构已经相当完善，与 Cowork 在设计理念上有很多共鸣。主要差距在于：

1. **Skill 的自包含性**：Cowork 的 skill 是完全独立的提示单元，MiWarp 可以借鉴
2. **Setup Wizard 的引导性**：分步引导比单页表单用户体验更好
3. **记忆整合机制**：主动整理比被动累积更有价值
4. **技能间的协同**：Skill ↔ Scheduled Task ↔ Multi-Agent 的深度集成

这些改进可以逐步推进，不需要大规模重构。核心是在现有架构上增强模块间的协作和数据流的整合。
