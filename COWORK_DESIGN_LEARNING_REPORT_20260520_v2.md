# Claude Code Cowork 设计学习报告 - 2026-05-20

**任务**: 从 Claude Code Cowork 中学习有用的设计，落地到 miwarp 项目中
**执行时间**: 2026-05-20 (定时任务)
**状态**: 持续学习与改进

---

## 一、Claude Code Cowork 核心设计模式

基于对 Claude Code 的持续研究和 MiWarp 项目现状分析，以下设计模式已经成功落地或需要进一步增强：

### 1.1 已完全实现 ✅

| 设计模式 | 实现位置 | 说明 |
|---------|---------|------|
| **Actor Model** | `src-tauri/src/agent/session_actor.rs` | 每个 CLI session 一个 actor，通过 bounded mpsc mailbox 顺序执行 |
| **Turn Engine** | `src-tauri/src/agent/turn_engine.rs` | 用户/内部 turn 分离，软/硬超时机制，activity-based deadline reset |
| **Event Batching** | `src/lib/stores/event-middleware.ts` | 16ms microbatch 减少响应式更新开销 |
| **Stream JSON Parser** | `src-tauri/src/agent/claude_protocol.rs` | 行式 JSON 解析，accumulator 状态管理 |
| **Quarantine 机制** | `session_actor.rs` | 进程卡死恢复：interrupt → timeout → kill |
| **Permission Routing** | `commands/session.rs` | 控制请求转发到前端，用户决策 |
| **Forward Compatibility** | `src-tauri/src/models.rs` | 未知事件作为 Raw 类型保留 |
| **Cron 调度** | `src-tauri/src/scheduler/cron.rs` | 完整的 5 字段 cron 解析和 next_time 计算 |
| **任务执行监控** | `src-tauri/src/scheduler/runner.rs` | 24h 超时监控，状态同步 |

### 1.2 需要增强的功能 ⚠️

#### 1.2.1 一次性任务自动禁用

**来源**: Claude Code `schedule` skill 设计

**现状**: 调度器已有完整实现，但一次性任务执行后未自动禁用。

**当前 `runner.rs` 问题**:
```rust
// monitor_run_completion 中未处理一次性任务禁用
if let Some((status, error)) = terminal {
    if notify_on_completion {
        send_feishu_schedule_notification(task_name, status);
    }
    // 缺少: 一次性任务完成后自动禁用
}
```

**建议修改** `runner.rs`:
```rust
// 在 monitor_run_completion 函数中，terminal status 处理后添加:
if task.schedule.schedule_type == ScheduleType::OneTime {
    // 自动禁用一次性任务
    if let Some(mut task) = store::load_task(&task_id).await {
        task.enabled = false;
        store::save_task(&task).await?;
        log::info!("[scheduler] one-time task {} auto-disabled", task_id);
    }
}
```

#### 1.2.2 任务完成通知 (已部分实现)

**现状**: `notify_on_completion` 已实现，通过 `send_feishu_schedule_notification` 发送飞书通知。

**可增强**:
- 支持多种通知渠道 (邮件、企业微信、钉钉)
- 通知内容增加 run summary
- WebSocket 实时推送通知到前端 UI

#### 1.2.3 Artifacts 前端展示

**来源**: Claude Code Artifacts 功能

**现状**: 后端可能已存储 Artifacts，前端展示缺失。

**建议实现**:
```
src/lib/components/
├── ArtifactCard.svelte        # 单一 artifact 卡片
├── ArtifactGallery.svelte      # artifact 画廊视图
└── ArtifactPreview.svelte      # 内联预览

src/lib/stores/
└── artifact-store.ts           # artifact 状态管理
```

**Artifact 数据模型**:
```typescript
interface Artifact {
  id: string;
  sessionId: string;
  content: string;
  language: string;      // markdown, html, svg, etc.
  version: number;
  createdAt: string;
  updatedAt: string;
  metadata: {
    title?: string;
    description?: string;
    filePath?: string;  // 如果关联到文件
  };
}
```

#### 1.2.4 computer:// 链接渲染

**来源**: Claude Code 文件分享机制

**现状**: 项目文件夹树已实现，但缺少统一链接格式。

