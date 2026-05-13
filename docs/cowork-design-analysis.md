# Codex Claude Cowork 设计分析报告

**日期**: 2026-05-13
**项目**: MiWarp vs Codex Claude Cowork 功能对比与设计借鉴

---

## 一、整体架构对比

### Codex Claude Cowork 核心设计
Codex Claude Cowork 是一个基于 Claude Code 的桌面应用，专注于：
- **Skill 系统**: 可扩展的任务/技能定义，使用 Markdown + YAML frontmatter
- **MCP (Model Context Protocol)**: 插件化的工具和连接器
- **Scheduled Tasks**: 基于 cron 的自动化任务
- **Memory Consolidation**: 内存文件整合与去重
- **Plugin Marketplace**: 插件和技能的市场

### MiWarp 核心设计
MiWarp 是一个本地优先的 AI 辅助编程桌面应用：
- **Agent 通信层**: 支持 Claude Code 和 Codex CLI
- **可视化工具卡片**: 渲染工具调用为内联卡片
- **多 Provider 支持**: 15+ API 平台
- **Session 管理**: 历史记录、回放、恢复

---

## 二、已实现的相似功能

MiWarp 已经实现了 Codex Claude Cowork 的许多核心设计：

| 功能 | Codex Cowork | MiWarp | 状态 |
|------|-------------|--------|------|
| Skill 定义格式 | YAML frontmatter + Markdown | ✅ 相同格式 | ✅ 已实现 |
| Schedule Task | Cron/ISO timestamp | ✅ 完整支持 | ✅ 已实现 |
| Consolidate Memory | 去重、固定、索引 | ✅ 完整支持 | ✅ 已实现 |
| Setup Wizard | 引导式初始化 | ✅ 完整支持 | ✅ 已实现 |
| Plugin Store | 插件市场 | ✅ 完整支持 | ✅ 已实现 |
| MCP 管理 | MCP 服务器管理 | ✅ 完整支持 | ✅ 已实现 |

---

## 三、Codex Cowork 值得借鉴的设计模式

### 3.1 Skill 系统的 Handler 模式

**Codex 实现**:
```typescript
export interface SkillHandler {
  name: string;
  canHandle: (skill: Skill, args: string) => boolean;
  execute: (skill: Skill, args: string) => Promise<ExecutionResult>;
}
```

**借鉴价值**: MiWarp 可以将硬编码的 handler (schedule, consolidate-memory, setup-cowork) 改为可插拔的插件架构。

**落地建议**:
1. 在 `src/lib/services/skill-executor.ts` 中添加 `registerHandler` 的持久化
2. 支持从插件动态加载 handler
3. 允许用户定义自定义 handler

### 3.2 Memory Consolidation 的智能合并策略

**Codex 实现要点**:
- 基于 label 的文件分组
- 内容相似度检测 (>100 字符才值得合并)
- 备份机制
- 详细的合并报告

**MiWarp 当前实现** (`memory-store.svelte.ts`):
- 基础的重复文件检测
- 缺少内容级别的合并逻辑

**落地建议**:
```typescript
// 增强 consolidateMemory 方法
interface ConsolidationResult {
  duplicatesMerged: number;
  staleEntriesRemoved: number;
  indexUpdated: boolean;
  errors: string[];
  backupCreated: boolean;
  mergedFiles: Array<{
    source: string;
    target: string;
    sizeBefore: number;
    sizeAfter: number;
  }>;
}
```

### 3.3 统一的任务执行状态追踪

**Codex 实现**:
```typescript
interface SkillExecution {
  id: string;
  skillId: string;
  status: ExecutionStatus;
  startedAt: string;
  completedAt?: string;
  result?: string;
  error?: string;
  sessionId?: string;
}
```

**MiWarp 当前实现**: 有相似结构，但执行历史没有持久化。

**落地建议**:
1. 在 `~/.miwarp/executions/` 目录持久化执行历史
2. 添加执行统计和趋势分析
3. 支持执行结果导出

### 3.4 Plugin 搜索与安装的 UX

**Codex 实现**:
- 基于 capabilities 的插件发现
- Skills/Commands/Connectors 三维度匹配
- 一键安装和试用

**MiWarp 当前实现**: 已有插件市场组件 (`plugin-marketplace.ts`)

**落地建议**:
1. 添加基于上下文的插件推荐 (根据当前项目类型)
2. 插件使用统计和评分
3. 插件依赖解析

---

## 四、Codex Cowork 独特设计值得引入

### 4.1 反射式 Memory 整合

