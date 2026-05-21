# MiWarp 设计改进建议：从 Codex Claude Code 学习

## 概述

基于对 MiWarp 当前架构的分析和 Codex/Claude Code 的设计模式，本文档总结了一系列可落地的设计改进建议。

---

## 1. 多 Agent 执行服务改进

### 当前状态
MiWarp 已有 `multi-agent-service.ts`，但 `executeAgent` 方法是空实现，返回模拟结果。

### 改进建议

```typescript
// src/lib/services/multi-agent-service.ts

/**
 * 执行单个 Agent（基于 Codex thread 模式）
 */
private async executeAgent(
  agent: AgentDefinition,
  context: { cwd: string; projectPath: string },
  onStatus?: (status: string) => void,
): Promise<string> {
  // 1. 创建独立的工作目录（基于 git worktree）
  const worktreeDir = await this.createWorktree(agent.id, context.projectPath);

  // 2. 启动 Claude Code 会话
  const sessionId = await api.startRun({
    cwd: worktreeDir,
    prompt: agent.prompt,
    model: "sonnet",
    sessionMode: "default"
  });

  // 3. 监听会话状态
  return new Promise((resolve, reject) => {
    const unsubscribe = eventBus.on("run-event", (event) => {
      if (event.run_id !== sessionId) return;

      switch (event.type) {
        case "run_completed":
          unsubscribe();
          resolve(this.getRunSummary(sessionId));
          break;
        case "run_failed":
          unsubscribe();
          reject(new Error(event.error));
          break;
        case "tool_use":
          onStatus?.(`[${agent.name}] ${event.tool.name}`);
          break;
      }
    });

    // 超时处理
    setTimeout(() => {
      unsubscribe();
      api.stopRun(sessionId);
      reject(new Error("Agent execution timeout"));
    }, 30 * 60 * 1000); // 30 分钟超时
  });
}

/**
 * 创建 git worktree（类似 Codex 的独立执行环境）
 */
private async createWorktree(agentId: string, projectPath: string): Promise<string> {
  const branchName = `miwarp-agent-${agentId}-${Date.now()}`;
  const worktreePath = `${projectPath}.worktrees/${branchName}`;

  await api.createWorktree({
    projectPath,
    branchName,
    worktreePath
  });

  return worktreePath;
}
```

### 关键改进点

| 改进 | 说明 |
|------|------|
| Worktree 隔离 | 每个 agent 在独立分支工作，避免冲突 |
| 异步状态监听 | 使用事件总线而非轮询 |
| 超时保护 | 30 分钟自动终止 |
| 结果汇总 | 收集每个 agent 的执行摘要 |

---

## 2. 会话管理增强（Thread 模式）

### 当前状态
MiWarp 使用 `session_actor.rs` 管理会话，已有基础的 Actor 模式。

### 改进建议：引入 Thread 概念

Codex 的 thread 系统允许：
- 独立的对话上下文
- 消息关联和引用
- 线程间跳转

```rust
// src-tauri/src/agent/thread_manager.rs

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tokio::sync::RwLock;

/// Thread 元数据
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Thread {
    pub id: String,
    pub parent_thread_id: Option<String>,
    pub title: String,
    pub created_at: chrono::DateTime<Utc>,
    pub messages: Vec<Message>,
    pub metadata: ThreadMetadata,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ThreadMetadata {
    pub tags: Vec<String>,
    pub pinned: bool,
    pub archived: bool,
}

/// ThreadManager: 管理所有线程生命周期
pub struct ThreadManager {
    threads: RwLock<HashMap<String, Arc<RwLock<Thread>>>>,
    storage_path: PathBuf,
}

impl ThreadManager {
    /// 从另一个线程分叉（类似 git branch）
    pub async fn fork_thread(
        &self,
        parent_id: &str,
        new_title: &str,
    ) -> Result<String, ThreadError> {
        let parent = self.get_thread(parent_id).await?;
        let new_id = uuid::v4();

        let forked = Thread {
            id: new_id.clone(),
            parent_thread_id: Some(parent_id.to_string()),
            title: new_title.to_string(),
            created_at: Utc::now(),
            messages: parent.messages.clone(),
            metadata: ThreadMetadata::default(),
        };

        self.threads.write().await.insert(new_id.clone(), Arc::new(RwLock::new(forked)));
        self.persist_thread(&forked).await?;

        Ok(new_id)
    }

    /// 合并线程（类似 git merge）
    pub async fn merge_thread(
        &self,
        source_id: &str,
        target_id: &str,
    ) -> Result<(), ThreadError> {
        let source = self.get_thread(source_id).await?;
        let mut target = self.get_thread(target_id).await?;

        target.messages.extend(source.messages);
        target.metadata.archived = true;

        self.update_thread(&target).await?;
        Ok(())
    }

    /// 搜索线程
    pub async fn search_threads(&self, query: &str) -> Vec<ThreadSummary> {
        let threads = self.threads.read().await;
        threads
            .values()
            .filter_map(|t| {
                let t = t.blocking_read();
                if t.title.contains(query) || t.messages.iter().any(|m| m.content.contains(query)) {
                    Some(ThreadSummary::from(&*t))
                } else {
                    None
                }
            })
            .collect()
    }
}
```

