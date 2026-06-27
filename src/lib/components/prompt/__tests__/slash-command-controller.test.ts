import { describe, it, expect, vi, beforeAll } from "vitest";
import { SlashCommandController } from "../slash-command-controller.svelte";
import type { CliCommand } from "$lib/types";

beforeAll(() => {
  if (typeof globalThis.requestAnimationFrame !== "function") {
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
      setTimeout(
        () => cb(Date.now()),
        0,
      ) as unknown as number) as typeof globalThis.requestAnimationFrame;
    globalThis.cancelAnimationFrame = ((id: number) =>
      clearTimeout(id)) as typeof globalThis.cancelAnimationFrame;
  }
});

function makeDeps(
  opts: {
    agent?: string;
    cliCommands?: CliCommand[];
    isRemote?: boolean;
    fastModeState?: string;
  } = {},
) {
  let inputText = "";
  const setInputText = vi.fn((s: string) => {
    inputText = s;
  });
  const setInputValue = (s: string) => {
    inputText = s;
  };
  const deps = {
    getInputText: () => inputText,
    setInputText,
    getTextareaEl: () => undefined,
    getCliCommands: () => opts.cliCommands ?? [],
    getAvailableSkills: () => [],
    getFastModeState: () => opts.fastModeState ?? "",
    getAgent: () => opts.agent ?? "claude",
    isRemote: () => opts.isRemote ?? false,
    onSend: vi.fn(),
    onModelSwitch: vi.fn(),
    onFastModeSwitch: vi.fn(),
    onVirtualCommand: vi.fn(),
    onTriggerSend: vi.fn(),
    goto: vi.fn(),
    setInputValue,
  };
  return { deps, setInputText };
}

const CLI_COMMANDS: CliCommand[] = [
  { name: "compact", description: "Compact context", aliases: [] },
  { name: "config", description: "Open config", aliases: [] },
  { name: "model", description: "Switch model", aliases: ["m"] },
  { name: "help", description: "Show help", aliases: ["?"] },
];

describe("SlashCommandController.enabled", () => {
  it("enabled when agent is claude", () => {
    const { deps } = makeDeps({ agent: "claude" });
    const ctl = new SlashCommandController(deps);
    expect(ctl.enabled).toBe(true);
  });
  it("disabled when agent is not claude", () => {
    const { deps } = makeDeps({ agent: "codex" });
    const ctl = new SlashCommandController(deps);
    expect(ctl.enabled).toBe(false);
  });
});

describe("SlashCommandController filteredCommands / open detection", () => {
  it("detects slash query and opens menu", () => {
    const { deps } = makeDeps({ cliCommands: CLI_COMMANDS });
    const ctl = new SlashCommandController(deps);
    deps.setInputValue("/co");
    ctl.detectFromInput();
    expect(ctl.open).toBe(true);
    expect(ctl.query).toBe("co");
    // Virtual commands are merged in: "copy" also starts with "co"
    expect(ctl.filteredCommands.map((c) => c.name).sort()).toEqual(
      ["compact", "config", "copy"].sort(),
    );
  });

  it("query getter accepts the Chinese pause mark as slash alias", () => {
    const { deps } = makeDeps({ cliCommands: CLI_COMMANDS });
    const ctl = new SlashCommandController(deps);
    // detectFromInput only matches "/" — but the `query` getter (called by the
    // popover view) accepts the Chinese pause mark "、" too. This matches the
    // original PromptInput behavior.
    ctl.open = true;
    ctl.phase = "commands";
    deps.setInputValue("、co");
    expect(ctl.query).toBe("co");
  });

  it("closes the menu when input no longer matches", () => {
    const { deps } = makeDeps({ cliCommands: CLI_COMMANDS });
    const ctl = new SlashCommandController(deps);
    deps.setInputValue("/co");
    ctl.detectFromInput();
    expect(ctl.open).toBe(true);
    deps.setInputValue("hello");
    ctl.detectFromInput();
    expect(ctl.open).toBe(false);
  });
});

