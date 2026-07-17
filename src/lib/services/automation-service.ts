/**
 * Automation Service - Script execution engine
 *
 * Executes automation scripts using browser automation tools.
 */
import type {
  AutomationScript,
  AutomationStep,
  StepResult,
  ExecutionResult,
  StepType,
} from "$lib/types/automation";
import { dbg, dbgWarn } from "$lib/utils/debug";

const TAG = "automation-service";

// MCP Chrome function types
declare function mcp__Claude_in_Chrome__navigate(args: {
  url: string;
  tabId: number;
}): Promise<unknown>;

declare function mcp__Claude_in_Chrome__computer(args: {
  action: string;
  coordinate?: [number, number];
  text?: string;
  tabId: number;
  scroll_direction?: string;
  scroll_amount?: number;
  save_to_disk?: boolean;
  region?: [number, number, number, number];
  duration?: number;
  start_coordinate?: [number, number];
}): Promise<unknown>;

declare function mcp__Claude_in_Chrome__find(args: {
  query: string;
  tabId: number;
}): Promise<unknown>;

declare function mcp__Claude_in_Chrome__tabs_context_mcp(args: {
  createIfEmpty?: boolean;
}): Promise<{ tabs: Array<{ id: number; url?: string }> }>;

declare function _mcp__Claude_in_Chrome__tabs_create_mcp(
  args: Record<string, unknown>,
): Promise<{ id: number }>;

declare function mcp__Claude_in_Chrome__tabs_close_mcp(args: { tabId: number }): Promise<unknown>;

declare function mcp__Claude_in_Chrome__javascript_tool(args: {
  action: string;
  text: string;
  tabId: number;
}): Promise<unknown>;

// Execution state
let isExecuting = false;
let activeController: AbortController | null = null;

const DEFAULT_STEP_TIMEOUT_MS = 30_000;

export interface ExecuteOptions {
  /** AbortSignal to cancel execution externally. If omitted, an internal
   *  controller is created and exposed via cancelExecution(). */
  signal?: AbortSignal;
  onStepStart?: (step: AutomationStep, index: number) => void;
  onStepComplete?: (step: AutomationStep, result: StepResult) => void;
  onProgress?: (progress: number, message: string) => void;
  onError?: (error: Error) => void;
}

/**
 * Execute an automation script
 */
export async function executeScript(
  script: AutomationScript,
  tabId: number,
  options: ExecuteOptions = {},
): Promise<ExecutionResult> {
  if (isExecuting) {
    throw new Error("Another script is already executing");
  }

  isExecuting = true;
  const controller = new AbortController();
  activeController = controller;
  const signal = options.signal ?? controller.signal;

  const startTime = Date.now();
  const results: StepResult[] = [];
  let completedSteps = 0;
  let failedSteps = 0;

  dbg(TAG, "Starting script execution", script.name);

  try {
    for (let i = 0; i < script.steps.length; i++) {
      if (signal.aborted) {
        dbg(TAG, "Script execution cancelled");
        break;
      }

      const step = script.steps[i];

      if (!step.enabled) {
        dbg(TAG, "Skipping disabled step", step.order);
        continue;
      }

      options.onStepStart?.(step, i);
      options.onProgress?.(
        (i / script.steps.length) * 100,
        `Executing step ${i + 1}: ${step.description || step.type}`,
      );

      const stepStartTime = Date.now();

      try {
        const result = await executeStep(step, tabId, signal);

        const stepResult: StepResult = {
          stepId: step.id,
          success: true,
          result,
          duration: Date.now() - stepStartTime,
        };

        results.push(stepResult);
        completedSteps++;

        options.onStepComplete?.(step, stepResult);
        options.onProgress?.(
          ((i + 1) / script.steps.length) * 100,
          `Completed step ${i + 1}: ${step.description || step.type}`,
        );
      } catch (error) {
        const stepResult: StepResult = {
          stepId: step.id,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          duration: Date.now() - stepStartTime,
        };

        results.push(stepResult);
        failedSteps++;

        dbgWarn(TAG, `Step ${step.order} failed:`, error);

        if (step.onError === "stop" || error instanceof Error === false) {
          throw error;
        }

        options.onError?.(error instanceof Error ? error : new Error(String(error)));
      }
    }

    const duration = Date.now() - startTime;
    const success = failedSteps === 0 && !signal.aborted;

    dbg(TAG, "Script execution complete", { success, completedSteps, failedSteps });

    return {
      scriptId: script.id,
      success,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
      duration,
      results,
      totalSteps: script.steps.length,
      completedSteps,
      failedSteps,
    };
  } finally {
    isExecuting = false;
    activeController = null;
  }
}

/**
 * Execute a single step with timeout + cancel signal.
 * The combined signal aborts on whichever fires first: step timeout or cancel.
 */