---

## 3. 团队协作增强

### 当前状态
MiWarp 已有 `TeamStore`，支持基础的任务分发。

### 改进建议

#### 3.1 任务依赖图可视化

```typescript
// src/lib/components/teams/TaskDependencyGraph.svelte

<script lang="ts">
  import type { TeamTask } from "$lib/types";

  interface Props {
    tasks: TeamTask[];
  }

  let { tasks }: Props = $props();

  // 计算 DAG 拓扑排序
  function topologicalSort(tasks: TeamTask[]): TeamTask[] {
    const inDegree = new Map(tasks.map(t => [t.id, t.dependsOn?.length ?? 0]));
    const graph = new Map(tasks.map(t => [t.id, t.dependsOn ?? []]));
    const queue = tasks.filter(t => inDegree.get(t.id) === 0);
    const result: TeamTask[] = [];

    while (queue.length > 0) {
      const task = queue.shift()!;
      result.push(task);

      // 更新依赖计数
      for (const [id, deps] of graph) {
        if (deps.includes(task.id)) {
          const newDegree = (inDegree.get(id) ?? 1) - 1;
          inDegree.set(id, newDegree);
          if (newDegree === 0) {
            const t = tasks.find(t => t.id === id);
            if (t) queue.push(t);
          }
        }
      }
    }

    return result;
  }

  let sortedTasks = $derived(topologicalSort(tasks));
</script>

<div class="task-graph">
  {#each sortedTasks as task, i}
    <div class="task-node" class:completed={task.status === 'completed'} class:pending={task.status === 'pending'}>
      <div class="task-title">{task.title}</div>
      {#if task.dependsOn?.length}
        <div class="task-deps">
          等待: {task.dependsOn.join(", ")}
        </div>
      {/if}
    </div>
    {#if i < sortedTasks.length - 1}
      <div class="task-arrow">↓</div>
    {/if}
  {/each}
</div>
```

#### 3.2 实时代价估算

```typescript
// src/lib/services/cost-estimator.ts

export interface CostEstimate {
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  duration: number; // 秒
}

export async function estimateTaskCost(task: TeamTask): Promise<CostEstimate> {
  // 基于历史数据估算
  const history = await api.getTaskHistory(task.type);
  const avgInput = history.reduce((sum, h) => sum + h.inputTokens, 0) / history.length;
  const avgOutput = history.reduce((sum, h) => sum + h.outputTokens, 0) / history.length;

  const model = task.model ?? "claude-sonnet-4-20250514";
  const rates = {
    "claude-sonnet-4-20250514": { input: 3, output: 15 }, // $ / M tokens
    "claude-opus-4-20250514": { input: 15, output: 75 },
  };

  const rate = rates[model] ?? rates["claude-sonnet-4-20250514"];
  const estimatedCost =
    (avgInput / 1_000_000) * rate.input +
    (avgOutput / 1_000_000) * rate.output;

  return {
    inputTokens: Math.round(avgInput),
    outputTokens: Math.round(avgOutput),
    estimatedCost,
    duration: history.reduce((sum, h) => sum + h.duration, 0) / history.length,
  };
}
```

---

## 4. 权限模式增强

### 当前状态
MiWarp 使用 `permission_mode` 设置，已有基础实现。

### 改进建议：渐进式权限模式

```typescript
// src/lib/stores/permission-store.svelte.ts

export type PermissionLevel =
  | "read"      // 只读，不能修改文件
  | "review"    // 可以修改但需要确认
  | "auto-accept" // 自动接受安全操作
  | "full";     // 完全控制

export class PermissionStore {
  level = $state<PermissionLevel>("review");
  pendingRequests = $state<PermissionRequest[]>([]);

  async requestPermission(action: PermissionAction): Promise<boolean> {
    if (this.level === "full") return true;
    if (this.level === "read") return false;

    const request: PermissionRequest = {
      id: crypto.randomUUID(),
      action,
      timestamp: Date.now(),
      status: "pending",
    };

    this.pendingRequests = [...this.pendingRequests, request];

    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        const req = this.pendingRequests.find(r => r.id === request.id);
        if (req?.status === "approved") {
          clearInterval(checkInterval);
          resolve(true);
        } else if (req?.status === "denied") {
          clearInterval(checkInterval);
          resolve(false);
        }
      }, 100);
    });
  }

  // 快捷权限设置
  setQuickMode(mode: "careful" | "balanced" | "fast") {
    switch (mode) {
      case "careful":
        this.level = "review";
        break;
      case "balanced":
        this.level = "auto-accept";
        break;
      case "fast":
        this.level = "full";
        break;
    }
  }
}
```

---

## 5. 事件系统增强

### 当前状态
MiWarp 使用 `event-middleware.ts` 处理事件流。

### 改进建议：添加事件重放和调试

