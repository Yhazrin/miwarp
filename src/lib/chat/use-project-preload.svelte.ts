/**
 * Composable: project-level data preloading.
 *
 * Loads skills, agents, and project commands from the filesystem for the
 * current project directory. Uses a generation counter to prevent stale
 * async responses from overwriting fresher data.
 */
import * as api from "$lib/api";
import { dbg, dbgWarn } from "$lib/utils/debug";
import type { SessionStore } from "$lib/stores";

export function useProjectPreload(opts: { store: SessionStore; availableSkills: () => string[] }) {
  let preloadedSkills = $state<import("$lib/types").StandaloneSkill[]>([]);
  let preloadedAgents = $state<import("$lib/types").AgentDefinitionSummary[]>([]);
  let projectCommands = $state<import("$lib/types").CliCommand[]>([]);
  let preloadGen = 0;

  function reloadProjectData(cwd: string) {
    const gen = ++preloadGen;
    preloadedSkills = [];
    preloadedAgents = [];
    projectCommands = [];
    if (!cwd) return;
    api
      .listStandaloneSkills(cwd)
      .then((skills) => {
        if (gen !== preloadGen) return;
        preloadedSkills = skills;
        if (skills.length > 0 && opts.availableSkills().length === 0) {
          opts.store.availableSkills = skills.map((s) => s.name);
        }
        dbg("chat", "preloaded skills", { count: skills.length });
      })
      .catch((e) => dbgWarn("chat", "failed to preload skills", e));
    api
      .listAgents(cwd)
      .then((agents) => {
        if (gen !== preloadGen) return;
        preloadedAgents = agents;
        dbg("chat", "preloaded agents", { count: agents.length });
      })
      .catch((e) => dbgWarn("chat", "failed to preload agents", e));
    api
      .listProjectCommands(cwd)
      .then((cmds) => {
        if (gen !== preloadGen) return;
        projectCommands = cmds;
        dbg("chat", "preloaded project commands", { count: cmds.length });
      })
      .catch((e) => dbgWarn("chat", "failed to preload project commands", e));
  }

  return {
    get preloadedSkills() {
      return preloadedSkills;
    },
    get preloadedAgents() {
      return preloadedAgents;
    },
    get projectCommands() {
      return projectCommands;
    },
    reloadProjectData,
  };
}
