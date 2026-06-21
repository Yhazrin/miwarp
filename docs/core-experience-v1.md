# MiWarp Core Experience v1

> Status: active release gate for v1.0.8 and later  
> Initiative: MiWarp Core Reliability Initiative  
> Product promise: the most stable, transparent, and provider-flexible desktop workspace for Claude Code-compatible agents.

## 1. Product priority

MiWarp development is split into three layers:

1. **CC execution foundation** — model connection, process lifecycle, streaming, tool calls, permissions, file changes, terminal, Git, resume, stop, retry, and failure recovery.
2. **Engineering experience** — session management, trustworthy diff, file preview, concurrent tasks, mobile approval, provider compatibility, long-task recovery, and project context.
3. **Personal AI** — memory, Life Mission, Personal Inbox, life data, digital twin, and proactive long-running agents.

Until Core Experience v1 exits the release gate, capacity allocation is:

- 70% execution foundation;
- 25% engineering experience;
- 5% Personal AI research that does not consume foundation delivery capacity.

## 2. Exit rule

Core Experience v1 is complete only when all blocking gates pass and the evidence is reproducible from a clean checkout.

A feature being present is not evidence that it is reliable. Evidence must come from:

- automated contract, unit, integration, and build checks;
- scenario-based end-to-end runs;
- fault injection and recovery checks;
- measured performance budgets;
- a seven-day real-project soak with no unresolved blocker.

### Blocking release gates

- No known P0 or P1 issue in session start, streaming, tool execution, permission approval, file mutation, stop, resume, or recovery.
- No duplicate or out-of-order user-visible message in the E2E scenario suite.
- Diff content matches disk and Git state for all tested mutation paths.
- App restart, process crash, network loss, sleep/wake, and reconnect have explicit tested outcomes.
- Tier 1 providers pass the same compatibility contract.
- Desktop and mobile approval state cannot diverge silently.
- Diagnostic export identifies session, provider, process, transport, and failing operation without exposing secrets.
- CI passes on frontend, Rust, Android, and iOS.
- Version metadata is aligned across npm, Tauri, Rust, iOS, and Android.

## 3. Twelve acceptance domains

### 3.1 Startup

- Detect the required CLI and report its path and version.
- Give an actionable recovery path for missing or incompatible dependencies.
- Validate provider credentials and endpoint connectivity before starting work.
- Classify startup failures instead of returning a generic failure.
- Measure cold start, workspace open, session start, and first-token latency.

### 3.2 Chat and event consistency

- A user message is submitted exactly once.
- Streaming text, thinking, tool calls, and completion events preserve protocol order.
- Reconnect and replay do not duplicate events.
- Session switching cannot route events into another session.
- Long output does not block input, scrolling, or stop actions.
- Draft input survives non-destructive navigation and expected reconnects.

### 3.3 Tool calls

- Read, Edit, Write, Bash, Grep, Glob, task, and MCP tools have typed views.
- Unknown tools fall back to a complete generic card instead of disappearing.
- Parallel tools keep independent IDs, progress, result, cancellation, and error state.
- Tool start, delta, end, denial, timeout, and cancellation are distinguishable.

### 3.4 Permissions

Every permission request must present:

- requested action;
- reason or task context;
- affected files, command, host, or resource;
- risk classification;
- one-time, persistent, and reject choices when supported;
- the expected consequence of rejection;
- pending request count and origin session.

Raw protocol JSON is diagnostic detail, not the primary interface.

### 3.5 Files and diff

- Show before/after content and mutation type: add, edit, delete, rename, binary, or conflict.
- Separate agent changes, user changes, and pre-existing Git changes.
- Match the latest disk state and show stale-snapshot warnings.
- Support file-level rollback and tool-call-level rollback where provenance exists.
- Large diff rendering is virtualized or bounded and cannot freeze the application.
- Conflict and partial-write states are explicit.

### 3.6 Terminal

- Preserve stdout, stderr, ANSI semantics, command, working directory, exit code, and termination reason.
- Stop terminates the intended process tree without leaving hidden children.
- Interactive-command limitations are visible before execution.
- Output backpressure cannot freeze the session event stream.

