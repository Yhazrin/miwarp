import * as api from "$lib/api";
import {
  stripTeamTag,
  dispatchTeamRun,
  executeTeamRun,
  getPresets,
  shouldShowTeamHint,
} from "$lib/services/team-dispatcher";
import type { SessionStore } from "$lib/stores/session-store.svelte";
import type { TeamRun, TeamPreset, Attachment } from "$lib/types";

export interface TeamDispatchContext {
  store: SessionStore;
  setTeamDispatchOpen: (v: boolean) => void;
  setTeamDispatchPrompt: (v: string) => void;
  getActiveTeamRuns: () => TeamRun[];
  setActiveTeamRuns: (v: TeamRun[]) => void;
  setTeamHintVisible: (v: boolean) => void;
  setTeamPresets: (v: TeamPreset[]) => void;
  sendMessage: (text: string, attachments: Attachment[]) => Promise<void>;
}

export function createTeamDispatch(ctx: TeamDispatchContext) {
  const {
    store,
    setTeamDispatchOpen,
    setTeamDispatchPrompt,
    getActiveTeamRuns,
    setActiveTeamRuns,
    setTeamHintVisible,
    setTeamPresets,
    sendMessage,
  } = ctx;

  function handleInputValueChange(value: string) {
    setTeamHintVisible(shouldShowTeamHint(value));
  }

  function loadTeamPresets() {
    getPresets()
      .then((p) => setTeamPresets(p))
      .catch(() => {});
  }

  async function handleTeamDispatch(
    presetId: string,
    teamDispatchPrompt: string,
    teamPresets: TeamPreset[],
  ) {
    const prompt = teamDispatchPrompt;
    setTeamDispatchOpen(false);
    if (!prompt) return;

    const preset = teamPresets.find((p) => p.id === presetId);
    if (!preset) return;

    const cwd = store.effectiveCwd || "";

    const teamRun = await dispatchTeamRun({
      prompt,
      presetId,
      cwd,
    });

    setActiveTeamRuns([...getActiveTeamRuns(), teamRun]);

    executeTeamRun(
      teamRun,
      preset,
      (prompt: string, runCwd: string, agent: string) => api.startRun(prompt, runCwd, agent),
      (updated: TeamRun) => {
        setActiveTeamRuns(getActiveTeamRuns().map((r) => (r.id === updated.id ? updated : r)));
      },
    ).catch((err) => {
      console.error("Team run failed:", err);
    });
  }

  function handleUseSingleClaude(teamDispatchPrompt: string) {
    const stripped = stripTeamTag(teamDispatchPrompt);
    setTeamDispatchOpen(false);
    if (stripped) {
      sendMessage(stripped, []);
    }
  }

  function handleCancelTeamDispatch() {
    setTeamDispatchOpen(false);
    setTeamDispatchPrompt("");
  }

  return {
    handleInputValueChange,
    loadTeamPresets,
    handleTeamDispatch,
    handleUseSingleClaude,
    handleCancelTeamDispatch,
  };
}
