<script lang="ts">
  /**
   * v1.0.6 follow-up: thin shell that renders ThemeEditor +
   * BackgroundPicker. Extracted from settings +page.svelte's
   * `activeTab === "theme"` branch (4 lines of HTML).
   */
  import BackgroundPicker from "$lib/components/BackgroundPicker.svelte";
  import ThemeEditor from "$lib/components/ThemeEditor.svelte";
</script>

<ThemeEditor />
<BackgroundPicker />
