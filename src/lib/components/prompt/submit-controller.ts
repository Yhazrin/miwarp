/**
 * Submit controller for PromptInput.
 *
 * Drives the actual send / btw-send flow:
 *   - virtual slash command detection (model, btw, navigate, action)
 *   - building the final text (typed + paste blocks + path refs + attachments)
 *   - double-submit guard (busy)
 *   - clear-and-restore: capture draft → invoke onSend → restore on failure
 *   - sound engine unlock
 *   - capsule collapse on send
 *
 * The controller does NOT call session-store directly — the parent supplies
 * `onSend` and `onBtwSend` callbacks so it can cooperate with the chat page's
 * own send coordinator.
 *
 * Plain class (no runes) so it can be unit-tested in the vitest node env.
 */
import { dbg, dbgWarn } from "$lib/utils/debug";
import { VIRTUAL_COMMANDS, parseVirtualAction } from "$lib/utils/slash-commands";
import type { Attachment, PromptInputSnapshot } from "$lib/types";
import type { PendingAttachment } from "$lib/stores/prompt-input-store.svelte";

/** Allow parent to inject navigation (lets us stub it in tests / Tauri builds). */
type GotoFn (href: string) => void;

export interface SubmitControllerDeps {
  getInputText: () => string;
  getAttachments: () => PendingAttachment[];
  setAttachments: (atts: PendingAttachment[]) => void;
  getPastedBlocks: () => unknown[];
  setPastedBlocks: (blocks: unknown[]) => void;
  getPathRefs: () => unknown[];
  setPathRefs: (refs: unknown[]) => void;
  setInputText: (text: string) => void;
  getTextareaEl: () => HTMLTextAreaElement | undefined;
  getSnapshot: () => PromptInputSnapshot;
  restoreSnapshot: (snap: PromptInputSnapshot) => void;
  /** Side-effect hooks. */
  onSend: (text: string, attachments: Attachment[]) => Promise<void> | void;
  onBtwSend?: (question: string) => void;
  onModelSwitch?: (model: string) => void;
  onVirtualCommand?: (action: string, args: string) => void;
  /** Navigation (svelte $app/navigation goto in production). */
  goto?: GotoFn;
  /** Reset history navigation state. */
  resetHistory: () => void;
  /** Schedule a resize for after the textarea has been collapsed. */
  scheduleAutoResize: () => void;
  /** Whether the parent reports an in-flight send. */
  isBusy: () => boolean;
  /** Whether the parent reports the input is blocked. */
  isDisabled: () => boolean;
}

function wrapPathInBackticks(p: string): string {
  let maxRun = 0;
  let currentRun = 0;
  for (const ch of p) {
    if (ch === "`") {
      currentRun++;
      maxRun = Math.max(maxRun, currentRun);
    } else {
      currentRun = 0;
    }
  }
  const fence = "`".repeat(maxRun + 1);
  const needsPadding = p.startsWith("`") || p.endsWith("`");
  return needsPadding ? `${fence} ${p} ${fence}` : `${fence}${p}${fence}`;
}

export class SubmitController {
  constructor(private readonly deps: SubmitControllerDeps) {}

  /** Whether the input has anything that could be sent. */
  canSend(): boolean {
    if (this.deps.isDisabled() || this.deps.isBusy()) return false;
    const text = this.deps.getInputText().trim();
    if (text) return true;
    if (this.deps.getPastedBlocks().length > 0) return true;
    if (this.deps.getAttachments().some((a) => a.filePath)) return true;
    if (this.deps.getPathRefs().length > 0) return true;
    return false;
  }

