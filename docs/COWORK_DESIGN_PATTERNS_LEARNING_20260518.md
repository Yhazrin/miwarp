# Codex Claude Cowork 设计模式学习报告

**日期**: 2026-05-18
**来源**: Codex CLI Cowork + MiWarp 代码库分析

---

## 一、核心设计理念

Codex Claude Cowork 遵循 **"简单、务实、可组合"** 的设计原则，强调用户体验的渐进性和容错性。

---

## 二、关键设计模式及 MiWarp 落地建议

### 1. 分阶段工作流 (Phase-based Workflow)

**Codex 模式**:
- 每个阶段专注于单一任务，用户可跳过
- 保持每步信息简短（2-3 句 + 组件）
- 用户确认后再进入下一步

**落地建议**:
```typescript
// 新增 phase-store.svelte.ts
export type SetupPhase = 
  | "welcome"
  | "auth"
  | "workspace"
  | "plugins"
  | "skills"
  | "complete";

interface PhaseConfig {
  skipable: boolean;
  required: boolean;
  autoAdvance: boolean;
}
```

**相关文件**:
- 参考 `SetupWizard.svelte` 现有结构
- 建议提取通用 PhaseNavigator 组件

---

### 2. 双信号状态指示器 (Dual-signal Status)

**Codex 模式**:
- **颜色** = 状态 (running/waiting/idle/complete/failed)
- **形状** = 进程 (活跃 `*` / 已退出 `·` / 休眠 `◈`)

**落地建议**:
```typescript
// 增强 SessionStatusBar 的状态显示
interface DualStatus {
  color: "running" | "waiting" | "idle" | "complete" | "failed";
  shape: "active" | "exited" | "dormant";
}

// 现有 DualStatusIndicator 组件可扩展
```

---

### 3. 交互层级设计

**Codex 模式**:
```
交互层级: 操作 > 预览 > 引用
- 操作必须明确
- 预览可跳过
- 引用仅辅助理解
```

**落地建议**:
- 在 CommandPalette 中区分: 主要操作 / 预览命令 / 仅引用命令
- ChatMessage 工具调用采用三级展开: 摘要 → 详情 → 原始输出

---

### 4. 扩展思维可视化 (Extended Thinking)

**Codex 模式**:
```typescript
interface ThinkingState {
  text: string;
  startMs: number;
  endMs: number;
  durationSec: number; // 计算属性
}
```

**落地建议**:
MiWarp 已有完整实现 (`SessionStore.thinkingText`)，建议增强:
- 思维过程时间线可视化
- 思维与响应的对比展示
- 用户可折叠/展开思维详情

---

### 5. 上下文窗口可视化

**Codex 模式**:
- 彩色比例条显示 200K 上下文消耗
- 分段: system prompt / 环境信息 / CLAUDE.md / 文件读取 / 工具输出

**落地建议**:
```typescript
// 新增 ContextWindowBar.svelte
interface ContextSegment {
  type: "system" | "env" | "claudeMd" | "files" | "tools";
  used: number;
  max: number;
  color: string;
}
```

**相关文件**:
- `SessionInfoPanel.svelte` 可集成此组件

---

### 6. 命令面板增强

**Codex 模式**:
- 分类: chat, tools, navigation, settings, diagnostics, system
- 模糊搜索 + 多字段加权匹配
- 使用频率跟踪，高频命令优先
- 每个命令显示快捷键

**落地建议**:
```typescript
// 增强 CommandPalette.svelte
interface CommandMetadata {
  category: CommandCategory;
  shortcut?: string;
  usageCount: number;
  lastUsed: Date;
  relevanceScore: number; // 基于频率和匹配度
}
```

---

### 7. 技能系统增强

**Codex 模式**:
- Markdown + YAML frontmatter 定义
- 权限级别: view / execute / edit
- 工具分类: productivity, development, automation, memory, organization, integrations

**落地建议**:
MiWarp 已有完整 skill 系统，建议:
- 增加技能使用统计
- 技能市场增加分类筛选
- 技能依赖关系可视化

---

### 8. 计划模式 (Plan Mode)

**Codex 模式**:
- 软件架构师角色
- 返回分步骤计划
- 识别关键文件
- 考虑架构权衡

**落地建议**:
- 复用 `Plan` 内置 agent
- 在 CommandPalette 中增加 `Plan:` 前缀命令
- 计划结果可一键转为任务列表

---

### 9. 自动化任务增强

**Codex 模式**:
- Cron 表达式 (本地时区，非 UTC)
- ISO 8601 时间戳 (一次性)
- 完成后通知
- 重试配置

**落地建议**:
- `ScheduledTaskEditor.svelte` 已支持基础功能
- 建议增加: 执行历史、成功率统计、失败告警

---

### 10. 多 agent 协作

**Codex 模式**:
- 子 agent 思维提取为合成条目
- 团队仪表盘与活动 feed
- 共享技能和定时任务

**落地建议**:
- `MultiAgentPanel.svelte` 已有基础
- 建议增加: agent 间消息传递可视化、任务分发时间线

---

## 三、短期可落地项目 (1-2 周)

| 优先级 | 功能 | 改动文件 |
|--------|------|----------|
| P0 | 增强状态指示器 (双信号) | `SessionStatusBar.svelte`, `DualStatusIndicator.svelte` |
| P0 | 命令面板分类 + 快捷键显示 | `CommandPalette.svelte` |
| P1 | 上下文窗口可视化 | 新增 `ContextWindowBar.svelte` |
| P1 | 思维过程折叠/展开增强 | `ChatMessage.svelte` |

---

## 四、中期改进 (1 个月)

| 功能 | 说明 |
|------|------|
| Plan 命令集成 | `Plan:` 前缀触发 plan agent |
| 技能使用统计 | 跟踪每个技能的使用次数和成功率 |
| 命令频率学习 | 跟踪用户最常用命令，优先显示 |

---

## 五、长期规划

- 团队协作功能增强
- 技能市场国际化
- 跨设备同步
- AI 驱动的智能建议

---

## 六、参考资料

- MiWarp 现有实现: `src/lib/stores/session-store.svelte.ts`
- 状态管理: `src/lib/components/SessionStatusBar.svelte`
- 命令面板: `src/lib/components/CommandPalette.svelte`
- 技能系统: `src/lib/stores/skill-store.svelte.ts`
- 定时任务: `src/lib/stores/scheduled-tasks-store.svelte.ts`