### 3.7 Git

- Status and diff are refreshed from the repository rather than inferred from agent messages.
- Commit scope is previewed and unrelated user files are excluded by default.
- Push shows remote and branch before execution.
- Merge conflicts and detached HEAD are treated as explicit states.
- Rollback never silently discards unrelated user work.

### 3.8 Provider compatibility

Providers are published in three tiers:

- **Tier 1 — fully validated:** automated conversation, streaming, thinking, tool use, permission, file edit, stop, resume, error, and long-output scenarios pass.
- **Tier 2 — usable:** basic conversation and core tools pass; unsupported capabilities are declared.
- **Tier 3 — experimental:** best-effort adapter with incomplete compatibility evidence.

The matrix records:

| Capability       | Required evidence                                        |
| ---------------- | -------------------------------------------------------- |
| Authentication   | valid, invalid, expired, proxy, and unreachable endpoint |
| Streaming        | ordered text and thinking deltas, cancellation           |
| Tool use         | typed tool calls, parallel calls, failure payloads       |
| Files            | read, create, edit, delete, rename, large diff           |
| Resume           | CLI conversation ID and event checkpoint recovery        |
| Images           | supported, rejected, and oversized behavior              |
| Prompt cache     | capability declaration and accounting                    |
| Errors           | normalized category plus preserved provider detail       |
| Protocol version | last verified CLI/protocol version and date              |

Claims such as “supports N providers” are not release evidence without this matrix.

### 3.9 History and recovery

A recoverable session persists or can reconstruct:

- MiWarp session and run IDs;
- CLI conversation ID;
- cwd and worktree identity;
- provider, model, and relevant launch settings;
- last committed event sequence;
- active permission and tool state;
- file mutation provenance;
- current Git identity and divergence from the saved snapshot.

If execution cannot be resumed safely, MiWarp opens a read-only history with a precise reason.

### 3.10 Web and mobile

The initial cross-device contract is intentionally narrow:

- view current status and recent output;
- receive and resolve permission requests;
- send a message;
- stop a run;
- observe completion or failure.

Desktop remains authoritative for local process and file state. Reconnect must reconcile from server sequence checkpoints rather than trusting stale local UI state.

### 3.11 Performance

Every release records p50 and p95 where meaningful for:

- application cold start;
- workspace open;
- new session start;
- first token;
- 1,000-session history load;
- long-session open and incremental append;
- large diff open and scroll;
- idle memory and CPU;
- three-hour active-session memory growth;
- reconnect and resume.

A regression above the agreed budget blocks release unless explicitly accepted with an owner and removal date.

### 3.12 Diagnostics and observability

Structured diagnostics include:

- trace ID, session ID, run ID, request ID, and tool-call ID;
- application, CLI, adapter, and protocol versions;
- provider category without secrets;
- connection state and last transition;
- process state and exit reason;
- event sequence and replay decision;
- permission state;
- network and proxy summary;
- normalized error category plus safe original detail.

Diagnostic bundles must redact credentials, tokens, authorization headers, sensitive environment values, and private prompt/file content unless the user explicitly includes it.

## 4. Reliability workstreams

### A. Session reliability

- event ordering and deduplication;
- single-owner subscription lifecycle;
- stop and process-tree cleanup;
- resume and replay checkpoints;
- app/CLI crash recovery;
- multi-session isolation;
- sleep/wake and network transition behavior.

### B. Provider compatibility

- declarative provider capability registry;
- automated minimum conversation contract;
- tool-use and error normalization fixtures;
- resume capability checks;
- protocol-version tracking.

### C. Interaction quality

- input and draft behavior;
- streaming scroll behavior;
- tool and permission cards;
- diff navigation and rollback;
- loading, empty, retry, degraded, and fatal states.

### D. Performance

- long sessions and large projects;
- large output and diff virtualization;
- history indexing and pagination;
- memory leak and retained-listener checks;
- page and session switching latency.

### E. Observability

- structured logs and correlation IDs;
- failure taxonomy;
- diagnostics screen;
- redacted support bundle;
- release-level reliability metrics.