  /** Send the main message. Virtual slash commands are intercepted. */
  send(): void {
    const typed = this.deps.getInputText().trim();

    // Virtual slash command check
    if (typed) {
      const virtual = parseVirtualAction(typed);
      if (virtual) {
        dbg("slash", `virtual:${virtual.name}`, { args: virtual.args });
        if (virtual.name === "model" && virtual.args && this.deps.onModelSwitch) {
          this.deps.setInputText("");
          const el = this.deps.getTextareaEl();
          if (el) el.style.height = "auto";
          this.deps.onModelSwitch(virtual.args);
          return;
        }
        const vDef = VIRTUAL_COMMANDS.find((v) => v.name === virtual.name);
        if (vDef && typeof vDef["_navigate"] === "string") {
          this.deps.setInputText("");
          const el = this.deps.getTextareaEl();
          if (el) el.style.height = "auto";
          this.deps.goto?.(vDef["_navigate"] as string);
          return;
        }
        if (vDef && vDef["_action"] === "side-question" && this.deps.onBtwSend) {
          if (virtual.args) {
            this.deps.setInputText("");
            const el = this.deps.getTextareaEl();
            if (el) el.style.height = "auto";
            this.deps.onBtwSend(virtual.args);
          }
          return;
        }
        if (vDef && typeof vDef["_action"] === "string" && this.deps.onVirtualCommand) {
          this.deps.setInputText("");
          const el = this.deps.getTextareaEl();
          if (el) el.style.height = "auto";
          this.deps.onVirtualCommand(vDef["_action"] as string, virtual.args);
          return;
        }
      }
    }

    // Combine typed + paste blocks + path references
    const allAtts = this.deps.getAttachments();
    const regularAtts = allAtts.filter((a) => a.contentBase64);
    const pathRefAtts = allAtts.filter((a) => a.filePath && !a.contentBase64);

    const parts: string[] = (this.deps.getPastedBlocks() as Array<{ text: string }>).map(
      (b) => b.text,
    );
    if (pathRefAtts.length > 0) {
      const refs = pathRefAtts.map((a) => `[PDF: ${a.filePath}]`).join("\n");
      parts.push(refs);
    }
    const pathRefs = this.deps.getPathRefs() as Array<{ path: string }>;
    if (pathRefs.length > 0) {
      parts.push(pathRefs.map((r) => wrapPathInBackticks(r.path)).join("\n"));
    }

    if (typed) parts.push(typed);
    const text = parts.join("\n\n");
    if (!text || this.deps.isDisabled()) return;

    if (this.deps.isBusy()) {
      dbg("prompt", "send.suppressed.busy");
      return;
    }

    dbg("prompt", "send", {
      len: text.length,
      pasteBlocks: this.deps.getPastedBlocks().length,
      attachments: regularAtts.length,
      pathRefs: pathRefAtts.length,
      dragPathRefs: this.deps.getPathRefs().length,
    });

    // Unlock sound engine on user gesture
    void import("$lib/services/sound-feedback-service")
      .then((m) => m.unlockSoundEngine())
      .catch((e) => console.debug("[sound] unlock failed:", e));

    const attachments: Attachment[] = regularAtts.map((a) => ({
      name: a.name,
      type: a.type,
      size: a.size,
      contentBase64: a.contentBase64!,
    }));

    // Capture draft for restore-on-failure
    const draftSnapshot = this.deps.getSnapshot();

    this.deps.setInputText("");
    this.deps.setAttachments([]);
    this.deps.setPastedBlocks([]);
    this.deps.setPathRefs([]);
    this.deps.resetHistory();
    const el = this.deps.getTextareaEl();
    if (el) el.style.height = "auto";

    Promise.resolve()
      .then(() => this.deps.onSend(text, attachments))
      .then(
        () => {
          // accepted: keep cleared state
        },
        (e) => {
          dbgWarn("prompt", "send.failed.restore", { error: e });
          this.deps.restoreSnapshot(draftSnapshot);
        },
      );
  }

  /** Side-question (btw) send. */
  btwSend(): void {
    const question = this.deps.getInputText().trim();
    if (!question || !this.deps.onBtwSend) return;
    dbg("prompt", "btwSend", { len: question.length });
    this.deps.setInputText("");
    const el = this.deps.getTextareaEl();
    if (el) el.style.height = "auto";
    this.deps.onBtwSend(question);
  }
}
