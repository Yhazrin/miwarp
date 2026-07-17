/**
 * 多 Agent 并行执行服务
 * 允许用户通过一条指令触发多个 Agent 并行工作
 */

export interface MultiAgentConfig {
  name: string;
  description: string;
  agents: AgentDefinition[];
}

interface AgentDefinition {
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

/**
 * 自然语言任务模式接口
 */
interface NLTaskPattern {
  /** 匹配的正则表达式 */
  regex: RegExp;
  /** 任务名称（支持i18n key） */
  name: string;
  /** 任务描述 */
  description: string;
  /** Agent定义数组 */
  agents: AgentDefinition[];
}

/**
 * 预设的自然语言任务模式
 */
const NL_TASK_PATTERNS: NLTaskPattern[] = [
  // 全栈开发模式
  {
    regex: /^(?=.*全栈)(?=.*开发)/i,
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
  },
  // 前端 + 后端开发
  {
    regex: /^(?=.*前端)(?=.*后端)/i,
    name: "前后端开发",
    description: "同时开发前端和后端",
    agents: [
      { id: "frontend", name: "前端", prompt: "开发前端界面组件", priority: 1 },
      { id: "backend", name: "后端", prompt: "开发后端 API", priority: 2 },
    ],
  },
  // 代码审查
  {
    regex: /^(?=.*审)(?=.*查|查|阅|核)/i,
    name: "multiAgent_preset_review",
    description: "multiAgent_desc_review",
    agents: [
      { id: "security", name: "安全审查", prompt: "检查安全漏洞：SQL注入、XSS、CSRF、认证问题等" },
      { id: "performance", name: "性能审查", prompt: "检查性能问题：N+1查询、内存泄漏、慢查询等" },
      { id: "style", name: "代码风格", prompt: "检查代码规范和最佳实践" },
    ],
  },
  // 安全审查
  {
    regex: /安全(审|检|查)?/i,
    name: "安全审查",
    description: "检查代码安全漏洞",
    agents: [
      { id: "sql-injection", name: "SQL注入检查", prompt: "检查SQL注入风险，使用参数化查询" },
      { id: "xss", name: "XSS检查", prompt: "检查XSS跨站脚本攻击风险" },
      { id: "csrf", name: "CSRF检查", prompt: "检查CSRF跨站请求伪造风险" },
      { id: "auth", name: "认证检查", prompt: "检查认证和授权漏洞" },
    ],
  },
  // 性能审查
  {
    regex: /性能(审|检|查)?/i,
    name: "性能审查",
    description: "检查代码性能问题",
    agents: [
      { id: "query", name: "数据库查询", prompt: "检查N+1查询和慢查询" },
      { id: "memory", name: "内存管理", prompt: "检查内存泄漏和内存使用" },
      { id: "api", name: "API性能", prompt: "检查API响应时间和优化建议" },
    ],
  },
  // 大升级
  {
    regex: /大.*升级|upgrade.*all|improve.*all/i,
    name: "multiAgent_preset_upgrade",
    description: "multiAgent_desc_upgrade",
    agents: [
      { id: "feature1", name: "模块 1", prompt: "实现第一个功能模块" },
      { id: "feature2", name: "模块 2", prompt: "实现第二个功能模块" },
      { id: "feature3", name: "模块 3", prompt: "实现第三个功能模块" },
      { id: "feature4", name: "模块 4", prompt: "实现第四个功能模块" },
      { id: "feature5", name: "模块 5", prompt: "实现第五个功能模块" },
    ],
  },
  // 测试相关
  {
    regex: /^(?=.*测)(?=.*试)/i,
    name: "multiAgent_preset_test",
    description: "multiAgent_desc_test",
    agents: [
      { id: "unit", name: "单元测试", prompt: "编写单元测试用例，覆盖主要函数和逻辑" },
      { id: "integration", name: "集成测试", prompt: "编写集成测试用例，测试模块间交互" },
      { id: "e2e", name: "E2E测试", prompt: "编写端到端测试用例，模拟用户操作流程" },
    ],
  },
  // 单元测试
  {
    regex: /单元测试|unit.*test/i,
    name: "单元测试",
    description: "编写单元测试",
    agents: [{ id: "unit", name: "单元测试", prompt: "编写单元测试用例，覆盖主要函数和逻辑" }],
  },
  // 集成测试
  {
    regex: /集成测试|integration.*test/i,
    name: "集成测试",
    description: "编写集成测试",
    agents: [{ id: "integration", name: "集成测试", prompt: "编写集成测试用例，测试模块间交互" }],
  },
  // E2E测试
  {
    regex: /e2e|端到端|end.*to.*end/i,
    name: "E2E测试",
    description: "编写端到端测试",
    agents: [{ id: "e2e", name: "E2E测试", prompt: "编写端到端测试用例，模拟用户操作流程" }],
  },
  // 文档相关
  {
    regex: /^(?=.*文)(?=.*档|档)/i,
    name: "multiAgent_preset_docs",
    description: "multiAgent_desc_docs",
    agents: [
      { id: "api", name: "API 文档", prompt: "生成 API 文档，包含接口说明和参数描述" },
      { id: "readme", name: "README", prompt: "生成项目 README，包含项目介绍和快速开始" },
      { id: "changelog", name: "CHANGELOG", prompt: "生成更新日志，记录版本变更" },
    ],
  },
  // API文档
  {
    regex: /api.*文档|rest.*doc|接口.*文档/i,
    name: "API文档",
    description: "生成API文档",
    agents: [{ id: "api", name: "API文档", prompt: "生成 API 文档，包含接口说明和参数描述" }],
  },
  // README
  {
    regex: /readme|项目.*介绍/i,
    name: "README",
    description: "生成项目README",
    agents: [{ id: "readme", name: "README", prompt: "生成项目 README，包含项目介绍和快速开始" }],
  },
  // 实现功能模块
  {
    regex: /实现.*功能|implement.*feature|feature.*implement/i,
    name: "功能实现",
    description: "实现多个功能模块",
    agents: [
      { id: "dev1", name: "功能模块 1", prompt: "实现第一个功能模块" },
      { id: "dev2", name: "功能模块 2", prompt: "实现第二个功能模块" },
      { id: "dev3", name: "功能模块 3", prompt: "实现第三个功能模块" },
    ],
  },
  // 重构
  {
    regex: /重构|refactor/i,
    name: "代码重构",
    description: "重构代码提升质量",
    agents: [
      { id: "extract", name: "提取方法", prompt: "识别可以提取的重复代码并重构" },
      { id: "rename", name: "重命名", prompt: "改进变量和函数命名提升可读性" },
      { id: "structure", name: "结构调整", prompt: "优化代码结构减少耦合" },
    ],
  },
  // Bug修复
  {
    regex: /修复.*bug|fix.*bug|debug/i,
    name: "Bug修复",
    description: "修复代码中的Bug",
    agents: [
      { id: "reproduce", name: "复现Bug", prompt: "尝试复现和定位Bug" },
      { id: "fix", name: "修复Bug", prompt: "修复Bug并确保不影响其他功能" },
      { id: "test", name: "验证修复", prompt: "编写测试验证Bug修复" },
    ],
  },
  // 国际化
  {
    regex: /国际化|i18n|locali/i,
    name: "国际化",
    description: "添加国际化支持",
    agents: [
      { id: "extract", name: "提取文本", prompt: "识别需要国际化的文本和字符串" },
      { id: "create", name: "创建翻译", prompt: "创建语言文件和翻译" },
      { id: "format", name: "格式化", prompt: "格式化国际化代码" },
    ],
  },
  // 移动端适配
  {
    regex: /移动端|responsive|mobile/i,
    name: "移动端适配",
    description: "适配移动端界面",
    agents: [
      { id: "layout", name: "布局适配", prompt: "调整布局适配不同屏幕尺寸" },
      { id: "touch", name: "触摸优化", prompt: "优化触摸交互体验" },
      { id: "performance", name: "性能优化", prompt: "优化移动端性能" },
    ],
  },
  // 数据迁移
  {
    regex: /数据.*迁移|migration|迁移.*数据/i,
    name: "数据迁移",
    description: "迁移数据",
    agents: [
      { id: "analyze", name: "数据分析", prompt: "分析源数据结构和格式" },
      { id: "transform", name: "数据转换", prompt: "编写数据转换脚本" },
      { id: "verify", name: "数据验证", prompt: "验证迁移后数据的完整性" },
    ],
  },
  // 清理死代码
  {
    regex: /清理.*代码|dead.*code|unused/i,
    name: "代码清理",
    description: "清理未使用的代码",
    agents: [
      { id: "detect", name: "检测死代码", prompt: "检测未使用的函数和变量" },
      { id: "analyze", name: "依赖分析", prompt: "分析代码依赖关系" },
      { id: "cleanup", name: "清理代码", prompt: "安全地删除死代码" },
    ],
  },
];

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
    const trimmed = input.trim();
    if (!trimmed) return null;

