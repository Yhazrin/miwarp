/**
 * Automation Script Types
 *
 * Type definitions for browser automation scripts.
 * Based on Claude Cowork design patterns.
 */
import type { LucideIconName } from "$lib/lucide-icon";

export type AutomationCategory =
  | "web_scraping"
  | "form_automation"
  | "testing"
  | "data_entry"
  | "monitoring"
  | "custom";

export type StepType =
  | "navigate"
  | "click"
  | "double_click"
  | "right_click"
  | "type"
  | "wait"
  | "scroll"
  | "screenshot"
  | "find"
  | "hover"
  | "drag_drop"
  | "execute_js"
  | "switch_tab"
  | "close_tab"
  | "upload_file"
  | "select_option";

export type ErrorStrategy = "continue" | "stop" | "retry";

export interface StepParams {
  // Navigation
  url?: string;

  // Click/Type
  coordinate?: [number, number];
  text?: string;
  ref?: string;

  // Find
  query?: string;

  // Scroll
  direction?: "up" | "down" | "left" | "right";
  scrollAmount?: number;

  // JavaScript
  script?: string;

  // Tab
  tabId?: number;

  // Screenshot
  region?: [number, number, number, number];
  fullPage?: boolean;

  // Wait
  duration?: number;
  condition?: "element_visible" | "network_idle" | "timeout";

  // Drag Drop
  startCoordinate?: [number, number];
  endCoordinate?: [number, number];

  // Upload
  filePath?: string;

  // Select
  value?: string;
  index?: number;
}

export interface RetryPolicy {
  maxAttempts: number;
  backoffMs: number;
  exponential?: boolean;
}

export interface AutomationStep {
  id: string;
  order: number;
  type: StepType;
  params: StepParams;
  description: string;
  timeout?: number;
  retryPolicy?: RetryPolicy;
  onError: ErrorStrategy;
  enabled: boolean;
}

export interface LoopConfig {
  type: "for" | "while" | "until";
  iterations?: number;
  condition?: string;
  steps: AutomationStep[];
}

export interface ErrorConfig {
  maxRetries: number;
  retryDelay: number;
  continueOnError: boolean;
  notifyOnFailure: boolean;
}

export interface AutomationScript {
  id: string;
  name: string;
  description: string;
  category: AutomationCategory;
  steps: AutomationStep[];
  loops?: LoopConfig[];
  errorHandling?: ErrorConfig;
  createdAt: string;
  updatedAt: string;
  tags: string[];
  usageCount: number;
  lastRunAt?: string;
  status: "idle" | "ready" | "running" | "failed";
}

// Execution types
export interface StepResult {
  stepId: string;
  success: boolean;
  result?: unknown;
  error?: string;
  duration: number;
  screenshot?: string;
}

export interface ExecutionResult {
  scriptId: string;
  success: boolean;
  startedAt: string;
  completedAt?: string;
  duration: number;
  results: StepResult[];
  totalSteps: number;
  completedSteps: number;
  failedSteps: number;
  error?: string;
}

export interface ExecutionProgress {
  scriptId: string;
  currentStepIndex: number;
  currentStep: AutomationStep | null;
  progress: number;
  status: "running" | "paused" | "completed" | "failed";
  elapsedMs: number;
  estimatedRemainingMs: number;
}

// Recording types
export interface RecordingSession {
  id: string;
  startedAt: string;
  steps: AutomationStep[];
  tabId?: number;
  status: "recording" | "paused" | "stopped";
}

export interface RecordedStep {
  type: StepType;
  params: StepParams;
  timestamp: number;
  description: string;
}

// Category metadata
export interface CategoryInfo {
  value: AutomationCategory;
  label: string;
  labelZh: string;
  icon: LucideIconName;
  description: string;
}

export const AUTOMATION_CATEGORIES: CategoryInfo[] = [
  {
    value: "web_scraping",
    label: "Web Scraping",
    labelZh: "网页抓取",
    icon: "network",
    description: "Extract data from websites",
  },
  {
    value: "form_automation",
    label: "Form Automation",
    labelZh: "表单自动化",
    icon: "file-text",
    description: "Fill forms automatically",
  },
  {
    value: "testing",
    label: "Testing",
    labelZh: "测试",
    icon: "flask-conical",
    description: "Automated testing workflows",
  },
  {
    value: "data_entry",
    label: "Data Entry",
    labelZh: "数据录入",
    icon: "bar-chart-2",
    description: "Batch data entry tasks",
  },
  {
    value: "monitoring",
    label: "Monitoring",
    labelZh: "监控",
    icon: "eye",
    description: "Website monitoring tasks",
  },
  {
    value: "custom",
    label: "Custom",
    labelZh: "自定义",
    icon: "settings",
    description: "Custom automation scripts",
  },
];

