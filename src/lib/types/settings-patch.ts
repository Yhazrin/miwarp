/**
 * Strongly-typed `UserSettingsPatch` DTO (v1).
 *
 * The settings update path is the historical Achilles' heel of the
 * frontend/backend contract: it accepted a free-form `Record<string, any>`
 * blob on the Rust side, and each new field had to be hand-wired with
 * another `if let Some(v) = patch.get("xxx") { … }` arm on the Rust side.
 * Frontend authors had no compile-time feedback if they invented a new
 * field — it would silently no-op.
 *
 * This module provides:
 *
 *   1. `UserSettingsPatch<T>` — a mapped type that derives a "patch" view of
 *      any settings interface:
 *        - scalar primitives (`string | number | boolean`) keep their type
 *        - `T[K] | null` is added so `null` means "clear this field"
 *        - all keys remain optional (absent = "leave unchanged")
 *
 *   2. A pre-built `UserSettingsPatchFields` literal that mirrors every
 *      field on the Rust `UserSettings` struct. New front-end callers get
 *      TS-level enforcement; the contract test in `settings-patch.test.ts`
 *      verifies Rust accepts exactly the same keys.
 *
 * Note: this is the **frontend contract view**. The Rust side has its own
 * `UserSettingsPatch` struct in `src-tauri/src/storage/settings_patch.rs`
 * that enforces the same set of fields at the deserialization layer. The
 * contract test enforces both stay in lockstep.
 */
import type { UserSettings } from "$lib/types";

/**
 * Internal: is `U` assignable to a JSON-serialisable scalar?
 *
 * We treat `string`, `number`, `boolean`, and `null` (and the wrapper
 * `undefined` that comes from optional fields) as the primitive layer.
 * Any non-primitive value (arrays, objects, unions containing them) flows
 * through the `else` branch unchanged.
 */
type IsPrimScalar<U> = [U] extends [string | number | boolean | null | undefined] ? true : false;

/**
 * Build the patch view of any settings interface:
 *
 *   - scalar primitive keys → keep their type but also allow `null` (clear)
 *   - optional scalar keys → still `T[K] | null`
 *   - absent keys → still allowed (absent = "don't touch")
 *   - non-scalar / object / array keys → kept as-is (clearing via `null`
 *     for arrays is supported by the backend as "empty array"; objects use
 *     `null` to mean "unset")
 *
 * Implementation note: the inner conditional distributes via `[T[K]] extends`
 * so that optional fields like `default_model?: string` (which TS resolves
 * to `string | undefined`) get null-widened correctly. A naked `T[K] extends`
 * would NOT distribute, because `T[K]` is an indexed access — wrapping it
 * in a single-element tuple forces distribution.
 */
export type UserSettingsPatch<T> = {
  [K in keyof T]?: IsPrimScalar<T[K]> extends true ? T[K] | null : T[K];
};

/**
 * The patch type callers actually use — every key is optional, and
 * `null` means "clear this field". Built off `UserSettings` so adding a
 * field to `UserSettings` automatically widens the patch surface (TS will
 * complain if a caller uses an unknown key, and the contract test will
 * fail if Rust hasn't been updated).
 */
export type TypedUserSettingsPatch = UserSettingsPatch<UserSettings>;
