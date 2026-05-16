/**
 * Composable: team dispatch flow.
 *
 * Manages the @team / /team detection → preset selection → dispatch lifecycle.
 * Uses the existing `team-dispatcher` service and `api.startRun` under the hood.
 */
import { onMount } from "svelte";
import * as api from "$lib/api";
import {
  stripTeamTag,
  dispatchTeamRun,
  executeTeamRun,
  getPresets,
  shouldShowTeamHint,
} from "$lib/services/team-dispatcher";
import type { TeamRun, TeamPreset } from "$lib/types";

export function useTeamDispatch(opts: {
  effectiveCwd: () => string;
  onSendMessage: (text: string) => void;
}) {
  let teamDispatchOpen = $state(false);
  let teamDispatchPrompt = $state("");
  let activeTeamRuns = $state<TeamRun[]>([]);
  let teamHintVisible = $state(false);
  let teamPresets = $state<TeamPreset[]>([]);

  onMount(() => {
    getPresets()
      .then((p) => (teamPresets = p))
      .catch(() => {});
  });

  function handleInputValueChange(value: string) {
    teamHintVisible = shouldShowTeamHint(value);
  }

  async function handleTeamDispatch(presetId: string) {
    const prompt = teamDispatchPrompt;
    teamDispatchOpen = false;
    if (!prompt) return;

    const preset = teamPresets.find((p) => p.id === presetId);
    if (!preset) return;

    const cwd = opts.effectiveCwd();

    const teamRun = await dispatchTeamRun({ prompt, presetId, cwd });
    activeTeamRuns = [...activeTeamRuns, teamRun];

    executeTeamRun(
      teamRun,
      preset,
      (prompt: string, runCwd: string, agent: string) => api.startRun(prompt, runCwd, agent),
      (updated: TeamRun) => {
        activeTeamRuns = activeTeamRuns.map((r) => (r.id === updated.id ? updated : r));
      },
    ).catch((err) => {
      console.error("Team run failed:", err);
    });
  }

  function handleUseSingleClaude() {
    const stripped = stripTeamTag(teamDispatchPrompt);
    teamDispatchOpen = false;
    if (stripped) {
      opts.onSendMessage(stripped);
    }
  }

  function handleCancelTeamDispatch() {
    teamDispatchOpen = false;
    teamDispatchPrompt = "";
  }

  return {
    get teamDispatchOpen() {
      return teamDispatchOpen;
    },
    set teamDispatchOpen(v: boolean) {
      teamDispatchOpen = v;
    },
    get teamDispatchPrompt() {
      return teamDispatchPrompt;
    },
    set teamDispatchPrompt(v: string) {
      teamDispatchPrompt = v;
    },
    get activeTeamRuns() {
      return activeTeamRuns;
    },
    get teamHintVisible() {
      return teamHintVisible;
    },
    get teamPresets() {
      return teamPresets;
    },
    handleInputValueChange,
    handleTeamDispatch,
    handleUseSingleClaude,
    handleCancelTeamDispatch,
  };
}
