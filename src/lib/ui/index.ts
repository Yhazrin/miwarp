/**
 * Unified UI primitive re-exports.
 *
 * RULE: Business components MUST import from "$lib/ui" or "$lib/ui/*" — never directly from "bits-ui".
 * Only src/lib/ui/* files may import bits-ui sub-modules.
 *
 * Simple wrappers (no bits-ui leakage):
 *   import { MiPopover, MiDialog, MiTooltip, MiAlertDialog } from "$lib/ui";
 *
 * Select with custom item rendering:
 *   import MiSelect from "$lib/ui/MiSelect.svelte";
 *   import { Select } from "$lib/ui/select-primitives";
 */
export { default as MiPopover } from "./MiPopover.svelte";
export { default as MiDialog } from "./MiDialog.svelte";
export { default as MiSelect } from "./MiSelect.svelte";
export { default as MiTooltip } from "./MiTooltip.svelte";
export { default as MiDropdownMenu } from "./MiDropdownMenu.svelte";
export { default as MiAlertDialog } from "./MiAlertDialog.svelte";

export * from "./miwarp-surfaces";
