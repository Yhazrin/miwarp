/**
 * Context Relay Service: sends ContextClip to target sessions
 */
import * as api from "$lib/api";
import type { ContextClip, ContextRelayTarget } from "./context-clip-types";
import { buildContextCard } from "./context-clip-types";
import type { TaskRun } from "$lib/types";

/** Result of a relay operation */
export interface RelayResult {
  success: boolean;
  targetRunId?: string;
  error?: string;
}

/** Send a context clip to a target session */
export async function sendToTarget(
  clip: ContextClip,
  target: ContextRelayTarget,
  additionalInstructions?: string,
): Promise<RelayResult> {
  try {
    switch (target.type) {
      case "current":
        // Send to currently active session
        if (!target.runId) {
          return { success: false, error: "No active session" };
        }
        return await sendToSession(target.runId, clip, additionalInstructions);

      case "new":
        // Create a new session with the clip content
        if (!target.cwd) {
          return { success: false, error: "No cwd provided for new session" };
        }
        return await sendToNewSession(target.cwd, clip, additionalInstructions, target.agent);

      case "session":
        // Send to a specific existing session
        if (!target.runId) {
          return { success: false, error: "No session specified" };
        }
        return await sendToSession(target.runId, clip, additionalInstructions);

      default:
        return { success: false, error: `Unknown target type` };
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Send clip content to an existing session via chat message */
async function sendToSession(
  runId: string,
  clip: ContextClip,
  additionalInstructions?: string,
): Promise<RelayResult> {
  const message = buildRelayMessage(clip, additionalInstructions);

  try {
    // Check if session is active - if so, send via session message
    await api.sendSessionMessage(runId, message);
    return { success: true, targetRunId: runId };
  } catch {
    // Fallback: try sending as a regular chat message
    await api.sendChatMessage(runId, message);
    return { success: true, targetRunId: runId };
  }
}

/** Create a new session with clip content as initial prompt */
async function sendToNewSession(
  cwd: string,
  clip: ContextClip,
  additionalInstructions?: string,
  agent: string = "claude",
): Promise<RelayResult> {
  const message = buildRelayMessage(clip, additionalInstructions);

  try {
    const run = await api.startRun(message, cwd, agent);
    return { success: true, targetRunId: run.id };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Build the message text from a clip and optional instructions */
function buildRelayMessage(clip: ContextClip, additionalInstructions?: string): string {
  const parts: string[] = [];

  // Add context card header
  const contextCard = buildContextCard(clip);
  parts.push(contextCard);

  // Add additional instructions if provided
  if (additionalInstructions?.trim()) {
    parts.push("");
    parts.push("---");
    parts.push("");
    parts.push("**Additional Instructions:**");
    parts.push("");
    parts.push(additionalInstructions.trim());
  }

  return parts.join("\n");
}

/** Get recent sessions for the target selector */
export async function getRecentSessions(limit: number = 10): Promise<TaskRun[]> {
  try {
    const runs = await api.listRuns();
    // Sort by last activity, filter active sessions
    return runs
      .filter(
        (r) =>
          r.status === "running" ||
          r.status === "completed" ||
          r.status === "error" ||
          r.status === "idle",
      )
      .sort((a, b) => {
        const aTime = new Date(a.last_activity_at ?? a.started_at).getTime();
        const bTime = new Date(b.last_activity_at ?? b.started_at).getTime();
        return bTime - aTime;
      })
      .slice(0, limit);
  } catch {
    return [];
  }
}

/** Fork an existing session and optionally prepend context */
export async function forkWithContext(
  sourceRunId: string,
  clip?: ContextClip,
  additionalInstructions?: string,
): Promise<RelayResult> {
  try {
    const newSessionId = await api.forkSession(sourceRunId);

    // If we have context to prepend, send it
    if (clip) {
      const message = buildRelayMessage(clip, additionalInstructions);
      try {
        await api.sendSessionMessage(newSessionId, message);
      } catch {
        // Session might not support session messages, that's ok
      }
    }

    return { success: true, targetRunId: newSessionId };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
