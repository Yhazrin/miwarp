# MiWarp v1.0.9 Performance Contract

> **Scope**: the measurement contract, harness, and comparison gate behind the
> "70% faster / 90% fewer failures" goal for v1.0.9.
>
> **Audience**: anyone running the benchmark, comparing two builds, or
> adjusting the 70/90 thresholds.

## TL;DR

```bash
# 1. Capture a baseline JSON from an older build (or your local pre-v1.0.9 commit)
#    in Tauri dev, with debug enabled:
#    localStorage.setItem('ocv:debug', '1')   # or visit ?debug
#    await window.__mwPerf.runAll(30)
#    copy(JSON.stringify(window.__mwPerf.exportContract()))
#    → save as artifacts/perf-baseline.json

# 2. Capture a current JSON from this build, same machine, same conditions:
#    await window.__mwPerf.runAll(30)
#    copy(JSON.stringify(window.__mwPerf.exportContract()))
#    → save as artifacts/perf-current.json

# 3. Compare (Node, zero deps):
npm run perf:compare -- artifacts/perf-baseline.json artifacts/perf-current.json
# exit 0 → PASS, exit 1 → FAIL, exit 3 → sample rejection
```

---

## 1. What is being measured

Six scenarios, each bounded at a single user-visible transition. None of them
automatically invoke a real Claude/Codex run — every scenario is a **workload
proxy** that exercises the same algorithmic code path the real interaction
hits, without paying for model tokens.

| Scenario id | What it proxies | Where the real code path lives |
|---|---|---|
| `settings.firstOpen` | Cold-open the Settings page; demand-loading dedupe saves 3–4 IPC ticks | `src/routes/settings/+page.svelte` `onMount` + `SettingsTabLoadController.ensureTabLoaded` |
| `settings.hotOpen` | Re-enter Settings with the tab controller already loaded | Same controller, `inFlight.get(tab)` short-circuit |
| `settings.closeToChat` | Leave Settings → return to Chat; cache restore avoids subtree re-mount | `chatViewCache.lastRunId` + lazy mount in `+layout.svelte` |
| `session.switchToInteractive` | Switch from run A to run B; loadRunProgressive enables input before full parse | `src/lib/chat/use-scroll-navigation.ts loadRunProgressive` |
| `page.reloadRestore` | Full page reload; chat state hydrates from cache + 1 IPC | `chatViewCache` + `chat-bootstrap-cache` |
| `timeline.1200FirstPaint` | Open a 1200-entry timeline; mount limit cap drops mounted entries from 1200 → ~150 | `src/lib/chat/selectors/timeline-presentation getInitialRenderLimit` |

The `meta` field on every sample carries a small set of structural
discriminators (`strategy`, `tabCount`, `mountedEntries`,
`mountReductionPct`, …) so the comparison can reason about *what* changed,
not just *how much*.

---

## 2. Workload proxy vs real WebView p95 — what this contract does NOT measure

This is the single most important caveat. Every number in a PerfContract JSON
file is one of:

- **`workloadKind: "proxy"`** — the harness ran a synthetic JS workload
  shaped to look like the real interaction. It tells you whether the
  *algorithmic* / *structural* improvement is in place (demand-loading dedupe,
  render-limit cap, cache hit short-circuit).
- **`workloadKind: "real"`** — a span was started and ended around the real
  business call site (e.g., `perfMarkAsync("settings.firstOpen", () => loadSettingsPageCore(...))`).
  The duration is wall-clock time inside that boundary, including the IPC
  round-trip if the call site hits Tauri. It still does NOT include GPU
  paint, browser reflow, or first-input latency.

**Neither kind measures the real WebView paint time.** Real paint p95
requires DevTools Performance, WebPageTest, or a controlled Lighthouse run on
the built Tauri bundle. Use the proxy/real numbers here to catch
*regressions in the code path* (e.g., a refactor that accidentally removes
the dedupe) — not to claim an end-user-perceptible latency win.