async function executeStep(
  step: AutomationStep,
  tabId: number,
  cancelSignal: AbortSignal,
): Promise<unknown> {
  const timeoutMs = step.timeout ?? DEFAULT_STEP_TIMEOUT_MS;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  // AbortSignal.any merges multiple signals — aborts when any source aborts.
  const combined = AbortSignal.any([cancelSignal, timeoutSignal]);

  return new Promise((resolve, reject) => {
    combined.addEventListener(
      "abort",
      () => {
        const reason = cancelSignal.aborted
          ? "Step cancelled"
          : `Step timed out after ${timeoutMs}ms`;
        reject(new Error(reason));
      },
      { once: true },
    );

    doExecuteStep(step, tabId).then(resolve, reject);
  });
}

/**
 * Internal step execution
 */
async function doExecuteStep(step: AutomationStep, tabId: number): Promise<unknown> {
  switch (step.type) {
    case "navigate":
      return executeNavigate(step, tabId);

    case "click":
      return executeClick(step, tabId);

    case "double_click":
      return executeDoubleClick(step, tabId);

    case "right_click":
      return executeRightClick(step, tabId);

    case "type":
      return executeType(step, tabId);

    case "wait":
      return executeWait(step);

    case "scroll":
      return executeScroll(step, tabId);

    case "screenshot":
      return executeScreenshot(step, tabId);

    case "find":
      return executeFind(step, tabId);

    case "hover":
      return executeHover(step, tabId);

    case "drag_drop":
      return executeDragDrop(step, tabId);

    case "execute_js":
      return executeJavaScript(step, tabId);

    case "switch_tab":
      return executeSwitchTab(step);

    case "close_tab":
      return executeCloseTab(step);

    case "upload_file":
      return executeUploadFile(step, tabId);

    case "select_option":
      return executeSelectOption(step, tabId);

    default:
      throw new Error(`Unknown step type: ${step.type}`);
  }
}

// ── Step Executors ──

async function executeNavigate(step: AutomationStep, tabId: number): Promise<unknown> {
  const url = step.params.url;
  if (!url) {
    throw new Error("Navigate step requires URL parameter");
  }

  dbg(TAG, "Navigating to", url);
  return mcp__Claude_in_Chrome__navigate({ url, tabId });
}

async function executeClick(step: AutomationStep, tabId: number): Promise<unknown> {
  const coordinate = step.params.coordinate;
  if (!coordinate) {
    throw new Error("Click step requires coordinate parameter");
  }

  dbg(TAG, "Clicking at", coordinate);
  return mcp__Claude_in_Chrome__computer({
    action: "left_click",
    coordinate,
    tabId,
  });
}

async function executeDoubleClick(step: AutomationStep, tabId: number): Promise<unknown> {
  const coordinate = step.params.coordinate;
  if (!coordinate) {
    throw new Error("Double click step requires coordinate parameter");
  }

  dbg(TAG, "Double clicking at", coordinate);
  return mcp__Claude_in_Chrome__computer({
    action: "double_click",
    coordinate,
    tabId,
  });
}

async function executeRightClick(step: AutomationStep, tabId: number): Promise<unknown> {
  const coordinate = step.params.coordinate;
  if (!coordinate) {
    throw new Error("Right click step requires coordinate parameter");
  }

  dbg(TAG, "Right clicking at", coordinate);
  return mcp__Claude_in_Chrome__computer({
    action: "right_click",
    coordinate,
    tabId,
  });
}

async function executeType(step: AutomationStep, tabId: number): Promise<unknown> {
  const text = step.params.text;
  if (!text) {
    throw new Error("Type step requires text parameter");
  }

  dbg(TAG, "Typing text");
  return mcp__Claude_in_Chrome__computer({
    action: "type",
    text,
    tabId,
  });
}

async function executeWait(step: AutomationStep): Promise<void> {
  const duration = step.params.duration ?? 1000;
  dbg(TAG, `Waiting ${duration}ms`);
  return new Promise((resolve) => setTimeout(resolve, duration));
}

async function executeScroll(step: AutomationStep, tabId: number): Promise<unknown> {
  const direction = step.params.direction ?? "down";
  const scrollAmount = step.params.scrollAmount ?? 3;
  const coordinate = step.params.coordinate ?? [500, 300];

  dbg(TAG, `Scrolling ${direction}`);
  return mcp__Claude_in_Chrome__computer({
    action: "scroll",
    coordinate,
    scroll_direction: direction,
    scroll_amount: scrollAmount,
    tabId,
  });
}

async function executeScreenshot(step: AutomationStep, tabId: number): Promise<unknown> {
  const region = step.params.region;
  const _fullPage = step.params.fullPage ?? false;

  dbg(TAG, "Taking screenshot");
  return mcp__Claude_in_Chrome__computer({
    action: "screenshot",
    tabId,
    save_to_disk: true,
    ...(region && { region }),
  });
}

async function executeFind(step: AutomationStep, tabId: number): Promise<unknown> {
  const query = step.params.query;
  if (!query) {
    throw new Error("Find step requires query parameter");
  }

  dbg(TAG, "Finding elements", query);
  return mcp__Claude_in_Chrome__find({ query, tabId });
}

async function executeHover(step: AutomationStep, tabId: number): Promise<unknown> {
  const coordinate = step.params.coordinate;
  if (!coordinate) {
    throw new Error("Hover step requires coordinate parameter");
  }

  dbg(TAG, "Hovering at", coordinate);
  return mcp__Claude_in_Chrome__computer({
    action: "hover",
    coordinate,
    tabId,
  });
}

