/**
 * Skill Widget Renderer
 *
 * Unified rendering entry for Skill Widgets (progress, form, list, confirm)
 * Inspired by Claude Cowork's widget system design
 */
import type { WidgetSpec } from "$lib/services/skill-executor";
import ProgressWidget from "./ProgressWidget.svelte";
import FormWidget from "./FormWidget.svelte";
import ListWidget from "./ListWidget.svelte";
import ConfirmWidget from "./ConfirmWidget.svelte";

interface Props {
  widget: WidgetSpec;
  onAction?: (data: any) => void;
}

export function renderWidget(widget: WidgetSpec, onAction?: (data: any) => void) {
  // Returns component and props for programmatic rendering
  switch (widget.type) {
    case "progress":
      return { component: ProgressWidget, props: { data: widget.data } };
    case "form":
      return { component: FormWidget, props: { data: widget.data, onAction } };
    case "list":
      return { component: ListWidget, props: { data: widget.data } };
    case "confirm":
      return { component: ConfirmWidget, props: { data: widget.data, onAction } };
    default:
      return null;
  }
}

export type { Props, WidgetSpec };