// Step type metadata
export interface StepTypeInfo {
  value: StepType;
  label: string;
  labelZh: string;
  icon: LucideIconName;
  description: string;
  paramFields: (keyof StepParams)[];
}

export const STEP_TYPES: StepTypeInfo[] = [
  {
    value: "navigate",
    label: "Navigate",
    labelZh: "导航",
    icon: "globe",
    description: "Navigate to a URL",
    paramFields: ["url"],
  },
  {
    value: "click",
    label: "Click",
    labelZh: "点击",
    icon: "mouse-pointer-click",
    description: "Click on an element",
    paramFields: ["coordinate", "ref"],
  },
  {
    value: "type",
    label: "Type",
    labelZh: "输入",
    icon: "keyboard",
    description: "Type text into an element",
    paramFields: ["text", "coordinate"],
  },
  {
    value: "wait",
    label: "Wait",
    labelZh: "等待",
    icon: "timer",
    description: "Wait for a duration or condition",
    paramFields: ["duration", "condition"],
  },
  {
    value: "scroll",
    label: "Scroll",
    labelZh: "滚动",
    icon: "scroll-text",
    description: "Scroll the page",
    paramFields: ["direction", "scrollAmount", "coordinate"],
  },
  {
    value: "screenshot",
    label: "Screenshot",
    labelZh: "截图",
    icon: "camera",
    description: "Take a screenshot",
    paramFields: ["region", "fullPage"],
  },
  {
    value: "find",
    label: "Find Element",
    labelZh: "查找元素",
    icon: "search",
    description: "Find an element on the page",
    paramFields: ["query"],
  },
  {
    value: "execute_js",
    label: "Execute JS",
    labelZh: "执行 JS",
    icon: "scroll-text",
    description: "Execute JavaScript code",
    paramFields: ["script"],
  },
  {
    value: "switch_tab",
    label: "Switch Tab",
    labelZh: "切换标签",
    icon: "layout",
    description: "Switch to a different tab",
    paramFields: ["tabId"],
  },
  {
    value: "close_tab",
    label: "Close Tab",
    labelZh: "关闭标签",
    icon: "x",
    description: "Close a tab",
    paramFields: ["tabId"],
  },
  {
    value: "hover",
    label: "Hover",
    labelZh: "悬停",
    icon: "mouse-pointer-click",
    description: "Hover over an element",
    paramFields: ["coordinate"],
  },
  {
    value: "drag_drop",
    label: "Drag & Drop",
    labelZh: "拖拽",
    icon: "hand",
    description: "Drag and drop an element",
    paramFields: ["startCoordinate", "endCoordinate"],
  },
  {
    value: "double_click",
    label: "Double Click",
    labelZh: "双击",
    icon: "mouse-pointer-click",
    description: "Double click on an element",
    paramFields: ["coordinate", "ref"],
  },
  {
    value: "right_click",
    label: "Right Click",
    labelZh: "右键点击",
    icon: "mouse-pointer-2",
    description: "Right click on an element",
    paramFields: ["coordinate", "ref"],
  },
  {
    value: "upload_file",
    label: "Upload File",
    labelZh: "上传文件",
    icon: "folder-up",
    description: "Upload a file",
    paramFields: ["coordinate", "filePath"],
  },
  {
    value: "select_option",
    label: "Select Option",
    labelZh: "选择选项",
    icon: "chevron-down",
    description: "Select an option from dropdown",
    paramFields: ["ref", "value", "index"],
  },
];

// Helper functions
export function getCategoryInfo(category: AutomationCategory): CategoryInfo {
  return AUTOMATION_CATEGORIES.find((c) => c.value === category) || AUTOMATION_CATEGORIES[5];
}

export function getStepTypeInfo(type: StepType): StepTypeInfo {
  return STEP_TYPES.find((t) => t.value === type) || STEP_TYPES[0];
}

export function createEmptyStep(order: number): AutomationStep {
  return {
    id: `step_${Date.now()}_${order}`,
    order,
    type: "click",
    params: {},
    description: "",
    onError: "continue",
    enabled: true,
  };
}

export function createEmptyScript(): AutomationScript {
  return {
    id: `scr_${Date.now()}`,
    name: "New Automation",
    description: "",
    category: "custom",
    steps: [createEmptyStep(1)],
    tags: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    usageCount: 0,
    status: "idle",
  };
}
