<script lang="ts">
  /**
   * Identity card — display name, handle, role, timezone, email.
   * The first three are injected into every session's system prompt; the
   * email is local-only and never leaves the device.
   */
  import { t } from "$lib/i18n/index.svelte";
  import type { MessageKey } from "$lib/i18n/types";
  import type { IdentitySettings } from "./settings-slice";
  import type { UserSettings } from "$lib/types";
  import PersonalSection from "./PersonalSection.svelte";

  let {
    identitySettings,
    onCommit,
  }: {
    identitySettings: IdentitySettings;
    onCommit: (patch: Partial<UserSettings>) => Promise<void>;
  } = $props();

  function lk(key: string): string {
    return t(key as MessageKey);
  }

  function trim(value: string): string {
    return value.trim();
  }

  async function commitField(field: keyof IdentitySettings, raw: string) {
    const value = trim(raw);
    const current = (identitySettings[field] as string | undefined) ?? "";
    if (value === current) return;
    const patch: Partial<IdentitySettings> = {
      [field]: value || undefined,
    } as Partial<IdentitySettings>;
    await onCommit(patch as Partial<UserSettings>);
  }

  let previewLines = $derived.by(() => {
    const lines: string[] = [];
    const name = trim(identitySettings.user_display_name ?? "");
    const role = trim(identitySettings.user_role ?? "");
    const tz = trim(identitySettings.user_timezone ?? "");
    if (name) lines.push(`- Display name: ${name}`);
    if (role) lines.push(`- Role: ${role}`);
    if (tz) lines.push(`- Timezone: ${tz}`);
    return lines;
  });

  let hasPreview = $derived(previewLines.length > 0);
</script>

<PersonalSection
  icon="circle-user"
  eyebrow={lk("personal_section_identity_eyebrow")}
  title={lk("personal_section_identity_title")}
  description={lk("personal_section_identity_desc")}
>
  <div class="grid gap-4 sm:grid-cols-2">
    <div class="space-y-1.5">
      <label
        for="personal-display-name"
        class="block text-xs font-medium uppercase tracking-wide text-muted-foreground"
      >
        {lk("personal_displayName")}
      </label>
      <input
        id="personal-display-name"
        type="text"
        value={identitySettings.user_display_name ?? ""}
        placeholder={lk("personal_displayNamePlaceholder")}
        autocomplete="off"
        onblur={(e) =>
          commitField("user_display_name", (e.currentTarget as HTMLInputElement).value)}
        onkeydown={(e) => {
          if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
        }}
        class="w-full rounded-md border border-sidebar-border/70 bg-sidebar/60 px-3 py-2 text-sm text-sidebar-foreground placeholder:text-muted-foreground/60 focus:border-ring/60 focus:outline-none focus:ring-1 focus:ring-ring/40"
      />
    </div>

    <div class="space-y-1.5">
      <label
        for="personal-handle"
        class="block text-xs font-medium uppercase tracking-wide text-muted-foreground"
      >
        {lk("personal_handle")}
      </label>
      <div class="flex items-stretch">
        <span
          class="inline-flex items-center rounded-l-md border border-r-0 border-sidebar-border/70 bg-sidebar/40 px-2 text-xs text-muted-foreground"
          aria-hidden="true">@</span
        >
        <input
          id="personal-handle"
          type="text"
          value={identitySettings.user_handle ?? ""}
          placeholder={lk("personal_handlePlaceholder")}
          autocomplete="off"
          onblur={(e) => commitField("user_handle", (e.currentTarget as HTMLInputElement).value)}
          onkeydown={(e) => {
            if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
          }}
          class="w-full rounded-r-md border border-sidebar-border/70 bg-sidebar/60 px-3 py-2 text-sm text-sidebar-foreground placeholder:text-muted-foreground/60 focus:border-ring/60 focus:outline-none focus:ring-1 focus:ring-ring/40"
        />
      </div>
    </div>

    <div class="space-y-1.5">
      <label
        for="personal-role"
        class="block text-xs font-medium uppercase tracking-wide text-muted-foreground"
      >
        {lk("personal_role")}
      </label>
      <input
        id="personal-role"
        type="text"
        value={identitySettings.user_role ?? ""}
        placeholder={lk("personal_rolePlaceholder")}
        autocomplete="off"
        onblur={(e) => commitField("user_role", (e.currentTarget as HTMLInputElement).value)}
        onkeydown={(e) => {
          if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
        }}
        class="w-full rounded-md border border-sidebar-border/70 bg-sidebar/60 px-3 py-2 text-sm text-sidebar-foreground placeholder:text-muted-foreground/60 focus:border-ring/60 focus:outline-none focus:ring-1 focus:ring-ring/40"
      />
    </div>

    <div class="space-y-1.5">
      <label
        for="personal-timezone"
        class="block text-xs font-medium uppercase tracking-wide text-muted-foreground"
      >
        {lk("personal_timezone")}
      </label>
      <input
        id="personal-timezone"
        type="text"
        value={identitySettings.user_timezone ?? ""}
        placeholder={lk("personal_timezonePlaceholder")}
        autocomplete="off"
        onblur={(e) => commitField("user_timezone", (e.currentTarget as HTMLInputElement).value)}
        onkeydown={(e) => {
          if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
        }}
        class="w-full rounded-md border border-sidebar-border/70 bg-sidebar/60 px-3 py-2 text-sm text-sidebar-foreground placeholder:text-muted-foreground/60 focus:border-ring/60 focus:outline-none focus:ring-1 focus:ring-ring/40"
      />
    </div>

    <div class="space-y-1.5 sm:col-span-2">
      <label
        for="personal-email"
        class="block text-xs font-medium uppercase tracking-wide text-muted-foreground"
      >
        {lk("personal_email")}
      </label>
      <input
        id="personal-email"
        type="email"
        value={identitySettings.user_email ?? ""}
        placeholder={lk("personal_emailPlaceholder")}
        autocomplete="off"
        onblur={(e) => commitField("user_email", (e.currentTarget as HTMLInputElement).value)}
        onkeydown={(e) => {
          if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
        }}
        class="w-full rounded-md border border-sidebar-border/70 bg-sidebar/60 px-3 py-2 text-sm text-sidebar-foreground placeholder:text-muted-foreground/60 focus:border-ring/60 focus:outline-none focus:ring-1 focus:ring-ring/40"
      />
      <p class="text-[11px] text-muted-foreground/80">{lk("personal_emailHelp")}</p>
    </div>
  </div>

  <div class="space-y-2">
    <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {lk("personal_previewTitle")}
    </p>
    <pre
      class="overflow-x-auto rounded-md border border-sidebar-border/40 bg-sidebar-accent/30 p-3 text-xs leading-relaxed text-sidebar-foreground/90">{hasPreview
        ? `User identity (MiWarp personal profile):\n${previewLines.join("\n")}`
        : lk("personal_previewEmpty")}</pre>
  </div>
</PersonalSection>
