import * as api from "$lib/api";
import { dbg, dbgWarn } from "$lib/utils/debug";
import type { SessionStore } from "$lib/stores/session-store.svelte";
import type {
  ProjectInitStatus,
  StandaloneSkill,
  AgentDefinitionSummary,
  CliCommand,
} from "$lib/types";

export interface ProjectInitContext {
  store: SessionStore;
  getPreloadGen: () => number;
  setPreloadGen: (v: number) => void;
  setPreloadedSkills: (v: StandaloneSkill[]) => void;
  setPreloadedAgents: (v: AgentDefinitionSummary[]) => void;
  setProjectCommands: (v: CliCommand[]) => void;
  setProjectInitStatus: (v: ProjectInitStatus | null) => void;
  getProjectInitStatus: () => ProjectInitStatus | null;
  getInitCheckSeq: () => number;
  setInitCheckSeq: (v: number) => void;
}

export function createProjectInit(ctx: ProjectInitContext) {
  const {
    store,
    getPreloadGen,
    setPreloadGen,
    setPreloadedSkills,
    setPreloadedAgents,
    setProjectCommands,
    setProjectInitStatus,
    getProjectInitStatus,
    getInitCheckSeq,
    setInitCheckSeq,
  } = ctx;

  function reloadProjectData(cwd: string) {
    const gen = getPreloadGen() + 1;
    setPreloadGen(gen);
    setPreloadedSkills([]);
    setPreloadedAgents([]);
    setProjectCommands([]);
    if (!cwd) return;
    api
      .listStandaloneSkills(cwd)
      .then((skills) => {
        if (gen !== getPreloadGen()) return;
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
        if (gen !== getPreloadGen()) return;
        setPreloadedAgents(agents);
        dbg("chat", "preloaded agents", { count: agents.length });
      })
      .catch((e) => dbgWarn("chat", "failed to preload agents", e));
    api
      .listProjectCommands(cwd)
      .then((cmds) => {
        if (gen !== getPreloadGen()) return;
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
    const seq = getInitCheckSeq() + 1;
    setInitCheckSeq(seq);
    try {
      const status = await api.checkProjectInit(cwd);
      dbg("chat", "checkProjectInit result", {
        cwd,
        status,
        seq,
        currentSeq: getInitCheckSeq(),
        hasRun: !!store.run,
        isApiMode: store.isApiMode,
      });
      if (seq !== getInitCheckSeq()) return;
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
      if (seq === getInitCheckSeq()) setProjectInitStatus(null);
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
