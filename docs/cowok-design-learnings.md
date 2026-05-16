# Codex Claude Cowok 设计学习心得

> 学习时间: 2026-05-16

## 核心设计理念

### 1. 技能系统 (Skills)

**Cowok 的技能设计非常精妙:**

```typescript
// Skill 结构设计
interface Skill {
  name: string;           // 技能名称，作为触发词
  description: string;    // 描述，用于在工具列表中显示
  trigger?: string[];     // 替代触发词
  icon?: string;          // 图标
  author?: string;        // 作者信息
}
```

**SKILL.md 格式标准:**
```markdown
---
name: skill-name
description: One-line description
trigger: [alternate, triggers]
icon: 🎯
---

# 详细文档
```

**启发 MiWarp 的改进:**
- 当前 MiWarp 的 skill 类型过于复杂，可以简化为与 Cowok 一致的结构
- skill 的执行应该更加轻量级，避免不必要的元数据传递
- 支持 skill 之间的组合和管道执行（当前已有 skill-pipeline.ts，可以增强）

### 2. 定时任务 (Scheduled Tasks)

**Cowok 的定时任务设计优势:**

| 特性 | Cowok | MiWarp 当前 |
|------|-------|-----------|
| cron 表达式 | 标准 5 字段，本地时区 | ✅ 已支持 |
| one-time 执行 | ✅ ISO 8601 时间戳 | ✅ 已支持 |
| 自动禁用 | 一次性任务执行后自动禁用 | ❌ 需要实现 |
| 任务模板 | 提供预设模板 | ⚠️ 基础模板 |
| 通知机制 | ✅ 支持完成通知 | ❌ 需要实现 |

**需要落地到 MiWarp:**
1. 一次性任务执行后自动禁用
2. 添加任务完成时的通知机制
3. 增强任务模板，添加更多预设

### 3. 状态管理 (Svelte 5 Runes)

**Cowok 的 store 设计模式:**

```typescript
// 使用 $state 和 $derived 响应式设计
class SkillStore {
  skills = $state<Skill[]>([]);
  loading = $state(false);
  error = $state<string | null>(null);
  
  // 派生状态
  filteredSkills = $derived.by(() => {
    // 复杂的派生逻辑
  });
}
```

**MiWarp 已采用的模式:**
- ✅ workflow-store.svelte.ts 使用相同模式
- ✅ skill-store.svelte.ts 使用相同模式  
- ✅ scheduled-tasks-store.svelte.ts 使用相同模式

### 4. 文件操作设计

**Cowork 文件访问模式:**
- 用户选择文件夹 → 挂载到 VM → 在 VM 中操作
- 使用 `computer://` 链接提供直接访问

**MiWarp 的类似设计:**
- 当前使用 Tauri 的文件系统 API
- 可以考虑引入类似的 `computer://` 链接机制
- 路径映射: `/sessions/quirky-eager-johnson/mnt/miwarp/` → `computer:///Users/yanghaoze/Desktop/PROJECT/miwarp/`

### 5. 工具分类与组织

**Cowok 工具分类:**
- productivity (⚡)
- development (🔧)
- automation (🤖)
- memory (🧠)
- organization (📁)
- integrations (🔗)
- custom (✨)

**MiWarp 已有类似分类** - 可以保持一致

### 6. MCP (Model Context Protocol) 集成

**Cowok 的 MCP 设计:**
- 作为工具扩展机制
- 可选依赖，有 fallback 消息
- 工具级别的权限控制

**MiWarp 已有的 MCP 支持:**
- McpDiscoverPanel.svelte - MCP 发现
- McpStatusPanel.svelte - MCP 状态
- McpConfiguredPanel.svelte - 已配置 MCP
- 可以增强 MCP 工具的可见性和使用体验

## 具体落地建议

### 高优先级

1. **定时任务自动禁用**
   ```rust
   // 在 Rust scheduler 中实现
   if schedule.type == "one-time" && executed {
       task.enabled = false;
   }
   ```

2. **任务完成通知**
   ```typescript
   interface ScheduledTaskConfig {
     notifyOnCompletion: boolean;  // 新增字段
   }
   ```

3. **Skill 执行结果反馈**
   - 当前 skill 执行完成后缺乏可视化反馈
   - 建议添加执行结果卡片，类似 InlineToolCard

### 中优先级

4. **Skill 模板系统**
   - 预设常用 skill 模板
   - 支持从模板快速创建

5. **技能组合管道**
   - 增强 skill-pipeline.ts 的功能
   - 支持并行执行和条件分支

6. **computer:// 链接支持**
   - 在 UI 中渲染可点击的文件链接
   - 跨平台路径解析

### 低优先级

7. **记忆系统增强**
   - consolidate-memory 技能的完整实现
   - 记忆文件自动整理和去重

8. **团队协作功能**
   - 团队仪表盘 - MiWarp 已有基础
   - 可以增强消息和任务同步

## 与 MiWarp 的协同

### 现有的优势
- ✅ Svelte 5 响应式系统 (与 Cowok 一致)
- ✅ 完善的定时任务后端 (Rust)
- ✅ 丰富的 UI 组件库 (90+ 组件)
- ✅ 多供应商支持 (15+ API)

### 可以借鉴的
1. **更轻量的 Skill 定义** - 简化 skill 类型，减少模板代码
2. **Skill 市场 UI** - 增强 SkillMarketplace 组件
3. **工作流编辑器** - WorkflowPanel 可以借鉴 skill 的编辑器设计

## 总结

Cowok 的设计核心是 **简单、务实、可组合**:
- 技能系统足够轻量，可以快速创建和使用
- 定时任务足够可靠，可以放心托管后台任务
- 状态管理足够现代，可以优雅处理复杂 UI

MiWarp 作为一个更复杂的产品，已经有了很多超越 Cowok 的功能（如多供应商、团队协作等），主要需要做的是:
1. 精简内部实现，保持与 Cowok 一致的设计简洁性
2. 增强用户体验，借鉴 Cowok 的交互设计
3. 完善后台任务机制，确保可靠性