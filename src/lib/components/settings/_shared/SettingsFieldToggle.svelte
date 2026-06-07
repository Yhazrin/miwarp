<script lang="ts">
  /**
   * v1.0.6 follow-up: on/off toggle wrapped in SettingsFieldRow.
   * For a plain switch without label/description, keep using SettingsToggle.
   */
  import SettingsToggle from "../SettingsToggle.svelte";
  import SettingsFieldRow from "./SettingsFieldRow.svelte";

  let {
    label,
    description = "",
    overrideBadge = "",
    savedIndicator = false,
    checked,
    onchange,
    disabled = false,
  }: {
    label?: string;
    description?: string;
    overrideBadge?: string;
    savedIndicator?: boolean;
    checked: boolean;
    onchange: (v: boolean) => void;
    disabled?: boolean;
  } = $props();
</script>

<SettingsFieldRow
  {label}
  {description}
  {overrideBadge}
  {savedIndicator}
  align="between"
>
  {#snippet children()}
    <SettingsToggle {checked} {onchange} {disabled} />
  {/snippet}
</SettingsFieldRow>
