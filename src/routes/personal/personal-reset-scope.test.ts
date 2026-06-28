/**
 * P0 regression — Personal profile reset must stay scoped.
 *
 * `src/routes/personal/+page.svelte` wires the "Reset profile" button to the
 * backend command that only touches personal-profile fields. Using the global
 * `reset_user_settings` (which wipes api keys, platform credentials, remote
 * hosts, webhook URLs, web server config / token, keybindings, and workspace
 * folders) here would silently brick the user's setup the moment they click
 * the button.
 *
 * This test enforces the invariant at three layers:
 *
 *   1. Source-level: the Personal page imports `resetPersonalProfile` from
 *      `$lib/api` and does NOT import `resetUserSettings`.
 *   2. Command surface: the backend command name `reset_personal_profile` is
 *      registered in the shared `CMD` table that the transport layer
 *      consults. The legacy `reset_user_settings` stays registered for the
 *      Settings page (typed-confirmation global reset).
 *   3. i18n: both `en.json` and `zh-CN.json` expose the new scope copy so
 *      the user sees "ONLY personal data will be reset" in both languages.
 *
 * The tests are file-system reads — they don't import the Svelte module —
 * because `+page.svelte` pulls in the entire app shell and would explode
 * the test runtime. Behavioural coverage of the actual reset semantics
 * lives in the Rust tests under `src-tauri/src/storage/settings.rs`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../../..");

function readSource(relPath: string): string {
  return readFileSync(resolve(REPO_ROOT, relPath), "utf-8");
}

describe("Personal profile reset — call-site scope", () => {
  const personalPageSource = readSource("src/routes/personal/+page.svelte");

  it("Personal page imports the scoped resetPersonalProfile helper", () => {
    expect(personalPageSource).toContain("resetPersonalProfile");
    expect(personalPageSource).toMatch(
      /import\s*\{[^}]*resetPersonalProfile[^}]*\}\s*from\s*"\$lib\/api"/,
    );
  });

  it("Personal page does NOT import the global resetUserSettings helper", () => {
    // The legacy global reset is reserved for the Settings page (typed
    // `RESET` confirmation). If a future refactor reintroduces it on the
    // Personal page, this test fires before the change ships.
    expect(personalPageSource).not.toMatch(/resetUserSettings/);
  });

  it("Personal page handler routes through the scoped API function", () => {
    expect(personalPageSource).toMatch(/handleReset[\s\S]*?resetPersonalProfile\(\)/);
  });
});

describe("Backend command surface", () => {
  const cmdSource = readSource("src/lib/tauri-commands.ts");

  it("reset_personal_profile is registered in the shared CMD table", () => {
    expect(cmdSource).toMatch(/reset_personal_profile:\s*"reset_personal_profile"/);
  });

  it("reset_user_settings remains registered for the Settings-page global reset", () => {
    // Belt-and-suspenders: we must NOT remove the global command — the
    // Settings page's typed-RESET confirmation still uses it.
    expect(cmdSource).toMatch(/reset_user_settings:\s*"reset_user_settings"/);
  });

  const apiSource = readSource("src/lib/api.ts");

  it("api.ts exposes a resetPersonalProfile() wrapper", () => {
    expect(apiSource).toMatch(/export\s+async\s+function\s+resetPersonalProfile\(/);
    expect(apiSource).toContain("reset_personal_profile");
  });

  it("api.ts wrapper documents the credential-preservation guarantee", () => {
    // The doc comment on resetPersonalProfile must spell out that api keys,
    // platform credentials, remote hosts, webhook URLs, web server config,
    // keybindings, and workspace folders are preserved. Without that, a
    // future cleanup could quietly rename it back to the global helper.
    const wrapperIndex = apiSource.indexOf("export async function resetPersonalProfile");
    expect(wrapperIndex, "resetPersonalProfile wrapper not found").toBeGreaterThan(-1);
    const docStart = apiSource.lastIndexOf("/**", wrapperIndex);
    expect(docStart, "personal-reset doc-comment block not found").toBeGreaterThan(-1);
    const bodyEnd = apiSource.indexOf("\n}", wrapperIndex);
    // Normalize whitespace so cross-line terms ("AI preferences") match too.
    const block = apiSource
      .slice(docStart, bodyEnd + 2)
      // Strip JSDoc line-prefixes (` * `) and collapse remaining whitespace so
      // cross-line terms like "AI preferences" match as a single token.
      .replace(/^\s*\* ?/gm, "")
      .replace(/\s+/g, " ");
    expect(block, "block should contain identity").toMatch(/identity/i);
    expect(block, "block should contain AI preferences").toMatch(/ai\s+preferences/i);
    expect(block, "block should mention api keys").toMatch(/api\s*keys?|api_key/i);
    expect(block, "block should mention platform credentials").toMatch(/platform\s*credentials?/i);
    expect(block, "block should mention remote hosts").toMatch(/remote\s*hosts?/i);
    expect(block, "block should mention webhooks").toMatch(/webhook/i);
    expect(block, "block should mention web server").toMatch(/web\s*server/i);
    expect(block, "block should mention keybindings").toMatch(/keybinding/i);
  });
});

describe("i18n — Personal reset scope copy", () => {
  const REQUIRED_KEYS = [
    "personal_data_reset",
    "personal_data_resetDesc",
    "personal_data_resetButton",
    "personal_data_resetConfirm",
    "personal_data_resetAgain",
    "personal_reset_done",
    "personal_data_resetScopeTitle",
    "personal_data_resetScopeKept",
  ] as const;

  for (const locale of ["en", "zh-CN"] as const) {
    const messages = JSON.parse(readSource(`messages/${locale}.json`)) as Record<string, string>;

    it(`${locale}.json defines every required Personal-reset key`, () => {
      for (const key of REQUIRED_KEYS) {
        expect(messages[key], `missing key ${key} in messages/${locale}.json`).toBeTypeOf("string");
        expect(messages[key].length, `empty translation for ${key}`).toBeGreaterThan(0);
      }
    });

    it(`${locale}.json copy explicitly says the reset is scoped to personal data only`, () => {
      // The confirm-state copy must tell the user that ONLY personal fields
      // are reset (and that credentials / webhooks / web server / keybindings
      // are preserved). Otherwise the previous bug — reset wipes everything —
      // comes back the next time a translator rewrites the strings.
      const scope = messages.personal_data_resetScopeTitle.toLowerCase();
      expect(scope).toMatch(/personal|profile|个人/);
      const kept = messages.personal_data_resetScopeKept.toLowerCase();
      expect(kept).toMatch(/api|key|credential|密钥|凭据/);
      expect(kept).toMatch(/webhook/);
      expect(kept).toMatch(/keybinding|快捷键/);
    });
  }
});

describe("Svelte component — PersonalDataCard confirms the scope", () => {
  const cardSource = readSource("src/lib/components/personal/PersonalDataCard.svelte");

  it("renders the scoped-scope copy in the confirm state", () => {
    expect(cardSource).toContain("personal_data_resetScopeTitle");
    expect(cardSource).toContain("personal_data_resetScopeKept");
  });

  it("shows the scope copy only after the user has clicked reset once", () => {
    // The explicit scope copy is a guard rail — it must only appear after
    // the first click of the reset button, not as the default state.
    const guardedBlock = cardSource.match(
      /\{#if\s+confirmReset\}[\s\S]*?personal_data_resetScopeTitle[\s\S]*?\{\/if\}/,
    );
    expect(guardedBlock, "scope copy must be gated on confirmReset").toBeTruthy();
  });

  it("forwards the reset action through the onReset callback prop", () => {
    expect(cardSource).toMatch(/function\s+confirmAndReset[\s\S]*?await\s+onReset\(\)/);
  });
});