async function executeDragDrop(step: AutomationStep, tabId: number): Promise<unknown> {
  const start = step.params.startCoordinate;
  const end = step.params.endCoordinate;

  if (!start || !end) {
    throw new Error("Drag drop step requires start and end coordinates");
  }

  dbg(TAG, "Dragging from", start, "to", end);
  return mcp__Claude_in_Chrome__computer({
    action: "left_click_drag",
    coordinate: end,
    start_coordinate: start,
    tabId,
  });
}

async function executeJavaScript(step: AutomationStep, tabId: number): Promise<unknown> {
  const script = step.params.script;
  if (!script) {
    throw new Error("Execute JS step requires script parameter");
  }

  dbg(TAG, "Executing JavaScript");
  return mcp__Claude_in_Chrome__javascript_tool({
    action: "javascript_exec",
    text: script,
    tabId,
  });
}

async function executeSwitchTab(step: AutomationStep): Promise<number> {
  const tabId = step.params.tabId;
  if (tabId === undefined) {
    throw new Error("Switch tab step requires tabId parameter");
  }

  const context = await mcp__Claude_in_Chrome__tabs_context_mcp({});
  const tabs = context.tabs;

  if (tabId < 0 || tabId >= tabs.length) {
    throw new Error(`Invalid tab index: ${tabId}`);
  }

  dbg(TAG, "Switching to tab", tabId);
  return tabId;
}

async function executeCloseTab(step: AutomationStep): Promise<void> {
  const tabId = step.params.tabId;
  if (tabId === undefined) {
    throw new Error("Close tab step requires tabId parameter");
  }

  dbg(TAG, "Closing tab", tabId);
  await mcp__Claude_in_Chrome__tabs_close_mcp({ tabId });
}

async function executeUploadFile(step: AutomationStep, _tabId: number): Promise<void> {
  const filePath = step.params.filePath;
  const _coordinate = step.params.coordinate;

  if (!filePath) {
    throw new Error("Upload file step requires filePath parameter");
  }

  // Note: Actual file upload requires the file_upload tool
  dbg(TAG, "File upload would be executed for", filePath);
  throw new Error("File upload requires interactive element");
}

async function executeSelectOption(step: AutomationStep, tabId: number): Promise<void> {
  const ref = step.params.ref;
  const value = step.params.value;

  if (!ref || (!value && step.params.index === undefined)) {
    throw new Error("Select option step requires ref and value/index parameters");
  }

  // Use JavaScript to select the option
  const script = `
    const select = document.querySelector('${ref}');
    if (select) {
      ${value ? `select.value = '${value}';` : `select.selectedIndex = ${step.params.index};`}
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  `;

  dbg(TAG, "Selecting option");
  await mcp__Claude_in_Chrome__javascript_tool({
    action: "javascript_exec",
    text: script,
    tabId,
  });
}

// ── Utility Functions ──

/**
 * Cancel ongoing execution via AbortController.
 */
export function cancelExecution(): void {
  if (activeController) {
    activeController.abort();
    dbg(TAG, "Execution cancel requested via AbortController");
  }
}

/**
 * Get current execution state
 */
export function getExecutionState(): { isExecuting: boolean } {
  return { isExecuting };
}

/**
 * Create a recording session step from browser interaction
 */
export function createStepFromInteraction(
  type: StepType,
  params: Record<string, unknown>,
  description: string,
): AutomationStep {
  return {
    id: `step_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    order: 0,
    type,
    params,
    description,
    onError: "continue",
    enabled: true,
  };
}

/**
 * Validate a script before execution
 */
export function validateScript(script: AutomationScript): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!script.name) {
    errors.push("Script name is required");
  }

  if (!script.steps || script.steps.length === 0) {
    errors.push("Script must have at least one step");
  }

  for (let i = 0; i < script.steps.length; i++) {
    const step = script.steps[i];

    if (!step.type) {
      errors.push(`Step ${i + 1}: Type is required`);
    }

    // Validate required params based on step type
    if (step.type === "navigate" && !step.params.url) {
      errors.push(`Step ${i + 1}: Navigate step requires URL`);
    }

    if (
      (step.type === "click" ||
        step.type === "double_click" ||
        step.type === "right_click" ||
        step.type === "hover") &&
      !step.params.coordinate
    ) {
      errors.push(`Step ${i + 1}: ${step.type} step requires coordinate`);
    }

    if (step.type === "type" && !step.params.text) {
      errors.push(`Step ${i + 1}: Type step requires text`);
    }

    if (step.type === "find" && !step.params.query) {
      errors.push(`Step ${i + 1}: Find step requires query`);
    }

    if (step.type === "execute_js" && !step.params.script) {
      errors.push(`Step ${i + 1}: Execute JS step requires script`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Generate a summary of what the script will do
 */
export function generateScriptSummary(script: AutomationScript): string {
  const stepCount = script.steps.length;
  const types = [...new Set(script.steps.map((s) => s.type))];

  return `${script.name} (${stepCount} steps: ${types.join(", ")})`;
}