    // 尝试匹配预设的自然语言模式
    for (const pattern of NL_TASK_PATTERNS) {
      if (pattern.regex.test(trimmed)) {
        return {
          name: pattern.name,
          description: pattern.description,
          agents: pattern.agents,
        };
      }
    }

    // 智能任务分解：基于关键词分析
    const keywords = this.extractKeywords(trimmed);
    if (keywords.length >= 2) {
      return this.decomposeByKeywords(keywords, trimmed);
    }

    // 默认返回单任务
    return {
      name: "自定义任务",
      description: trimmed,
      agents: [
        {
          id: "main",
          name: "主任务",
          prompt: trimmed,
        },
      ],
    };
  }

  /** 提取关键词用于任务分解 */
  private extractKeywords(input: string): string[] {
    const stopWords = new Set([
      "的",
      "和",
      "以及",
      "还有",
      "包括",
      "包含",
      "帮我",
      "请",
      "需要",
      "一下",
    ]);

    // 简单的中文分词（基于词长）
    const words: string[] = [];
    let current = "";

    for (const char of input) {
      if (/[一-龥]/.test(char)) {
        current += char;
      } else if (current.length >= 2) {
        if (!stopWords.has(current)) {
          words.push(current);
        }
        current = "";
      } else {
        current = "";
      }
    }

    if (current.length >= 2 && !stopWords.has(current)) {
      words.push(current);
    }

    return words;
  }

  /** 基于关键词分解任务 */
  private decomposeByKeywords(keywords: string[], originalTask: string): MultiAgentConfig {
    const agentCount = Math.min(keywords.length, 5);
    const agents: AgentDefinition[] = [];

    for (let i = 0; i < agentCount; i++) {
      agents.push({
        id: `task-${i + 1}`,
        name: `任务 ${i + 1}`,
        prompt: `基于关键词"${keywords[i]}"处理: ${originalTask}`,
        priority: i + 1,
      });
    }

    return {
      name: "智能分解任务",
      description: `将 "${originalTask}" 分解为 ${agentCount} 个子任务`,
      agents,
    };
  }

  /** 获取所有可用的自然语言模式 */
  getNLPatterns(): { pattern: string; name: string; agentCount: number }[] {
    return NL_TASK_PATTERNS.map((p) => ({
      pattern: p.regex.source,
      name: p.name,
      agentCount: p.agents.length,
    }));
  }
}

export const multiAgentService = new MultiAgentService();
