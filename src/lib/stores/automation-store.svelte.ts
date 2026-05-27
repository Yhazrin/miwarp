/**
 * Automation Store - Svelte 5 state management for automation scripts
 *
 * Manages automation script creation, editing, and execution.
 */
import { createEmptyScript, createEmptyStep } from "$lib/types/automation";
import type {
  AutomationScript,
  AutomationStep,
  AutomationCategory,
  ExecutionProgress,
  RecordingSession,
} from "$lib/types/automation";
import { dbg, dbgWarn } from "$lib/utils/debug";

export interface AutomationState {
  scripts: AutomationScript[];
  activeScriptId: string | null;
  isRecording: boolean;
  isExecuting: boolean;
  executionProgress: ExecutionProgress | null;
  recordingSession: RecordingSession | null;
  error: string | null;
}

export type AutomationAction =
  | { type: "ADD_SCRIPT"; script: AutomationScript }
  | { type: "UPDATE_SCRIPT"; script: AutomationScript }
  | { type: "DELETE_SCRIPT"; scriptId: string }
  | { type: "SET_ACTIVE_SCRIPT"; scriptId: string | null }
  | { type: "START_RECORDING"; tabId?: number }
  | { type: "STOP_RECORDING" }
  | { type: "PAUSE_RECORDING" }
  | { type: "RESUME_RECORDING" }
  | { type: "ADD_RECORDED_STEP"; step: AutomationStep }
  | { type: "START_EXECUTION"; scriptId: string }
  | { type: "UPDATE_EXECUTION_PROGRESS"; progress: ExecutionProgress }
  | { type: "COMPLETE_EXECUTION"; scriptId: string }
  | { type: "FAIL_EXECUTION"; scriptId: string; error: string }
  | { type: "SET_ERROR"; error: string | null }
  | { type: "LOAD_SCRIPTS"; scripts: AutomationScript[] };

