/**
 * Re-export of bits-ui Select sub-components for advanced MiSelect usage.
 *
 * Use these when MiSelect's `items` prop is too simple and you need custom
 * item rendering (icons, descriptions, color classes, etc.).
 *
 * Usage:
 *   import MiSelect from "$lib/ui/MiSelect.svelte";
 *   import { Select } from "$lib/ui/select-primitives";
 *
 *   <MiSelect bind:value bind:open>
 *     <Select.Item value="x" label="X">
 *       {#snippet children({ selected })}
 *         <Icon name="check" /> X
 *       {/snippet}
 *     </Select.Item>
 *   </MiSelect>
 *
 * RULE: This file exists so business components don't import from "bits-ui" directly.
 */
export { Select } from "bits-ui";
