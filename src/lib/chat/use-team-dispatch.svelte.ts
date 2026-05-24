/**
 * Composable that owns team dispatch state and handler logic.
 *
 * Extracted from +page.svelte to keep the page file focused on UI wiring.
 * Uses Svelte 5 runes (`$state`) for reactivity.
 */

import type { SessionStore } from "$lib/stores/session-store.svelte";
import type { Attachment, TeamPreset, TeamRun } from "$lib/types";
import {
  stripTeamTag,
  dispatchTeamRun,
  executeTeamRun,
  shouldShowTeamHint,
} from "$lib/services/team-dispatcher";
import { dbgWarn } from "$lib/utils/debug";
import * as api from "$lib/api";

// ── Context (dependency injection) ──

export interface TeamDispatchContext {
  store: SessionStore;
  getSendMessage: () => (text: string, attachments: Attachment[]) => Promise<void>;
}

// ── Return type ──

export interface TeamDispatchHandle {
  // Mutable state (getter + setter pairs)
  teamDispatchOpen: boolean;
  setTeamDispatchOpen: (v: boolean) => void;
  teamDispatchPrompt: string;
  setTeamDispatchPrompt: (v: string) => void;
  activeTeamRuns: TeamRun[];
  setActiveTeamRuns: (v: TeamRun[]) => void;
  teamHintVisible: boolean;
  setTeamHintVisible: (v: boolean) => void;
  teamPresets: TeamPreset[];
  setTeamPresets: (v: TeamPreset[]) => void;

  // Handlers
  handleInputValueChange: (value: string) => void;
  handleTeamDispatch: (presetId: string) => Promise<void>;
  handleUseSingleClaude: () => void;
  handleCancelTeamDispatch: () => void;
}

// ── Composable ──

export function createTeamDispatch(ctx: TeamDispatchContext): TeamDispatchHandle {
  const { store, getSendMessage } = ctx;

  // ── Mutable state ──

  let teamDispatchOpen = $state(false);
  let teamDispatchPrompt = $state("");
  let activeTeamRuns = $state<TeamRun[]>([]);
  let teamHintVisible = $state(false);
  let teamPresets = $state<TeamPreset[]>([]);

  // ── Handlers ──

  function handleInputValueChange(value: string) {
    teamHintVisible = shouldShowTeamHint(value);
  }

  async function handleTeamDispatch(presetId: string) {
    const prompt = teamDispatchPrompt;
    teamDispatchOpen = false;
    if (!prompt) return;

    const preset = teamPresets.find((p) => p.id === presetId);
    if (!preset) return;

    const cwd = store.effectiveCwd || "";

    // Create TeamRun record
    const teamRun = await dispatchTeamRun({
      prompt,
      presetId,
      cwd,
    });

    // Add to active list so TeamRunCard renders in chat
    activeTeamRuns = [...activeTeamRuns, teamRun];

    // Execute in background — uses existing startRun infrastructure
    executeTeamRun(
      teamRun,
      preset,
      (prompt: string, runCwd: string, agent: string) => api.startRun(prompt, runCwd, agent),
      (updated: TeamRun) => {
        activeTeamRuns = activeTeamRuns.map((r) => (r.id === updated.id ? updated : r));
      },
    ).catch((err) => {
      dbgWarn("team-dispatch", "Team run failed:", err);
    });
  }

  function handleUseSingleClaude() {
    const stripped = stripTeamTag(teamDispatchPrompt);
    teamDispatchOpen = false;
    if (stripped) {
      getSendMessage()(stripped, []);
    }
  }

  function handleCancelTeamDispatch() {
    teamDispatchOpen = false;
    teamDispatchPrompt = "";
  }

  // ── Public API ──

  return {
    get teamDispatchOpen() {
      return teamDispatchOpen;
    },
    setTeamDispatchOpen: (v: boolean) => {
      teamDispatchOpen = v;
    },
    get teamDispatchPrompt() {
      return teamDispatchPrompt;
    },
    setTeamDispatchPrompt: (v: string) => {
      teamDispatchPrompt = v;
    },
    get activeTeamRuns() {
      return activeTeamRuns;
    },
    setActiveTeamRuns: (v: TeamRun[]) => {
      activeTeamRuns = v;
    },
    get teamHintVisible() {
      return teamHintVisible;
    },
    setTeamHintVisible: (v: boolean) => {
      teamHintVisible = v;
    },
    get teamPresets() {
      return teamPresets;
    },
    setTeamPresets: (v: TeamPreset[]) => {
      teamPresets = v;
    },

    handleInputValueChange,
    handleTeamDispatch,
    handleUseSingleClaude,
    handleCancelTeamDispatch,
  };
}