```typescript
// src/lib/stores/event-replay.ts

export interface ReplayableEvent {
  id: string;
  type: string;
  data: unknown;
  timestamp: number;
  source: string;
}

export class EventReplay {
  private events: ReplayableEvent[] = [];
  private checkpoints: Map<string, number> = new Map();

  /**
   * 创建检查点（用于恢复）
   */
  createCheckpoint(name: string): void {
    this.checkpoints.set(name, this.events.length);
  }

  /**
   * 恢复到指定检查点
   */
  async restoreToCheckpoint(name: string): Promise<void> {
    const index = this.checkpoints.get(name);
    if (index === undefined) throw new Error(`Checkpoint ${name} not found`);

    const eventsToReplay = this.events.slice(0, index);
    await this.replayEvents(eventsToReplay);
  }

  /**
   * 重放事件序列
   */
  private async replayEvents(events: ReplayableEvent[]): Promise<void> {
    for (const event of events) {
      await this.dispatch(event);
      await yieldToMain(); // 让 UI 有机会更新
    }
  }

  /**
   * 导出事件序列
   */
  exportEvents(): string {
    return JSON.stringify(this.events, null, 2);
  }

  /**
   * 从导入的文件加载事件
   */
  async importEvents(json: string): Promise<void> {
    this.events = JSON.parse(json);
  }
}
```

---

## 6. MCP (Model Context Protocol) 增强

### 当前状态
MiWarp 已有 MCP 服务器配置能力。

### 改进建议：MCP 资源缓存和智能路由

```typescript
// src/lib/services/mcp-intelligence.ts

export interface McpResource {
  name: string;
  type: "file" | "api" | "database" | "service";
  uri: string;
  cached?: string;
  lastUsed?: number;
}

export class McpIntelligence {
  private resourceCache = new Map<string, McpResource>();
  private usageStats = new Map<string, number>();

  /**
   * 智能选择最佳 MCP 服务器
   */
  selectBestMcp(task: string, availableServers: string[]): string | null {
    const scores = availableServers.map(server => ({
      server,
      score: this.calculateScore(server, task),
    }));

    scores.sort((a, b) => b.score - a.score);
    return scores[0]?.score > 0.5 ? scores[0].server : null;
  }

  private calculateScore(server: string, task: string): number {
    let score = 0;
    const taskKeywords = this.tokenize(task);

    // 检查历史使用
    const usage = this.usageStats.get(server) ?? 0;
    score += Math.min(usage / 100, 0.3);

    // 检查功能匹配
    const capabilities = this.getServerCapabilities(server);
    const matches = taskKeywords.filter(k => capabilities.includes(k));
    score += matches.length / taskKeywords.length * 0.7;

    return score;
  }

  /**
   * 预热缓存
   */
  async warmCache(server: string, resources: string[]): Promise<void> {
    for (const resource of resources) {
      try {
        const data = await api.getMcpResource(server, resource);
        this.resourceCache.set(`${server}:${resource}`, {
          name: resource,
          type: "file",
          uri: `${server}/${resource}`,
          cached: JSON.stringify(data),
          lastUsed: Date.now(),
        });
      } catch (e) {
        console.warn(`Failed to cache ${resource} from ${server}`);
      }
    }
  }
}
```

---

## 7. 实现优先级建议

| 优先级 | 改进项 | 预计工作量 | 价值 |
|--------|--------|-----------|------|
| P0 | 多 Agent 执行服务完善 | 中 | 高 |
| P0 | 任务依赖图可视化 | 低 | 高 |
| P1 | 渐进式权限模式 | 低 | 中 |
| P1 | 事件重放和调试 | 中 | 高 |
| P2 | Thread 模式 | 高 | 中 |
| P2 | MCP 智能路由 | 中 | 中 |

---

## 8. 文件修改清单

如果需要实施这些改进，以下是需要修改的文件：

### 新建文件
- `src/lib/services/multi-agent-service.ts` (已存在，需完善)
- `src/lib/services/cost-estimator.ts`
- `src/lib/services/mcp-intelligence.ts`
- `src/lib/stores/event-replay.ts`
- `src/lib/components/teams/TaskDependencyGraph.svelte`
- `src-tauri/src/agent/thread_manager.rs`

### 修改文件
- `src/routes/multi-agent/+page.svelte`
- `src/routes/teams/+page.svelte`
- `src/lib/stores/team-store.svelte.ts`
- `src/lib/stores/session-store.svelte.ts`
- `src-tauri/src/agent/session_actor.rs`

---

## 总结

这些改进建议基于 Codex/Claude Code 的成熟设计模式，结合 MiWarp 的现有架构提出。核心改进方向：

1. **隔离执行环境**：通过 git worktree 实现真正的并行 Agent 隔离
2. **增强协作**：任务依赖图和实时代价估算提升团队效率
3. **调试能力**：事件重放让问题排查更简单
4. **智能路由**：MCP 资源缓存和智能选择提升响应速度

建议从 P0 优先级的改进开始实施，逐步迭代完善。