The `scripts/perf-compare.mjs` tool refuses to compare a `real` baseline
against a `proxy` current (or vice versa) because the structural difference
makes the percentage meaningless.

---

## 3. Reproducing the 30-run benchmark

These constraints are mandatory; otherwise the numbers are not comparable
across runs:

1. **Same machine.** macOS arm64 vs x86_64, M-series vs Intel, or Linux vs
   Windows, each have different `performance.now()` resolution and event
   loop characteristics. Do not compare JSONs captured on different hosts.
2. **Same build.** Capture the baseline from a known commit (`git rev-parse HEAD`
   into the JSON's `build` field) and the current from the same repo state.
   Do not mix a Tauri dev build with a Tauri release build — release builds
   dead-code-eliminate the harness entirely.
3. **Cold vs warm.** Decide upfront. The harness defaults to `cold: true`
   for every scenario; if you need warm-cache numbers, run `window.__mwPerf.runAll(30)`
   twice and discard the first run (the controller dedupes once the cache is
   hot).
4. **30 iterations, not 1, not 100.** 30 keeps p95 noise bounded; 100 inflates
   the time without adding signal. The `anomalyTrimPct: 5` default trims
   the top/bottom 5% so a single browser GC pause does not poison the gate.
5. **No other heavy load.** Close other tabs, pause background syncs, and
   stop any `tauri dev` hot-reload before starting the run.
6. **No real model invocation.** The harness never calls Claude/Codex — it
   simulates the structural IPC cost with synthetic delays. Do not route the
   harness through a live provider just to "make it more realistic"; the
   structural comparison becomes invalid.

### Step-by-step in Tauri dev

```bash
# 1. Launch
npm run tauri dev

# 2. In the WebView devtools console:
localStorage.setItem('ocv:debug', '1')   # or append ?debug to the URL
# Reload once so the layout onMount installs window.__mwPerf

# 3. Optional sanity check:
window.__mwPerf.scenarios().map(s => s.label)

# 4. Run all 6 scenarios × 30 iterations:
const summary = await window.__mwPerf.runAll(30)
console.table(summary.byScenario)

# 5. Export JSON:
copy(window.__mwPerf.exportJson())
# → paste into artifacts/perf-current.json

# 6. Reset between captures (so multiple builds share a clean slate):
window.__mwPerf.reset()
```

### Step-by-step for a baseline from an older commit

```bash
git checkout <baseline-tag-or-sha>
npm install
npm run tauri dev
# capture as in steps 2–5 above into artifacts/perf-baseline.json
git checkout -
```

---

## 4. Schema (excerpt)

```jsonc
{
  "schemaVersion": 1,
  "capturedAt": "2026-06-22T12:34:56.789Z",
  "build": "dev",
  "platform": "darwin",
  "transport": "tauri",
  "thresholds": {
    "latencyImprovementPct": 70,
    "failureReductionPct": 90,
    "minSamples": 30,
    "anomalyTrimPct": 5
  },
  "samples": [
    {
      "schemaVersion": 1,
      "scenario": "settings.firstOpen",
      "durationMs": 42.318,
      "success": true,
      "workloadKind": "real",
      "cold": true,
      "run": 1,
      "meta": { "iter": 1, "strategy": "demand", "tab": "general" },
      "ts": "2026-06-22T12:34:57.012Z"
    }
  ],
  "failures": []
}
```

Full types live in [`src/lib/perf/contract.ts`](../../src/lib/perf/contract.ts).

### What is and is not allowed in `meta`

The recorder enforces an explicit allow-list (`SAFE_META_KEYS`). Any key
not in the list is dropped at the boundary. Values are capped (strings ≤ 64
chars, numbers finite). The following are *never* recorded:

- Prompt text or message bodies
- Token counts, API keys, OAuth secrets
- Environment variables, file paths beyond safe structural labels
- Anything that varies per user beyond what is needed to interpret the metric

---

## 5. The 70 / 90 gate

`scripts/perf-compare.mjs` reads two JSONs and applies:

- **Latency**: `current.p95 < baseline.p95 × (1 - 0.70)` — i.e. current must
  be ≥ 70% faster than baseline on the trimmed p95.
- **Failure rate**: `current.failureRate ≤ baseline.failureRate × 0.10` —
  i.e. current must have at least 90% fewer failures than baseline.

Both thresholds are configurable:

```bash
npm run perf:compare -- \
  --latency 80 \
  --failure 95 \
  --min-samples 20 \
  artifacts/perf-baseline.json artifacts/perf-current.json
```

Exit codes:

| Code | Meaning |
|---|---|
| 0 | Passed |
| 1 | Failed (one or more scenarios below threshold) |
| 2 | Bad input (missing files, schema mismatch, bad JSON) |
| 3 | Sample rejection (one side below `minSamples`) |

`--json` emits a machine-readable payload suitable for CI annotation.
`--dry-run` prints the verdict but always exits 0 (useful for dashboards).

---

## 6. What is NOT in scope for this contract

These belong to separate tools, not the perf contract:

- **Real WebView paint time** — DevTools / Lighthouse / WebPageTest
- **First-input latency (FID)** — Chrome UX report or similar
- **Cold-start to interactive** — captured by Tauri's `tauri-cli` build
  timing output, not by this harness
- **Token / cost efficiency** — model provider dashboards
- **Long-session scroll FPS** — `perfMark("fps", ...)` style instrumentation
  in `src/lib/utils/perf.ts`; orthogonal to the 6 scenarios here

If you find yourself wanting to fold any of those into the comparison gate,
that's a sign you need a separate run + comparison tool, not a threshold
tweak in this one.

---

## 7. Limitations of the workload proxy

The proxy scenarios approximate *shape*, not magnitude. They are most useful
for catching **structural regressions** — refactors that accidentally remove
the dedupe, lose the cache hit, or re-introduce the eager mount — because
those show up as a step-change in the recorded durations.

They are less useful for:

- **Sustained perf drift** — small slowdowns (5–10%) may hide inside the
  ±20% jitter the synthetic delays already introduce.
- **Absolute numbers** — a `settings.firstOpen` of "42 ms" in the JSON
  refers to the synthetic IPC shape, not the user-perceived open time.
- **Cross-host comparisons** — `performance.now()` resolution and the JS
  engine's microtask scheduling differ across machines. Always compare
  baseline vs current on the **same** machine.

If the gate fails but you can't reproduce the regression manually, the next
step is to bisect with a real Tauri release build + DevTools, not to retune
the thresholds.

---

## 8. Files

| File | Role |
|---|---|
| `src/lib/perf/contract.ts` | Types, span lifecycle, aggregation, gate (no DOM, no IPC) |
| `src/lib/perf/harness.ts` | Browser-side runner + `window.__mwPerf` injection |
| `src/lib/perf/contract.test.ts` | Deterministic tests for percentile / cancel / timeout / gate |
| `src/lib/perf/harness.test.ts` | Deterministic tests for runner API surface |
| `scripts/perf-compare.mjs` | Node CLI that compares two JSONs |
| `scripts/__tests__/perf-compare.test.ts` | Vitest wrapper for the CLI |
| `src/routes/+layout.svelte` | Calls `installWindowHarness` when perf mode is on |
| `src/routes/settings/+page.svelte` | `perfMarkAsync` around `loadSettingsPageCore` + tab fetchers |
| `src/routes/chat/+page.svelte` | `perfMarkAsync` around `loadRunProgressive` |
| `package.json` | Adds `perf:compare` script (Node only, no new deps) |

---

## 9. Quick checklist before pushing a build

- [ ] `npm test` — all perf tests pass (50 contract/harness + 11 compare)
- [ ] `npm run check` — 0 errors / 0 warnings
- [ ] `npm run lint` — 0 errors (warnings tolerated, they are pre-existing)
- [ ] `npm run format:check` — clean
- [ ] `npm run build` — adapter-static build succeeds
- [ ] `npm run perf:compare -- <baseline> <current>` — exits 0 (or document
      why a temporary threshold override is justified)
