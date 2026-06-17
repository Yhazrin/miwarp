/**
 * Public surface of the reducers/ subpackage.
 *
 * Internal callers should import the specific reducer (e.g. `reduceRateLimit`)
 * or the REDUCERS registry directly. This barrel exists so other modules can
 * `import type { ReduceCtx, Reducer, SessionStoreReducers } from "./reducers"`.
 */
export type { ReduceCtx, Reducer, SessionStoreReducers } from "./types";
export { REDUCERS } from "./registry";
export { reduceRateLimit } from "./rate-limit";
