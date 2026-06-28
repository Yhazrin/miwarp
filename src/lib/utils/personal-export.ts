/**
 * Personal Profile Export builder.
 *
 * The export is the JSON the user downloads from the Personal page's
 * "Export profile" button. Security model:
 *
 *   1. NEVER serialize the whole `UserSettings` blob. It contains
 *      `anthropic_api_key`, `platform_credentials[*].api_key`,
 *      `remote_hosts[*]` (with SSH keys), and webhook URLs that have
 *      already caused secret leakage in the past.
 *   2. Build the payload from a fixed whitelist of fields, mapping each
 *      into the `PersonalProfileExportDto` shape. Anything not on the
 *      whitelist simply cannot end up in the file.
 *   3. `exportedAt` is captured at build time so re-exports of the same
 *      settings produce distinct, traceable artifacts.
 *
 * The function is pure — no IO, no DOM access, no transport. The caller
 * (the Svelte component) is responsible for blobifying the result and
 * triggering the download; this module exists to be unit-testable in
 * node and to make the whitelist visible at code review.
 */
import type { UserSettings } from "$lib/types";
import type { PersonalProfileExportDto } from "$lib/types/personal";

export interface PersonalExportStats {
  runs7d: number;
  skillCount: number;
  providerCount: number;
}

const EMPTY_STATS: PersonalExportStats = {
  runs7d: 0,
  skillCount: 0,
  providerCount: 0,
};

function asNonEmptyString(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "";
}

function asOptionalString(value: unknown): string | null {
  const normalized = asNonEmptyString(value);
  return normalized.length > 0 ? normalized : null;
}

function asOptionalNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

/**
 * Build the export payload from the current `UserSettings` and an
 * externally-supplied statistics snapshot.
 *
 * `stats` is intentionally injected: `UserSettings` itself does not
 * carry per-card UI counts (they live in derived stores like
 * `activity.runs7d`, `skillCount`, and the platform_credentials length).
 * The caller assembles them and passes them in so the export stays
 * a pure function of (settings, stats) and the caller's contract
 * with future telemetry sources is explicit.
 */
export function buildPersonalProfileExport(
  settings: UserSettings,
  stats: PersonalExportStats = EMPTY_STATS,
): PersonalProfileExportDto {
  const safeStats: PersonalExportStats = {
    runs7d: typeof stats?.runs7d === "number" && Number.isFinite(stats.runs7d) ? stats.runs7d : 0,
    skillCount:
      typeof stats?.skillCount === "number" && Number.isFinite(stats.skillCount)
        ? stats.skillCount
        : 0,
    providerCount:
      typeof stats?.providerCount === "number" && Number.isFinite(stats.providerCount)
        ? stats.providerCount
        : 0,
  };

  return {
    schema: "miwarp.personal-profile/v1",
    exportedAt: new Date().toISOString(),
    identity: {
      displayName: asNonEmptyString(settings.user_display_name),
      handle: asOptionalString(settings.user_handle),
      role: asOptionalString(settings.user_role),
      timezone: asOptionalString(settings.user_timezone),
    },
    preferences: {
      defaultAgent: asOptionalString(settings.default_agent),
      defaultModel: asOptionalString(settings.default_model),
      defaultSessionMode: asOptionalString(settings.default_session_mode),
      uiZoom: asOptionalNumber(settings.ui_zoom),
    },
    statistics: safeStats,
  };
}
