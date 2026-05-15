/**
 * 多 Agent 并行执行服务
 * 允许用户通过一条指令触发多个 Agent 并行工作
 */

export interface MultiAgentConfig {
  name: string;
  description: string;
  agents: AgentDefinition[];
}

export interface AgentDefinition {
  id: string;
  name: string;
  prompt: string;
  priority?: number;
  dependsOn?: string[];
}

export interface MultiAgentResult {
  agentId: string;
  status: "pending" | "running" | "completed" | "failed";
  result?: string;
  error?: string;
  duration?: number;
}

class MultiAgentService {
  /** 预设的多 Agent 任务配置 */
  private presets: Map<string, MultiAgentConfig> = new Map();

  constructor() {
    this.initPresets();
  }

  /** 初始化预设配置 */
  private initPresets() {
    // 全栈开发预设
    this.presets.set("fullstack", {
      name: "multiAgent_preset_fullstack",
      description: "multiAgent_desc_fullstack",
      agents: [
        {
          id: "frontend",
          name: "前端开发",
          prompt: "开发前端界面组件，使用 React/Vue/Svelte",
          priority: 1,
        },
        {
          id: "backend",
          name: "后端开发",
          prompt: "开发 REST API 和业务逻辑",
          priority: 2,
          dependsOn: ["frontend"],
        },
        {
          id: "database",
          name: "数据库设计",
          prompt: "设计数据库 schema 和 migrations",
          priority: 2,
        },
      ],
    });

    // 代码审查预设
    this.presets.set("review", {
      name: "multiAgent_preset_review",
      description: "multiAgent_desc_review",
      agents: [
        {
          id: "security",
          name: "安全审查",
          prompt: "检查安全漏洞：SQL注入、XSS、CSRF等",
        },
        {
          id: "performance",
          name: "性能审查",
          prompt: "检查性能问题：N+1查询、内存泄漏等",
        },
        {
          id: "style",
          name: "代码风格",
          prompt: "检查代码规范和最佳实践",
        },
      ],
    });

    // 大升级预设
    this.presets.set("upgrade", {
      name: "multiAgent_preset_upgrade",
      description: "multiAgent_desc_upgrade",
      agents: [
        {
          id: "feature1",
          name: "模块 1",
          prompt: "实现第一个功能模块",
        },
        {
          id: "feature2",
          name: "模块 2",
          prompt: "实现第二个功能模块",
        },
        {
          id: "feature3",
          name: "模块 3",
          prompt: "实现第三个功能模块",
        },
        {
          id: "feature4",
          name: "模块 4",
          prompt: "实现第四个功能模块",
        },
        {
          id: "feature5",
          name: "模块 5",
          prompt: "实现第五个功能模块",
        },
      ],
    });

    // 测试预设
    this.presets.set("test", {
      name: "multiAgent_preset_test",
      description: "multiAgent_desc_test",
      agents: [
        {
          id: "unit",
          name: "单元测试",
          prompt: "编写单元测试用例",
        },
        {
          id: "integration",
          name: "集成测试",
          prompt: "编写集成测试用例",
        },
        {
          id: "e2e",
          name: "E2E测试",
          prompt: "编写端到端测试用例",
        },
      ],
    });

    // 文档预设
    this.presets.set("docs", {
      name: "multiAgent_preset_docs",
      description: "multiAgent_desc_docs",
      agents: [
        {
          id: "api",
          name: "API 文档",
          prompt: "生成 API 文档",
        },
        {
          id: "readme",
          name: "README",
          prompt: "生成项目 README",
        },
        {
          id: "changelog",
          name: "CHANGELOG",
          prompt: "生成更新日志",
        },
      ],
    });
  }

  /** 获取所有预设 */
  getPresets(): { id: string; name: string; description: string; agentCount: number }[] {
    return Array.from(this.presets.entries()).map(([id, config]) => ({
      id,
      name: config.name,
      description: config.description,
      agentCount: config.agents.length,
    }));
  }

  /** 获取预设配置 */
  getPreset(id: string): MultiAgentConfig | undefined {
    return this.presets.get(id);
  }

  /** 添加自定义预设 */
  addPreset(id: string, config: MultiAgentConfig) {
    this.presets.set(id, config);
  }

  /** 执行多 Agent 任务 */
  async execute(
    config: MultiAgentConfig,
    context: { cwd: string; projectPath: string },
    onProgress?: (agentId: string, status: string) => void,
  ): Promise<MultiAgentResult[]> {
    const results: MultiAgentResult[] = [];
    const runningAgents = new Map<string, Promise<MultiAgentResult>>();

    for (const agent of config.agents) {
      const result: MultiAgentResult = {
        agentId: agent.id,
        status: "pending",
      };

      // 检查依赖
      if (agent.dependsOn && agent.dependsOn.length > 0) {
        const depsMet = agent.dependsOn.every((depId) => {
          const dep = results.find((r) => r.agentId === depId);
          return dep?.status === "completed";
        });

        if (!depsMet) {
          result.status = "pending";
          result.error = "Dependencies not met";
          results.push(result);
          continue;
        }
      }

      // 启动 Agent
      const startTime = Date.now();
      result.status = "running";
      onProgress?.(agent.id, "started");

      const task = this.executeAgent(agent, context, (status) => {
        onProgress?.(agent.id, status);
      });

      runningAgents.set(
        agent.id,
        task
          .then((r) => {
            result.status = "completed";
            result.result = r;
            result.duration = Date.now() - startTime;
            return result;
          })
          .catch((e) => {
            result.status = "failed";
            result.error = String(e);
            result.duration = Date.now() - startTime;
            return result;
          }),
      );
    }

    // 等待所有 Agent 完成
    const settled = await Promise.all(runningAgents.values());
    results.push(
      ...settled.filter((r) => !results.find((existing) => existing.agentId === r.agentId)),
    );

    return results;
  }

  /** 执行单个 Agent */
  private async executeAgent(
    agent: AgentDefinition,
    context: { cwd: string; projectPath: string },
    onStatus?: (status: string) => void,
  ): Promise<string> {
    // 这里应该调用实际的 Agent 执行逻辑
    // 暂时返回模拟结果
    onStatus?.("completed");
    return `[${agent.name}] 任务完成`;
  }

  /** 从自然语言生成多 Agent 任务 */
  parseNaturalLanguage(input: string): MultiAgentConfig | null {
    // 简单的模式匹配
    const patterns = [
      {
        regex: /实现.*功能/i,
        agents: [
          { id: "dev1", name: "开发 1", prompt: "实现第一个功能" },
          { id: "dev2", name: "开发 2", prompt: "实现第二个功能" },
        ],
      },
      {
        regex: /开发.*前端.*后端/i,
        agents: [
          { id: "frontend", name: "前端", prompt: "开发前端界面" },
          { id: "backend", name: "后端", prompt: "开发后端 API" },
        ],
      },
    ];

    for (const pattern of patterns) {
      if (pattern.regex.test(input)) {
        return {
          name: "自定义任务",
          description: input,
          agents: pattern.agents,
        };
      }
    }

    return null;
  }
}

export const multiAgentService = new MultiAgentService();
