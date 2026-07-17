/**
 * Preview-pane lazy-load decision helpers.
 *
 * The FilePreviewPane hosts multiple renderers (CodeEditor for editable code,
 * HighlightedCode for read-only code, MiMarkdownRenderer for rendered markdown,
 * Spinner for loading, etc.). Each renderer pulls in a different dependency graph
 * — most importantly CodeMirror (1.5MB minified / 540KB gzip).
 *
 * To keep the root Layout bundle slim, we mount renderers on-demand:
 *   - CodeEditor only when the user is actually viewing (or editing) a non-image
 *     code file. It is **not** instantiated for image preview, markdown render
 *     mode, loading/error/too-large states, or remote sessions.
 *   - MiMarkdownRenderer only when the user switches a markdown file into
 *     "rendered" mode.
 *
 * These helpers are pure (no $state / $derived) so they can be unit-tested in
 * node. The Svelte component wires them to `$derived` and `$effect`.
 */
import { classifyPath, type PreviewKind } from "$lib/utils/preview-ext";

export type PaneLoadState =
  | "idle"
  | "loading"
  | "ready"
  | "error"
  | "too_large"
  | "remote_unsupported";

export interface CodeEditorLoadInput {
  /** Absolute or relative path within cwd. Empty string means "no file selected". */
  path: string;
  /** Top-level pane mode. CodeEditor is only relevant for `preview` (diff has its own renderer). */
  mode: "preview" | "diff";
  /** True for editable contexts (e.g. explorer page). Read-only contexts use HighlightedCode. */
  editable: boolean;
  /** Remote / non-local sessions don't support CodeMirror. */
  isRemote: boolean;
  /** Per-file load lifecycle owned by FilePreviewPane. */
  loadState: PaneLoadState;
  /** `rendered` mode for markdown defers to MiMarkdownRenderer instead. */
  editorMode: "edit" | "rendered";
}

/**
 * Returns true when CodeEditor should be loaded and mounted.
 *
 * Mirrors the existing rendering logic but is exposed as a pure function so it
 * can be unit-tested without instantiating the component. Note that
 * `editable` is required: non-editable contexts render HighlightedCode (hljs)
 * instead of CodeEditor, so the lazy-load trigger must respect that boundary.
 */
export function shouldLoadCodeEditor(input: CodeEditorLoadInput): boolean {
  if (!input.editable) return false;
  if (input.isRemote) return false;
  if (!input.path) return false;
  if (input.mode !== "preview") return false;
  if (input.loadState !== "ready") return false;
  const kind = classifyPath(input.path);
  if (kind === "image") return false;
  // For markdown, only the edit surface needs CodeEditor — rendered mode uses MiMarkdownRenderer.
  if (kind === "markdown" && input.editorMode === "rendered") return false;
  return true;
}

export interface MarkdownRendererLoadInput {
  path: string;
  mode: "preview" | "diff";
  editorMode: "edit" | "rendered";
  loadState: PaneLoadState;
  /** Need actual content to render. */
  hasContent: boolean;
}

/**
 * Returns true when MiMarkdownRenderer should be loaded and mounted.
 *
 * Only triggered when the user explicitly switches a markdown file into
 * "rendered" preview mode. Edit mode uses CodeEditor; the other states
 * (loading/error/too-large/diff) have their own UI.
 */
export function shouldLoadMarkdownRenderer(input: MarkdownRendererLoadInput): boolean {
  if (input.mode !== "preview") return false;
  if (!input.path) return false;
  if (input.editorMode !== "rendered") return false;
  if (input.loadState !== "ready") return false;
  if (!input.hasContent) return false;
  return classifyPath(input.path) === "markdown";
}

/**
 * Returns true when HighlightedCode should render (read-only code preview).
 */
export function shouldShowHighlightedCode(input: CodeEditorLoadInput): boolean {
  if (input.editable) return false;
  if (input.isRemote) return false;
  if (!input.path) return false;
  if (input.mode !== "preview") return false;
  if (input.loadState !== "ready") return false;
  const kind = classifyPath(input.path);
  if (kind === "image") return false;
  if (kind === "markdown" && input.editorMode === "rendered") return false;
  return true;
}

/**
 * Resolves the runtime kind for a path. Convenience wrapper for callers that
 * only have the path string (rather than the full input struct).
 */
export function kindOf(path: string): PreviewKind {
  return classifyPath(path);
}
