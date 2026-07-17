/**
 * Text-input controller for PromptInput.
 *
 * Owns the textarea-level concerns that aren't tied to a specific domain
 * (slash commands, mentions, history, attachments):
 *   - C0/C1 control-character sanitization (private use, ANSI arrow escapes)
 *   - IME composition guard
 *   - Mis-encoded arrow key detection (WebView/Tauri quirk)
 *   - `beforeinput` event gate
 *   - `input` event sanitization + caret remap
 *   - "?" shortcut help
 *
 * Domain-specific key handling (Enter→submit, Up/Down→history, /→slash,
 * @→mention, Escape→menu/clear) lives on the `KeydownRouter` passed in.
 *
 * This controller is a plain class (no runes) so it can be tested in the
 * vitest node env without the Svelte runtime.
 */
import { dbgWarn } from "$lib/utils/debug";
import { misencodedNavigationDirection, moveTextareaCaret } from "$lib/utils/prompt-text";

const PRIVATE_USE_KEYBOARD_MIN = 0xf700;
const PRIVATE_USE_KEYBOARD_MAX = 0xf8ff;

function isPrivateUseKeyboardChar(ch: string): boolean {
  if (!ch) return false;
  const cp = ch.codePointAt(0)!;
  return cp >= PRIVATE_USE_KEYBOARD_MIN && cp <= PRIVATE_USE_KEYBOARD_MAX;
}

function isStrippedKeyboardChar(ch: string): boolean {
  if (ch === "\n" || ch === "\t") return false;
  const cp = ch.codePointAt(0)!;
  if (cp < 0x20) return true;
  if (cp >= 0x7f && cp <= 0x9f) return true;
  if (cp >= PRIVATE_USE_KEYBOARD_MIN && cp <= PRIVATE_USE_KEYBOARD_MAX) return true;
  return false;
}

function formatCodePoints(text: string): string[] {
  const out: string[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    out.push(`U+${cp.toString(16).toUpperCase().padStart(4, "0")}`);
  }
  return out;
}

function hasAnsiArrowEscape(text: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /\x1b\[[ABCD]/.test(text);
}

export function hasKeyboardControlChars(text: string): boolean {
  if (hasAnsiArrowEscape(text)) return true;
  for (const ch of text) {
    if (isStrippedKeyboardChar(ch)) return true;
  }
  return false;
}

export function mapIndexAfterStrip(raw: string, index: number): number {
  let cleanPos = 0;
  let i = 0;
  while (i < raw.length && i < index) {
    if (
      raw.charCodeAt(i) === 0x1b &&
      i + 2 < raw.length &&
      raw[i + 1] === "[" &&
      "ABCD".includes(raw[i + 2])
    ) {
      i += 3;
      continue;
    }
    const cp = raw.codePointAt(i)!;
    const chLen = cp > 0xffff ? 2 : 1;
    const ch = raw.slice(i, i + chLen);
    if (!isStrippedKeyboardChar(ch)) cleanPos += chLen;
    i += chLen;
  }
  return cleanPos;
}

export function stripKeyboardControlChars(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (
      text.charCodeAt(i) === 0x1b &&
      i + 2 < text.length &&
      text[i + 1] === "[" &&
      "ABCD".includes(text[i + 2])
    ) {
      i += 3;
      continue;
    }
    const cp = text.codePointAt(i)!;
    const chLen = cp > 0xffff ? 2 : 1;
    const ch = text.slice(i, i + chLen);
    if (!isStrippedKeyboardChar(ch)) out += ch;
    i += chLen;
  }
  return out;
}

/**
 * Router the parent wires up to give domain controllers the chance to
 * intercept keys. Each method returns `true` to indicate it consumed the key
 * and the text-input controller should `preventDefault`.
 */
interface KeydownRouter {
  /** Up/Down arrow; the history controller decides. */
  onArrowNav(key: "ArrowUp" | "ArrowDown"): boolean;
  /** Enter (without shift); the submit controller decides. */
  onEnter(): boolean;
  /** Escape: slash/at controllers may dismiss; otherwise the parent clears. */
  onEscape(): boolean;
  /** ? with empty input: the parent forwards to onShortcutHelp. */
  onShortcutHelp(): boolean;
}

