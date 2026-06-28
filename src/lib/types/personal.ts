/**
 * Personal Profile Export DTO — v1.
 *
 * `UserSettings` carries a wide mix of data: identity, AI preferences,
 * display chrome, AND every credential / provider config the user has
 * configured (api keys, platform credentials, remote hosts, webhook URLs,
 * auth tokens). Exposing the whole struct as a "personal profile export"
 * is a data-leakage path: a user clicking "Download JSON" gets a file
 * containing every secret in plain text.
 *
 * This DTO is the explicit, whitelisted shape that ships to disk. Anything
 * NOT in this interface MUST NOT be present in the exported payload. New
 * exportable fields go here after a code review — the absence of a field
 * is the safety guarantee.
 *
 * Schema is "miwarp.personal-profile/v1". Bump the version when adding
 * a field; downstream consumers (or future re-import tooling) can then
 * gate on the schema string instead of guessing by field shape.
 */
export interface PersonalProfileExportDto {
  schema: "miwarp.personal-profile/v1";
  exportedAt: string;
  identity: {
    displayName: string;
    handle: string | null;
    role: string | null;
    timezone: string | null;
  };
  preferences: {
    defaultAgent: string | null;
    defaultModel: string | null;
    defaultSessionMode: string | null;
    uiZoom: number | null;
  };
  statistics: {
    runs7d: number;
    skillCount: number;
    providerCount: number;
  };
}