## 5. Scenario-based E2E suite

### Scenario 1 — complete engineering task

Open MiWarp → select project → start session → send change request → read files → approve requested action → edit code → run tests → inspect diff → commit.

Assertions:

- no duplicate input or output;
- tool order and status are correct;
- permission copy describes impact;
- disk, diff, and Git agree;
- commit contains only approved files.

### Scenario 2 — interrupted application

Start a task → force-close MiWarp during streaming/tool work → reopen → restore session → verify no duplicate event → continue or enter explicit degraded history.

### Scenario 3 — process failure

Start a task → terminate the agent process → observe classified failure → retry or resume → verify old process and requests are cleaned up.

### Scenario 4 — network loss

Start a remote/provider request → disconnect network → reconnect → resume or retry → verify no duplicate tool execution and monotonic event sequence.

### Scenario 5 — provider matrix

For every Tier 1 provider: start → stream → think → tool call → file edit → error → stop → resume.

### Scenario 6 — mobile approval

Run desktop task → receive mobile request → approve once → desktop continues → both clients converge on the same request and run state.

### Scenario 7 — sleep and wake

Run a long task → sleep computer → wake → reconcile process, transport, subscriptions, timers, and UI without silent stale state.

### Scenario 8 — concurrent sessions

Run multiple sessions with parallel tools → switch rapidly → stop one → approve another → verify event, permission, and output isolation.

## 6. Maturity score

Each domain is scored weekly from 0 to 100:

- 40 points: automated correctness and contract evidence;
- 25 points: scenario E2E evidence;
- 15 points: fault and recovery evidence;
- 10 points: measured performance within budget;
- 10 points: diagnostics and operator usability.

Rules:

- a known P0 caps the affected domain at 30;
- a known P1 caps it at 60;
- an untested recovery path caps it at 75;
- a provider claim without matrix evidence does not score;
- stale evidence from an older protocol or CLI version is discounted.

Core Experience v1 exits when:

- weighted average is at least 90;
- message consistency and diff trust are at least 98;
- session reliability is at least 95;
- no blocking gate is open;
- seven-day soak succeeds.

## 7. Seven-day soak

The soak uses real repositories and normal daily work, not a synthetic idle run.

Record for every session:

- provider/model and CLI version;
- start, first token, completion, stop, resume, and reconnect timings;
- permission count and decision latency;
- duplicate, missing, reordered, or stale events;
- process leaks or forced restarts;
- diff/Git mismatch;
- memory and CPU samples;
- diagnostic quality when an error occurs.

A blocker resets the seven-day clock after the fix is merged. Non-blocking defects require an owner and target release.

## 8. Current v1.0.8 foundation evidence

As of 2026-06-21:

- browser/desktop: 1,627 tests pass;
- Rust: 462 library tests pass, formatting and Clippy are clean;
- iOS: 84 SwiftPM tests and 84 simulator tests pass;
- Android: 48 JVM tests pass, Lint has 0 errors, Debug APK builds;
- WebSocket connection lifecycle, request registry, run subscription ownership, single-flight recovery, and bounded cross-platform chunk assembly are documented and tested;
- architecture and cross-platform command contracts run in CI;
- version alignment covers npm, Tauri, Rust, iOS, and Android;
- GitHub Actions now contains frontend, Rust, Android, and iOS gates.

This evidence proves a stronger foundation. It does **not** by itself complete the seven-day soak, the full provider matrix, performance budgets, or every scenario E2E flow.

## 9. Next execution order

1. Build the scenario E2E harness around session start, permission, edit, test, diff, commit, stop, and resume.
2. Establish Tier 1 provider fixtures and publish the compatibility matrix.
3. Add process, network, sleep/wake, and crash fault injection.
4. Instrument startup, first-token, long-session, history, diff, memory, and reconnect budgets.
5. Complete diagnostics export with secret-redaction tests.
6. Run the seven-day soak and close every blocker.
7. Only then increase investment in Mission, multi-agent orchestration, Personal Memory, Life Mission, and Personal Inbox.