export interface TextInputControllerDeps {
  /** Read/write the input text on the store. */
  getInputText: () => string;
  setInputText: (text: string) => void;
  getTextareaEl: () => HTMLTextAreaElement | undefined;
  /** Whether any content is queued (text, attachments, paste blocks, or path refs). */
  hasContent: () => boolean;
  /** Hooks to dispatch domain-specific keys. */
  router: KeydownRouter;
  /** Run after the input has been sanitized (e.g. dispatch @-mention / slash checks). */
  onAfterSanitize: (cleaned: string) => void;
}

export class TextInputController {
  constructor(private readonly deps: TextInputControllerDeps) {}

  /** beforeinput handler — early-reject private-use / control character input. */
  handleBeforeInput(e: InputEvent): void {
    if (e.isComposing) return;
    const data = e.data;
    if (data == null || data === "") return;

    const codePoints = formatCodePoints(data);
    const privateUse = codePoints.filter((cp) => {
      const n = Number.parseInt(cp.slice(2), 16);
      return n >= PRIVATE_USE_KEYBOARD_MIN && n <= PRIVATE_USE_KEYBOARD_MAX;
    });
    if (privateUse.length > 0) {
      dbgWarn("prompt", "beforeinput-private-use", {
        inputType: e.inputType,
        codePoints: privateUse,
      });
    }

    if (hasKeyboardControlChars(data)) {
      e.preventDefault();
      dbgWarn("prompt", "beforeinput-blocked", {
        inputType: e.inputType,
        codePoints,
      });
    }
  }

  /** input handler — sanitize, remap caret, notify parent for downstream side effects. */
  handleInput(e: Event | undefined = undefined): void {
    const composing = (e as InputEvent | undefined)?.isComposing === true;
    if (!composing) {
      const raw = this.deps.getInputText();
      if (hasKeyboardControlChars(raw)) {
        dbgWarn("prompt", "input-keyboard-control-detected", {
          codePoints: formatCodePoints(raw),
          length: raw.length,
        });
      }
      const cleaned = stripKeyboardControlChars(raw);
      if (cleaned !== raw) {
        const el = this.deps.getTextareaEl();
        const start = el?.selectionStart ?? cleaned.length;
        const end = el?.selectionEnd ?? start;
        this.deps.setInputText(cleaned);
        if (el) {
          el.selectionStart = mapIndexAfterStrip(raw, start);
          el.selectionEnd = mapIndexAfterStrip(raw, end);
        }
        dbgWarn("prompt", "input-sanitized", {
          rawCodePoints: formatCodePoints(raw),
          cleanedLength: cleaned.length,
          rawLength: raw.length,
        });
        this.deps.onAfterSanitize(cleaned);
        return;
      }
    }
    this.deps.onAfterSanitize(this.deps.getInputText());
  }

  /** keydown handler — IME, mis-encoded arrows, delegate to router. */
  handleKeydown(e: KeyboardEvent): void {
    // Skip during IME composition (e.g., Chinese input confirming with Enter)
    if (e.isComposing || e.keyCode === 229) return;

    if (e.key.length === 1 && isPrivateUseKeyboardChar(e.key)) {
      e.preventDefault();
      dbgWarn("prompt", "keydown-private-use-blocked", {
        codePoint: `U+${e.key.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`,
        keyCode: e.keyCode,
      });
      return;
    }

    // WebView/Tauri quirk: Arrow keys may arrive as C0 controls
    const misNav = misencodedNavigationDirection(e);
    const el = this.deps.getTextareaEl();
    if (misNav && el) {
      e.preventDefault();
      moveTextareaCaret(el, misNav);
      return;
    }
    if (e.key.length === 1 && hasKeyboardControlChars(e.key)) {
      e.preventDefault();
      dbgWarn("prompt", "keydown-control-blocked", {
        codePoint: `U+${e.key.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`,
        keyCode: e.keyCode,
      });
      return;
    }

    // Domain key dispatch
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      if (this.deps.router.onArrowNav(e.key)) {
        e.preventDefault();
      }
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      if (this.deps.router.onEnter()) e.preventDefault();
      return;
    }
    if (e.key === "Escape") {
      if (this.deps.router.onEscape()) e.preventDefault();
      return;
    }
    if (e.key === "?" && !this.deps.hasContent() && this.deps.router.onShortcutHelp()) {
      e.preventDefault();
    }
  }
}
