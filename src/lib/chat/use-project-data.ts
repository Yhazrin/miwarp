import * as api from "$lib/api";
import type { SessionStore } from "$lib/stores/session-store.svelte";
import type {
  StandaloneSkill,
  AgentDefinitionSummary,
  CliCommand,
  ProjectInitStatus,
} from "$lib/types";
import { dbg, dbgWarn } from "$lib/utils/debug";

export interface ProjectDataContext {
  store: SessionStore;
  setPreloadedSkills: (v: StandaloneSkill[]) => void;
  setPreloadedAgents: (v: AgentDefinitionSummary[]) => void;
  setProjectCommands: (v: CliCommand[]) => void;
  getProjectInitStatus: () => ProjectInitStatus | null;
  setProjectInitStatus: (v: ProjectInitStatus | null) => void;
}

export function createProjectData(ctx: ProjectDataContext) {
  const {
    store,
    setPreloadedSkills,
    setPreloadedAgents,
    setProjectCommands,
    getProjectInitStatus,
    setProjectInitStatus,
  } = ctx;

  let preloadGen = 0;
  let initCheckSeq = 0;

  function reloadProjectData(cwd: string) {
    const gen = ++preloadGen;
    setPreloadedSkills([]);
    setPreloadedAgents([]);
    setProjectCommands([]);
    if (!cwd) return;
    api
      .listStandaloneSkills(cwd)
      .then((skills) => {
        if (gen !== preloadGen) return;
        setPreloadedSkills(skills);
        if (skills.length > 0 && store.availableSkills.length === 0) {
          store.availableSkills = skills.map((s) => s.name);
        }
        dbg("chat", "preloaded skills", { count: skills.length });
      })
      .catch((e) => dbgWarn("chat", "failed to preload skills", e));
    api
      .listAgents(cwd)
      .then((agents) => {
        if (gen !== preloadGen) return;
        setPreloadedAgents(agents);
        dbg("chat", "preloaded agents", { count: agents.length });
      })
      .catch((e) => dbgWarn("chat", "failed to preload agents", e));
    api
      .listProjectCommands(cwd)
      .then((cmds) => {
        if (gen !== preloadGen) return;
        setProjectCommands(cmds);
        dbg("chat", "preloaded project commands", { count: cmds.length });
      })
      .catch((e) => dbgWarn("chat", "failed to preload project commands", e));
  }

  async function checkProjectInit() {
    const cwd = localStorage.getItem("ocv:project-cwd") || "";
    if (!cwd || cwd === "/") {
      setProjectInitStatus(null);
      dbg("chat", "checkProjectInit: skip (no cwd)");
      return;
    }
    const seq = ++initCheckSeq;
    try {
      const status = await api.checkProjectInit(cwd);
      dbg("chat", "checkProjectInit result", {
        cwd,
        status,
        seq,
        currentSeq: initCheckSeq,
        hasRun: !!store.run,
        isApiMode: store.isApiMode,
      });
      if (seq !== initCheckSeq) return;
      const dismissKey = `ocv:init-dismissed:${status.cwd}`;
      const dismissed = localStorage.getItem(dismissKey);
      if (dismissed) {
        setProjectInitStatus(null);
        dbg("chat", "checkProjectInit: dismissed", dismissKey);
        return;
      }
      setProjectInitStatus(status);
    } catch (e) {
      dbgWarn("chat", "checkProjectInit failed", e);
      if (seq === initCheckSeq) setProjectInitStatus(null);
    }
  }

  function dismissInitHint() {
    const status = getProjectInitStatus();
    if (status?.cwd) {
      localStorage.setItem(`ocv:init-dismissed:${status.cwd}`, "1");
    }
    setProjectInitStatus(null);
    dbg("chat", "init hint dismissed");
  }

  return { reloadProjectData, checkProjectInit, dismissInitHint };
}
