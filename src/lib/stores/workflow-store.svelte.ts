/**
 * Workflow Store - Svelte 5 state management for guided workflows
 */
import type {
  WorkflowTemplate,
  WorkflowInstance,
  WorkflowStep,
  WorkflowCheckpoint,
  WorkflowContext,
} from "$lib/types/workflow";
import { t } from "$lib/i18n/index.svelte";

interface WorkflowState {
  templates: WorkflowTemplate[];
  activeInstance: WorkflowInstance | null;
  currentContext: WorkflowContext;
  isExecuting: boolean;
  error: string | null;
}

const defaultTemplates: WorkflowTemplate[] = [
  {
    id: "fullstack-dev",
    name: t("wf_fullstack_name"),
    description: t("wf_fullstack_desc"),
    category: "development",
    icon: "M16 18l2-2-2-2M8 18l-2-2 2-2M13 4l-1.5 12",
    estimatedTime: t("wf_fullstack_time"),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    steps: [
      {
        id: "req-analysis",
        title: t("wf_fullstack_step1_title"),
        instruction: t("wf_fullstack_step1_instruction"),
        prompt:
          "分析项目需求：\n1. 核心功能是什么？\n2. 用户群体是谁？\n3. 技术栈如何选择？\n4. 优先级如何排列？",
        tools: ["file-read", "search"],
        status: "pending",
        interventionLevel: 1,
        estimatedTime: t("wf_fullstack_step1_time"),
      },
      {
        id: "architecture",
        title: t("wf_fullstack_step2_title"),
        instruction: t("wf_fullstack_step2_instruction"),
        prompt:
          "设计系统架构：\n1. 数据库表结构设计\n2. API 接口设计（RESTful）\n3. 项目目录结构\n4. 关键技术方案",
        tools: ["file-write", "file-read"],
        status: "pending",
        interventionLevel: 2,
        estimatedTime: t("wf_fullstack_step2_time"),
      },
      {
        id: "backend-dev",
        title: t("wf_fullstack_step3_title"),
        instruction: t("wf_fullstack_step3_instruction"),
        prompt:
          "实现后端逻辑：\n1. 数据库连接和模型\n2. API 路由和中间件\n3. 业务逻辑层\n4. 错误处理",
        tools: ["terminal", "file-write"],
        status: "pending",
        interventionLevel: 0,
        estimatedTime: t("wf_fullstack_step3_time"),
      },
      {
        id: "frontend-dev",
        title: t("wf_fullstack_step4_title"),
        instruction: t("wf_fullstack_step4_instruction"),
        prompt: "实现前端功能：\n1. 页面布局和路由\n2. 组件开发\n3. 状态管理\n4. API 集成",
        tools: ["file-write", "browser"],
        status: "pending",
        interventionLevel: 0,
        estimatedTime: t("wf_fullstack_step4_time"),
      },
      {
        id: "testing",
        title: t("wf_fullstack_step5_title"),
        instruction: t("wf_fullstack_step5_instruction"),
        prompt: "执行测试和优化：\n1. 单元测试\n2. 集成测试\n3. E2E 测试\n4. 性能检查",
        tools: ["terminal", "file-read"],
        status: "pending",
        interventionLevel: 1,
        estimatedTime: t("wf_fullstack_step5_time"),
      },
    ],
  },
  {
    id: "code-review",
    name: t("wf_review_name"),
    description: t("wf_review_desc"),
    category: "review",
    icon: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z",
    estimatedTime: t("wf_review_time"),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    steps: [
      {
        id: "security-review",
        title: t("wf_review_step1_title"),
        instruction: t("wf_review_step1_instruction"),
        prompt:
          "执行安全审查：\n1. SQL/NoSQL 注入检查\n2. XSS 跨站脚本检查\n3. CSRF 令牌验证\n4. 敏感信息硬编码检查\n5. 依赖漏洞扫描",
        tools: ["file-read", "search"],
        status: "pending",
        interventionLevel: 2,
        estimatedTime: t("wf_review_step1_time"),
      },
      {
        id: "performance-review",
        title: t("wf_review_step2_title"),
        instruction: t("wf_review_step2_instruction"),
        prompt:
          "执行性能审查：\n1. 数据库查询分析\n2. N+1 查询问题\n3. 缓存使用情况\n4. 异步处理检查\n5. 前端加载性能",
        tools: ["terminal", "file-read"],
        status: "pending",
        interventionLevel: 1,
        estimatedTime: t("wf_review_step2_time"),
      },
      {
        id: "style-review",
        title: t("wf_review_step3_title"),
        instruction: t("wf_review_step3_instruction"),
        prompt:
          "执行代码风格审查：\n1. 命名规范一致性\n2. 代码可读性\n3. 注释完整性\n4. 重复代码检测\n5. 架构模式遵循",
        tools: ["file-read"],
        status: "pending",
        interventionLevel: 0,
        estimatedTime: t("wf_review_step3_time"),
      },
      {
        id: "summary",
        title: t("wf_review_step4_title"),
        instruction: t("wf_review_step4_instruction"),
        prompt: "生成审查报告：\n1. 按严重程度分类（高/中/低）\n2. 提供修复建议\n3. 优先级排序",
        tools: ["file-write"],
        status: "pending",
        interventionLevel: 1,
        estimatedTime: t("wf_review_step4_time"),
      },
    ],
  },
  {
    id: "testing-suite",
    name: t("wf_testing_name"),
    description: t("wf_testing_desc"),
    category: "testing",
    icon: "M9 3h6M12 3v7l-4 8h8l-4-8V3",
    estimatedTime: t("wf_testing_time"),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    steps: [
      {
        id: "unit-tests",
        title: t("wf_testing_step1_title"),
        instruction: t("wf_testing_step1_instruction"),
        prompt:
          "编写单元测试：\n1. 识别核心业务函数\n2. 覆盖正常路径\n3. 覆盖边界条件\n4. Mock 外部依赖\n5. 确保覆盖率 > 80%",
        tools: ["file-read", "file-write", "terminal"],
        status: "pending",
        interventionLevel: 0,
        estimatedTime: t("wf_testing_step1_time"),
      },
      {
        id: "integration-tests",
        title: t("wf_testing_step2_title"),
        instruction: t("wf_testing_step2_instruction"),
        prompt:
          "执行集成测试：\n1. 数据库交互测试\n2. API 端点测试\n3. 认证授权测试\n4. 错误处理测试",
        tools: ["terminal"],
        status: "pending",
        interventionLevel: 0,
        estimatedTime: t("wf_testing_step2_time"),
      },
      {
        id: "e2e-tests",
        title: t("wf_testing_step3_title"),
        instruction: t("wf_testing_step3_instruction"),
        prompt: "执行 E2E 测试：\n1. 关键用户路径\n2. 表单提交流程\n3. 导航流程\n4. 错误恢复流程",
        tools: ["terminal", "browser"],
        status: "pending",
        interventionLevel: 1,
        estimatedTime: t("wf_testing_step3_time"),
      },
    ],
  },
  {
    id: "documentation",
    name: t("wf_docs_name"),
    description: t("wf_docs_desc"),
    category: "documentation",
    icon: "M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zM14 2v6h6M16 13H8M16 17H8M10 9H8",
    estimatedTime: t("wf_docs_time"),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    steps: [
      {
        id: "api-docs",
        title: t("wf_docs_step1_title"),
        instruction: t("wf_docs_step1_instruction"),
        prompt:
          "生成 API 文档：\n1. 接口列表和描述\n2. 请求参数说明\n3. 响应格式示例\n4. 错误码说明",
        tools: ["file-read", "file-write"],
        status: "pending",
        interventionLevel: 0,
        estimatedTime: t("wf_docs_step1_time"),
      },
      {
        id: "readme",
        title: t("wf_docs_step2_title"),
        instruction: t("wf_docs_step2_instruction"),
        prompt: "编写 README：\n1. 项目简介\n2. 功能特性\n3. 快速开始\n4. 开发指南\n5. 贡献指南",
        tools: ["file-read", "file-write"],
        status: "pending",
        interventionLevel: 1,
        estimatedTime: t("wf_docs_step2_time"),
      },
      {
        id: "changelog",
        title: t("wf_docs_step3_title"),
        instruction: t("wf_docs_step3_instruction"),
        prompt:
          "生成 CHANGELOG：\n1. 读取 git commits\n2. 按版本分组\n3. 新增/改进/修复分类\n4. 保持格式规范",
        tools: ["terminal", "file-write"],
        status: "pending",
        interventionLevel: 0,
        estimatedTime: t("wf_docs_step3_time"),
      },
    ],
  },
  {
    id: "deploy",
    name: t("wf_deploy_name"),
    description: t("wf_deploy_desc"),
    category: "deployment",
    icon: "M4 14l4-4 4 4M8 10V3l10 10h-7v7L4 10h4",
    estimatedTime: t("wf_deploy_time"),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    steps: [
      {
        id: "pre-deploy-check",
        title: t("wf_deploy_step1_title"),
        instruction: t("wf_deploy_step1_instruction"),
        prompt:
          "执行部署前检查：\n1. 所有测试通过\n2. 依赖已安装\n3. 环境变量配置\n4. 数据库迁移\n5. 回滚方案准备",
        tools: ["terminal"],
        status: "pending",
        interventionLevel: 2,
        estimatedTime: t("wf_deploy_step1_time"),
      },
      {
        id: "build",
        title: t("wf_deploy_step2_title"),
        instruction: t("wf_deploy_step2_instruction"),
        prompt:
          "执行生产构建：\n1. 清理缓存\n2. 依赖安装\n3. 代码编译/打包\n4. 资源优化\n5. 生成构建产物",
        tools: ["terminal"],
        status: "pending",
        interventionLevel: 0,
        estimatedTime: t("wf_deploy_step2_time"),
      },
      {
        id: "deploy-execute",
        title: t("wf_deploy_step3_title"),
        instruction: t("wf_deploy_step3_instruction"),
        prompt: "执行部署：\n1. 连接部署服务器\n2. 上传构建产物\n3. 执行部署脚本\n4. 健康检查",
        tools: ["terminal"],
        status: "pending",
        interventionLevel: 1,
        estimatedTime: t("wf_deploy_step3_time"),
      },
      {
        id: "deploy-verify",
        title: t("wf_deploy_step4_title"),
        instruction: t("wf_deploy_step4_instruction"),
        prompt: "验证部署：\n1. 服务启动检查\n2. 端到端测试\n3. 日志检查\n4. 性能基线对比",
        tools: ["terminal", "browser"],
        status: "pending",
        interventionLevel: 1,
        estimatedTime: t("wf_deploy_step4_time"),
      },
    ],
  },
];