describe("SlashCommandController.close", () => {
  it("clears menu state", () => {
    const { deps } = makeDeps({ cliCommands: CLI_COMMANDS });
    const ctl = new SlashCommandController(deps);
    ctl.openFromButton();
    expect(ctl.open).toBe(true);
    expect(deps.setInputText).toHaveBeenCalledWith("/");
    ctl.close("escape");
    expect(ctl.open).toBe(false);
  });
  it("clears the saved input on execute reason", () => {
    const { deps } = makeDeps({ cliCommands: CLI_COMMANDS });
    const ctl = new SlashCommandController(deps);
    ctl.savedInput = "user draft";
    ctl.open = true;
    ctl.close("execute");
    expect(ctl.savedInput).toBe("");
  });
  it("restores the saved input on escape reason", () => {
    const { deps } = makeDeps({ cliCommands: CLI_COMMANDS });
    const ctl = new SlashCommandController(deps);
    ctl.openFromButton();
    ctl.savedInput = "user draft";
    ctl.close("escape");
    expect(deps.setInputText).toHaveBeenLastCalledWith("user draft");
    expect(ctl.savedInput).toBe("");
  });
});

describe("SlashCommandController.quickAction", () => {
  it("calls onVirtualCommand for virtual immediate action", () => {
    const { deps } = makeDeps({ cliCommands: CLI_COMMANDS });
    const ctl = new SlashCommandController(deps);
    ctl.quickAction({ name: "copy", description: "Copy last", aliases: [] });
    expect(deps.onVirtualCommand).toHaveBeenCalledWith("copy-last", "");
  });
  it("fills /<name> for free-text interaction", () => {
    const { deps } = makeDeps({ cliCommands: CLI_COMMANDS });
    const ctl = new SlashCommandController(deps);
    ctl.quickAction({
      name: "btw",
      description: "Side question",
      aliases: [],
      argumentHint: "<question>",
    });
    expect(deps.setInputText).toHaveBeenCalledWith("/btw ");
  });
  it("opens enum sub-view for model quick action", () => {
    const { deps } = makeDeps({ cliCommands: CLI_COMMANDS });
    const ctl = new SlashCommandController(deps);
    // The real `model` command is virtual with _enum: true. To reproduce that
    // in the test, we pass the same shape getCommandInteraction looks at.
    ctl.quickAction({
      name: "model",
      description: "Switch model",
      aliases: ["m"],
      _enum: true,
    } as CliCommand);
    expect(ctl.open).toBe(true);
    expect(ctl.phase).toBe("sub-model");
    expect(ctl.activeCmd?.name).toBe("model");
  });
});

describe("SlashCommandController.handleKey", () => {
  function evt(key: string, preventDefault = vi.fn()) {
    return { key, preventDefault } as unknown as KeyboardEvent;
  }

  it("Escape on commands phase closes menu", () => {
    const { deps } = makeDeps({ cliCommands: CLI_COMMANDS });
    const ctl = new SlashCommandController(deps);
    ctl.openFromButton();
    const e = evt("Escape");
    const handled = ctl.handleKey(e);
    expect(handled).toBe(true);
    expect(ctl.open).toBe(false);
  });

  it("ArrowDown increments selected index", () => {
    const { deps } = makeDeps({ cliCommands: CLI_COMMANDS });
    const ctl = new SlashCommandController(deps);
    deps.setInputValue("/");
    ctl.detectFromInput();
    // openFromButton toggles, so use detectFromInput to set the open state.
    ctl.open = true;
    ctl.phase = "commands";
    ctl.selectedIndex = 0;
    ctl.handleKey(evt("ArrowDown"));
    expect(ctl.selectedIndex).toBe(1);
  });

  it("ArrowUp at top stays at 0", () => {
    const { deps } = makeDeps({ cliCommands: CLI_COMMANDS });
    const ctl = new SlashCommandController(deps);
    deps.setInputValue("/");
    ctl.detectFromInput();
    ctl.open = true;
    ctl.phase = "commands";
    ctl.selectedIndex = 0;
    ctl.handleKey(evt("ArrowUp"));
    expect(ctl.selectedIndex).toBe(0);
  });

  it("Enter on an immediate command triggers onTriggerSend", () => {
    const { deps } = makeDeps({ cliCommands: CLI_COMMANDS });
    const ctl = new SlashCommandController(deps);
    deps.setInputValue("/");
    ctl.detectFromInput();
    ctl.open = true;
    ctl.phase = "commands";
    // Set the active index to 0; "compact" is the first command and is "immediate"
    ctl.selectedIndex = 0;
    ctl.handleKey(evt("Enter"));
    expect(deps.onTriggerSend).toHaveBeenCalled();
  });
});