function createAutomationStore() {
  const state = $state<AutomationState>({
    scripts: [],
    activeScriptId: null,
    isRecording: false,
    isExecuting: false,
    executionProgress: null,
    recordingSession: null,
    error: null,
  });

  // ── Derived State ──

  const activeScript = $derived(
    state.activeScriptId
      ? (state.scripts.find((s) => s.id === state.activeScriptId) ?? null)
      : null,
  );

  const scriptsByCategory = $derived.by(() => {
    const grouped: Record<AutomationCategory, AutomationScript[]> = {
      web_scraping: [],
      form_automation: [],
      testing: [],
      data_entry: [],
      monitoring: [],
      custom: [],
    };
    for (const script of state.scripts) {
      grouped[script.category].push(script);
    }
    return grouped;
  });

  const recentScripts = $derived(
    [...state.scripts]
      .sort((a, b) => {
        const aTime = a.lastRunAt ? new Date(a.lastRunAt).getTime() : 0;
        const bTime = b.lastRunAt ? new Date(b.lastRunAt).getTime() : 0;
        return bTime - aTime;
      })
      .slice(0, 5),
  );

  const totalUsageCount = $derived(state.scripts.reduce((sum, s) => sum + s.usageCount, 0));

  // ── Reducers ──

  function dispatch(action: AutomationAction): void {
    switch (action.type) {
      case "ADD_SCRIPT":
        state.scripts.push(action.script);
        dbg("automation-store", "Added script", action.script.name);
        break;

      case "UPDATE_SCRIPT": {
        const index = state.scripts.findIndex((s) => s.id === action.script.id);
        if (index !== -1) {
          action.script.updatedAt = new Date().toISOString();
          state.scripts[index] = action.script;
          dbg("automation-store", "Updated script", action.script.name);
        }
        break;
      }

      case "DELETE_SCRIPT":
        state.scripts = state.scripts.filter((s) => s.id !== action.scriptId);
        if (state.activeScriptId === action.scriptId) {
          state.activeScriptId = null;
        }
        dbg("automation-store", "Deleted script", action.scriptId);
        break;

      case "SET_ACTIVE_SCRIPT":
        state.activeScriptId = action.scriptId;
        break;

      case "START_RECORDING":
        state.isRecording = true;
        state.recordingSession = {
          id: `rec_${Date.now()}`,
          startedAt: new Date().toISOString(),
          steps: [],
          tabId: action.tabId,
          status: "recording",
        };
        dbg("automation-store", "Started recording");
        break;

      case "STOP_RECORDING":
        if (state.recordingSession) {
          state.recordingSession.status = "stopped";
        }
        state.isRecording = false;
        dbg("automation-store", "Stopped recording");
        break;

      case "PAUSE_RECORDING":
        if (state.recordingSession) {
          state.recordingSession.status = "paused";
        }
        break;

      case "RESUME_RECORDING":
        if (state.recordingSession) {
          state.recordingSession.status = "recording";
        }
        break;

      case "ADD_RECORDED_STEP":
        if (state.recordingSession) {
          state.recordingSession.steps.push(action.step);
        }
        break;

      case "START_EXECUTION":
        state.isExecuting = true;
        state.executionProgress = {
          scriptId: action.scriptId,
          currentStepIndex: 0,
          currentStep: null,
          progress: 0,
          status: "running",
          elapsedMs: 0,
          estimatedRemainingMs: 0,
        };
        dbg("automation-store", "Started execution", action.scriptId);
        break;

      case "UPDATE_EXECUTION_PROGRESS":
        state.executionProgress = action.progress;
        break;

      case "COMPLETE_EXECUTION": {
        state.isExecuting = false;
        if (state.executionProgress) {
          state.executionProgress.status = "completed";
          state.executionProgress.progress = 100;
        }
        const script = state.scripts.find((s) => s.id === action.scriptId);
        if (script) {
          script.usageCount++;
          script.lastRunAt = new Date().toISOString();
          script.status = "ready";
        }
        dbg("automation-store", "Completed execution", action.scriptId);
        break;
      }

      case "FAIL_EXECUTION": {
        state.isExecuting = false;
        if (state.executionProgress) {
          state.executionProgress.status = "failed";
        }
        state.error = action.error;
        const failedScript = state.scripts.find((s) => s.id === action.scriptId);
        if (failedScript) {
          failedScript.status = "failed";
        }
        dbgWarn("automation-store", "Execution failed", action.error);
        break;
      }

      case "SET_ERROR":
        state.error = action.error;
        break;

      case "LOAD_SCRIPTS":
        state.scripts = action.scripts;
        dbg("automation-store", "Loaded scripts", action.scripts.length);
        break;
    }
  }

  // ── Actions ──

  function addScript(script?: AutomationScript): AutomationScript {
    const newScript = script ?? createEmptyScript();
    dispatch({ type: "ADD_SCRIPT", script: newScript });
    return newScript;
  }

  function updateScript(script: AutomationScript): void {
    dispatch({ type: "UPDATE_SCRIPT", script });
  }

  function deleteScript(scriptId: string): void {
    dispatch({ type: "DELETE_SCRIPT", scriptId });
  }

  function setActiveScript(scriptId: string | null): void {
    dispatch({ type: "SET_ACTIVE_SCRIPT", scriptId });
  }

  function startRecording(tabId?: number): void {
    dispatch({ type: "START_RECORDING", tabId });
  }

  function stopRecording(): RecordingSession | null {
    dispatch({ type: "STOP_RECORDING" });
    return state.recordingSession;
  }

  function pauseRecording(): void {
    dispatch({ type: "PAUSE_RECORDING" });
  }

  function resumeRecording(): void {
    dispatch({ type: "RESUME_RECORDING" });
  }

  function addRecordedStep(step: AutomationStep): void {
    dispatch({ type: "ADD_RECORDED_STEP", step });
  }

  function getRecordingSteps(): AutomationStep[] {
    return state.recordingSession?.steps ?? [];
  }

  function createScriptFromRecording(): AutomationScript | null {
    const session = state.recordingSession;
    if (!session || session.steps.length === 0) return null;

    const script = createEmptyScript();
    script.name = `Recording ${new Date().toLocaleDateString()}`;
    script.description = `Created from recording (${session.steps.length} steps)`;
    script.steps = session.steps;

    dispatch({ type: "ADD_SCRIPT", script });
    dispatch({ type: "STOP_RECORDING" });

    return script;
  }

  function addStep(scriptId: string): AutomationStep | null {
    const script = state.scripts.find((s) => s.id === scriptId);
    if (!script) return null;

    const newStep = createEmptyStep(script.steps.length + 1);
    script.steps.push(newStep);
    dispatch({ type: "UPDATE_SCRIPT", script });
    return newStep;
  }

  function updateStep(scriptId: string, step: AutomationStep): void {
    const script = state.scripts.find((s) => s.id === scriptId);
    if (!script) return;

    const index = script.steps.findIndex((s) => s.id === step.id);
    if (index !== -1) {
      script.steps[index] = step;
      dispatch({ type: "UPDATE_SCRIPT", script });
    }
  }

  function deleteStep(scriptId: string, stepId: string): void {
    const script = state.scripts.find((s) => s.id === scriptId);
    if (!script) return;

    script.steps = script.steps.filter((s) => s.id !== stepId);
    // Reorder remaining steps
    script.steps.forEach((step, index) => {
      step.order = index + 1;
    });
    dispatch({ type: "UPDATE_SCRIPT", script });
  }

  function reorderSteps(scriptId: string, fromIndex: number, toIndex: number): void {
    const script = state.scripts.find((s) => s.id === scriptId);
    if (!script) return;

    const steps = [...script.steps];
    const [movedStep] = steps.splice(fromIndex, 1);
    steps.splice(toIndex, 0, movedStep);

    // Update order
    steps.forEach((step, index) => {
      step.order = index + 1;
    });

    script.steps = steps;
    dispatch({ type: "UPDATE_SCRIPT", script });
  }

  async function loadScripts(): Promise<void> {
    try {
      // In production, load from backend
      // For now, use localStorage
      const stored = localStorage.getItem("ocv:automation-scripts");
      if (stored) {
        const scripts = JSON.parse(stored) as AutomationScript[];
        dispatch({ type: "LOAD_SCRIPTS", scripts });
      }
    } catch (error) {
      dbgWarn("automation-store", "Failed to load scripts:", error);
    }
  }

  async function saveScripts(): Promise<void> {
    try {
      localStorage.setItem("ocv:automation-scripts", JSON.stringify(state.scripts));
    } catch (error) {
      dbgWarn("automation-store", "Failed to save scripts:", error);
    }
  }

  function exportScript(scriptId: string): string | null {
    const script = state.scripts.find((s) => s.id === scriptId);
    if (!script) return null;
    return JSON.stringify(script, null, 2);
  }

  function importScript(json: string): AutomationScript | null {
    try {
      const script = JSON.parse(json) as AutomationScript;
      // Validate
      if (!script.name || !script.steps) {
        throw new Error("Invalid script format");
      }
      // Generate new ID
      script.id = `scr_${Date.now()}`;
      script.createdAt = new Date().toISOString();
      script.updatedAt = new Date().toISOString();
      script.usageCount = 0;
      script.status = "idle";

      dispatch({ type: "ADD_SCRIPT", script });
      return script;
    } catch (error) {
      dbgWarn("automation-store", "Failed to import script:", error);
      return null;
    }
  }

  function getScriptById(scriptId: string): AutomationScript | null {
    return state.scripts.find((s) => s.id === scriptId) ?? null;
  }

  function searchScripts(query: string): AutomationScript[] {
    const q = query.toLowerCase();
    return state.scripts.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }

  // Auto-save on changes
  $effect(() => {
    if (state.scripts.length > 0) {
      saveScripts();
    }
  });

  return {
    get state() {
      return state;
    },
    // Getters
    activeScript,
    scriptsByCategory,
    recentScripts,
    totalUsageCount,
    // Actions
    addScript,
    updateScript,
    deleteScript,
    setActiveScript,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    addRecordedStep,
    getRecordingSteps,
    createScriptFromRecording,
    addStep,
    updateStep,
    deleteStep,
    reorderSteps,
    loadScripts,
    saveScripts,
    exportScript,
    importScript,
    getScriptById,
    searchScripts,
    dispatch,
  };
}

export const automationStore = createAutomationStore();
