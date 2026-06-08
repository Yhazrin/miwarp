<script lang="ts">
  /**
   * v1.0.6 follow-up: text input wrapped in SettingsFieldRow.
   * Commits on blur or Enter (not on every keystroke).
   */
  import SettingsFieldRow from "./SettingsFieldRow.svelte";

  let {
    label,
    description = "",
    overrideBadge = "",
    value = "",
    placeholder = "",
    type = "text",
    onCommit,
    inputClass = "",
  }: {
    label?: string;
    description?: string;
    overrideBadge?: string;
    value?: string;
    placeholder?: string;
    type?: "text" | "password" | "url" | "email";
    onCommit: (v: string) => void;
    inputClass?: string;
  } = $props();

  let local = $state<string>("");
  $effect(() => {
    // Sync external value changes into local buffer.
    local = value;
  });

  function commit() {
    if (local !== value) onCommit(local);
  }
</script>

<SettingsFieldRow {label} {description} {overrideBadge} align="between">
  {#snippet children()}
    <input
      {type}
      bind:value={local}
      {placeholder}
      onblur={commit}
      onkeydown={(e) => {
        if (e.key === "Enter") {
          (e.currentTarget as HTMLInputElement).blur();
        }
      }}
      class="w-64 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm
        text-foreground outline-none focus:border-primary/50 focus:ring-1
        focus:ring-primary/30 {inputClass}"
    />
  {/snippet}
</SettingsFieldRow>