Codex 的 `consolidate-memory` skill 强调:
- **Merge Duplicates**: 合并重复内容
- **Fix Stale Facts**: 更新过时信息
- **Prune Index**: 清理索引

**落地建议**:
```typescript
// 新增 memory-consolidation.service.ts
export interface MemoryConsolidationConfig {
  similarityThreshold: number;  // 相似度阈值 (0-1)
  minContentLength: number;     // 最小内容长度
  createBackup: boolean;        // 是否创建备份
  updateReferences: boolean;    // 是否更新引用
}

// 新增前端组件
// - ConsolidationWizard.svelte: 分步引导
// - ConsolidationPreview.svelte: 预览变更
// - ConsolidationReport.svelte: 详细报告
```

### 4.2 MCP Server 状态管理与重连

**落地建议**:
```typescript
// 增强 MCP 管理
interface MCPConnectionState {
  serverId: string;
  status: 'connected' | 'disconnected' | 'error' | 'reconnecting';
  lastError?: string;
  reconnectAttempts: number;
  autoReconnect: boolean;
}

// 添加自动重连逻辑
```

### 4.3 Setup Wizard 的模块化

**落地建议**:
```typescript
// 将 setup 拆分为独立模块
interface SetupStep {
  id: string;
  title: string;
  description: string;
  component: Component;
  validate: () => Promise<boolean>;
  skip?: boolean;
}

// 支持从任何步骤继续
```

---

## 五、具体的落地建议清单

### 5.1 高优先级 (可在当前版本实现)

1. **Skill Handler 插件化**
   - 文件: `src/lib/services/skill-executor.ts`
   - 改动: 添加动态 handler 注册机制

2. **Memory Consolidation 增强**
   - 文件: `src/lib/stores/memory-store.svelte.ts`, `src/lib/services/memory-service.ts`
   - 改动: 添加内容级合并、备份、详细报告

3. **执行历史持久化**
   - 文件: `src/lib/stores/skill-store.svelte.ts`
   - 改动: 添加执行日志落盘

### 5.2 中优先级 (需要较大改动)

4. **上下文感知的插件推荐**
   - 文件: `src/lib/services/plugin-marketplace.ts`
   - 改动: 添加基于项目上下文的推荐算法

5. **MCP 连接状态监控**
   - 文件: 新增 `src/lib/services/mcp-monitor.ts`
   - 改动: 添加自动重连、状态可视化

### 5.3 低优先级 (未来规划)

6. **Skill 市场国际化**
7. **团队协作功能** (参考 Codex 的 team 功能)
8. **A/B Testing 框架**

---

## 六、技术债务与改进

### 6.1 类型定义统一
当前存在类型分散在多个文件，建议:
- `src/lib/types/` 统一管理所有类型
- 移除 `skill-store.svelte.ts` 中的内联类型

### 6.2 Store 模式规范化
当前每个 store 独立实现，建议:
- 统一使用 `$state` rune
- 统一的错误处理模式
- 统一的加载状态管理

### 6.3 测试覆盖
- `memory-service.ts`: 已有部分测试
- `skill-executor.ts`: 需要添加单元测试
- `scheduled-tasks-service.ts`: 需要添加集成测试

---

## 七、结论

MiWarp 已经实现了 Codex Claude Cowork 的核心功能集，这是一个很好的基础。主要的改进方向是:

1. **深化现有功能**: Memory consolidation、Skill handler 可扩展性
2. **提升 UX**: 更详细的报告、更智能的推荐
3. **增强稳定性**: 执行历史持久化、MCP 状态管理
4. **技术债务**: 类型统一、测试覆盖

这些改进不需要大的架构调整，可以在当前框架内逐步迭代。

---

## 附录: 相关文件路径

| 文件 | 用途 |
|------|------|
| `src/lib/stores/skill-store.svelte.ts` | Skill 状态管理 |
| `src/lib/stores/memory-store.svelte.ts` | Memory 状态管理 |
| `src/lib/stores/scheduled-tasks-store.svelte.ts` | 定时任务状态管理 |
| `src/lib/services/skill-executor.ts` | Skill 执行器 |
| `src/lib/services/memory-service.ts` | Memory 服务 |
| `src/lib/services/plugin-marketplace.ts` | 插件市场 |
| `src/lib/services/scheduled-tasks-service.ts` | 定时任务服务 |
| `src/lib/types/skill.ts` | Skill 类型定义 |
| `src/lib/types/scheduled-task.ts` | 定时任务类型定义 |