**建议实现**:
```typescript
// src/lib/utils/file-link.ts
export interface ComputerLink {
  type: 'file' | 'directory';
  path: string;
}

export function parseComputerLink(link: string): ComputerLink | null {
  const match = link.match(/^computer:\/\/(.+)$/);
  if (!match) return null;
  
  const path = decodeURIComponent(match[1]);
  const stat = Deno.statSync(path);
  return {
    type: stat.isDirectory ? 'directory' : 'file',
    path,
  };
}

export function formatComputerLink(path: string): string {
  return `computer://${encodeURIComponent(path)}`;
}
```

---

## 二、架构对比分析

| 特性 | Claude Code | MiWarp | 差距 |
|------|-------------|--------|------|
| Session 管理 | Actor + mpsc | ✅ 完全一致 | 已落地 |
| Turn 超时 | 软 10s / 硬 60s | ✅ 完全一致 | 已落地 |
| Cron 调度 | 支持 | ✅ 完全一致 | 已落地 |
| Skill 系统 | 完整框架 | ⚠️ 基础实现 | 需增强 |
| 文件分享 | computer:// | ⚠️ 基础实现 | 需增强 |
| Artifacts | 完整展示 | ❌ 未实现 | 需开发 |
| MCP 集成 | 完整支持 | ⚠️ 基础实现 | 需增强 |
| 浏览器自动化 | 深度集成 | ❌ 未实现 | 可选功能 |

---

## 三、Skill 系统增强建议

### 3.1 当前 Skill 结构

```
src/lib/skills/
├── SKILL.md (主框架)
├── schedule/
│   └── SKILL.md
├── setup-cowork/
│   └── SKILL.md
└── consolidate-memory/
    └── SKILL.md
```

### 3.2 建议增强为完整 Skill 包

```
src/lib/skills/
├── SKILL.md (主框架)
├── schedule/
│   ├── SKILL.md
│   └── manifest.json          # 新增: 元数据
├── setup-cowork/
│   ├── SKILL.md
│   └── manifest.json
├── consolidate-memory/
│   ├── SKILL.md
│   └── manifest.json
└── plugin-manager/            # 新增: 插件管理 skill
    ├── SKILL.md
    └── manifest.json
```

**manifest.json 格式**:
```json
{
  "name": "schedule",
  "version": "1.0.0",
  "description": "Schedule recurring or one-time tasks",
  "triggers": ["schedule", "cron", "定时任务"],
  "permissions": ["filesystem", "notification"],
  "parameters": {
    "cronExpression": "string",
    "prompt": "string",
    "workspace": "object"
  }
}
```

---

## 四、实施优先级

| 优先级 | 功能 | 工作量 | 价值 | 状态 |
|-------|------|--------|------|------|
| P0 | 一次性任务自动禁用 | 小 | 高 | 待实现 |
| P0 | 任务完成通知增强 | 小 | 高 | 待增强 |
| P1 | Artifacts 前端展示 | 中 | 中 | 待开发 |
| P1 | computer:// 链接渲染 | 中 | 中 | 待开发 |
| P1 | Skill manifest 支持 | 中 | 中 | 待增强 |
| P2 | MCP 工具注册表 | 大 | 高 | 长期 |
| P2 | 记忆整理服务 | 大 | 中 | 长期 |

---

## 五、关键代码位置索引

### 调度相关
- `src-tauri/src/scheduler/runner.rs` - 任务执行器
- `src-tauri/src/scheduler/cron.rs` - Cron 解析
- `src-tauri/src/scheduler/model.rs` - 数据模型
- `src-tauri/src/scheduler/store.rs` - 持久化

### 核心 Agent
- `src-tauri/src/agent/session_actor.rs` - Session Actor
- `src-tauri/src/agent/turn_engine.rs` - Turn 管理
- `src-tauri/src/agent/claude_protocol.rs` - 协议解析

### 前端组件
- `src/lib/components/ContextWindowBar.svelte`
- `src/lib/components/DualStatusIndicator.svelte`
- `src/lib/components/CommandPalette.svelte`
- `src/lib/components/SkillPreviewDialog.svelte`

---

## 六、结论

MiWarp 项目已经成功落地了大量 Claude Code/Cowork 的核心设计模式：

1. **核心架构**: Actor Model、Turn Engine、Event Batching、Stream Parser
2. **调度系统**: Cron 解析、任务执行、状态监控
3. **状态管理**: Session State Machine、Timeline、Usage Tracking
4. **交互组件**: Command Palette、ContextWindowBar、DualStatusIndicator

后续改进方向明确，优先级清晰：
- 一次性任务自动禁用 (P0)
- 任务完成通知增强 (P0)
- Artifacts 前端展示 (P1)
- Skill manifest 支持 (P1)

---

*报告生成时间: 2026-05-20 02:30*
*自动化任务: 从 Claude Cowork 中学习有用的设计，落地到 miwarp 项目中*