function createWorkflowStore() {
  const state = $state<WorkflowState>({
    templates: defaultTemplates,
    activeInstance: null,
    currentContext: {
      relevantFiles: [],
      customContext: {},
    },
    isExecuting: false,
    error: null,
  });

  return {
    get state() {
      return state;
    },

    get templates() {
      return state.templates;
    },

    get activeTemplate(): WorkflowTemplate | null {
      if (!state.activeInstance) return null;
      return state.templates.find((t) => t.id === state.activeInstance!.templateId) ?? null;
    },

    get currentStep(): WorkflowStep | null {
      const template = this.activeTemplate;
      if (!template || !state.activeInstance) return null;
      return template.steps[state.activeInstance.currentStepIndex] ?? null;
    },

    get progress(): number {
      const template = this.activeTemplate;
      if (!template || !state.activeInstance) return 0;
      const completed = template.steps.filter(
        (s) => s.status === "completed" || s.status === "skipped",
      ).length;
      return Math.round((completed / template.steps.length) * 100);
    },

    get isRunning(): boolean {
      return state.activeInstance?.status === "running";
    },

    get isWaiting(): boolean {
      return state.activeInstance?.status === "waiting";
    },

    // Start a workflow from template
    startWorkflow(templateId: string): boolean {
      const template = state.templates.find((t) => t.id === templateId);
      if (!template) {
        state.error = t("wf_templateNotFound");
        return false;
      }

      // Reset all steps to pending
      const steps: WorkflowStep[] = template.steps.map((s) => ({
        ...s,
        status: "pending" as const,
      }));

      state.activeInstance = {
        id: crypto.randomUUID(),
        templateId,
        templateName: template.name,
        currentStepIndex: 0,
        status: "idle",
        interventionLevel: steps[0]?.interventionLevel ?? 1,
        state: {},
        startedAt: null,
        completedAt: null,
        checkpoints: [],
      };

      // Activate first step
      if (steps.length > 0) {
        steps[0].status = "active";
      }

      // Update template with reset steps
      const templateIndex = state.templates.findIndex((t) => t.id === templateId);
      if (templateIndex !== -1) {
        state.templates[templateIndex].steps = steps;
      }

      state.error = null;
      return true;
    },

    // Resume workflow
    resumeWorkflow(): void {
      if (!state.activeInstance) return;
      state.activeInstance.status = "running";
      state.activeInstance.interventionLevel = this.currentStep?.interventionLevel ?? 1;
    },

    // Pause workflow
    pauseWorkflow(): void {
      if (!state.activeInstance) return;
      state.activeInstance.status = "paused";
    },

    // Go to next step
    async nextStep(output?: Record<string, unknown>): Promise<boolean> {
      const template = this.activeTemplate;
      if (!template || !state.activeInstance) return false;

      const currentIndex = state.activeInstance.currentStepIndex;
      const currentStep = template.steps[currentIndex];

      if (currentStep) {
        currentStep.status = "completed";
        currentStep.output = output ?? undefined;
      }

      // Create checkpoint
      const checkpoint: WorkflowCheckpoint = {
        stepIndex: currentIndex,
        stepId: currentStep?.id ?? "",
        completed: true,
        output: output ?? null,
        timestamp: new Date().toISOString(),
        context: { ...state.currentContext.customContext },
      };
      state.activeInstance.checkpoints.push(checkpoint);

      // Move to next step
      const nextIndex = currentIndex + 1;
      if (nextIndex >= template.steps.length) {
        // Workflow complete
        state.activeInstance.status = "completed";
        state.activeInstance.completedAt = new Date().toISOString();
        return true;
      }

      state.activeInstance.currentStepIndex = nextIndex;
      state.activeInstance.status = "running";
      state.activeInstance.interventionLevel = template.steps[nextIndex].interventionLevel;

      template.steps[nextIndex].status = "active";
      return false;
    },

    // Go to previous step
    prevStep(): void {
      const template = this.activeTemplate;
      if (!template || !state.activeInstance) return;

      const currentIndex = state.activeInstance.currentStepIndex;
      if (currentIndex <= 0) return;

      const currentStep = template.steps[currentIndex];
      currentStep.status = "pending";

      const prevIndex = currentIndex - 1;
      state.activeInstance.currentStepIndex = prevIndex;
      state.activeInstance.status = "running";
      state.activeInstance.interventionLevel = template.steps[prevIndex].interventionLevel;

      template.steps[prevIndex].status = "active";
    },

    // Jump to specific step
    jumpToStep(index: number): void {
      const template = this.activeTemplate;
      if (!template || !state.activeInstance) return;
      if (index < 0 || index >= template.steps.length) return;

      const currentIndex = state.activeInstance.currentStepIndex;
      if (currentIndex !== index) {
        template.steps[currentIndex].status = "pending";
      }

      state.activeInstance.currentStepIndex = index;
      state.activeInstance.status = "running";
      state.activeInstance.interventionLevel = template.steps[index].interventionLevel;

      template.steps[index].status = "active";
    },

    // Skip current step
    skipStep(): void {
      const template = this.activeTemplate;
      if (!template || !state.activeInstance) return;

      const currentIndex = state.activeInstance.currentStepIndex;
      template.steps[currentIndex].status = "skipped";

      // Save checkpoint
      const checkpoint: WorkflowCheckpoint = {
        stepIndex: currentIndex,
        stepId: template.steps[currentIndex].id,
        completed: false,
        output: null,
        timestamp: new Date().toISOString(),
        context: { ...state.currentContext.customContext },
      };
      state.activeInstance.checkpoints.push(checkpoint);

      // Move to next
      const nextIndex = currentIndex + 1;
      if (nextIndex >= template.steps.length) {
        state.activeInstance.status = "completed";
        state.activeInstance.completedAt = new Date().toISOString();
        return;
      }

      state.activeInstance.currentStepIndex = nextIndex;
      state.activeInstance.interventionLevel = template.steps[nextIndex].interventionLevel;
      template.steps[nextIndex].status = "active";
    },

    // Mark current step as failed
    failStep(error: string): void {
      const template = this.activeTemplate;
      if (!template || !state.activeInstance) return;

      const currentIndex = state.activeInstance.currentStepIndex;
      template.steps[currentIndex].status = "failed";
      state.activeInstance.status = "paused";
      state.error = error;
    },

    // Set waiting for human intervention
    waitForIntervention(): void {
      if (!state.activeInstance) return;
      state.activeInstance.status = "waiting";
    },

    // Update workflow state
    updateState(key: string, value: unknown): void {
      if (!state.activeInstance) return;
      state.activeInstance.state[key] = value;
    },

    // Update context
    updateContext(context: Partial<WorkflowContext>): void {
      state.currentContext = { ...state.currentContext, ...context };
    },

    // Cancel workflow
    cancelWorkflow(): void {
      if (!state.activeInstance) return;
      state.activeInstance.status = "cancelled";
      state.activeInstance.completedAt = new Date().toISOString();
    },

    // Reset workflow
    resetWorkflow(): void {
      if (!state.activeInstance) return;
      const templateId = state.activeInstance.templateId;
      const template = state.templates.find((t) => t.id === templateId);
      if (template) {
        template.steps.forEach((s) => (s.status = "pending"));
      }
      state.activeInstance = null;
      state.error = null;
    },

    // Clear error
    clearError(): void {
      state.error = null;
    },

    // Restore from checkpoint
    restoreFromCheckpoint(checkpointIndex: number): void {
      if (!state.activeInstance) return;
      const checkpoint = state.activeInstance.checkpoints[checkpointIndex];
      if (!checkpoint) return;

      state.activeInstance.currentStepIndex = checkpoint.stepIndex;
      state.activeInstance.status = "running";

      const template = this.activeTemplate;
      if (template) {
        // Reset subsequent steps
        template.steps.forEach((s, i) => {
          if (i > checkpoint.stepIndex) {
            s.status = "pending";
          }
        });
        template.steps[checkpoint.stepIndex].status = "active";
      }
    },

    // Get checkpoint history
    getCheckpointHistory(): WorkflowCheckpoint[] {
      return state.activeInstance?.checkpoints ?? [];
    },
  };
}

export const workflowStore = createWorkflowStore();
