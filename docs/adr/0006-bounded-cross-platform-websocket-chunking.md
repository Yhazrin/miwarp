# ADR 0006: Bounded Cross-Platform WebSocket Chunking

## Status

Accepted across Rust, Web, iOS, and Android on 2026-06-21.

## Context

MiWarp sends large JSON envelopes over WebSocket using `chunk_begin`, `chunk`, and `chunk_end`. The previous implementations had incompatible and unsafe behavior:

- Rust split a UTF-8 string at arbitrary byte offsets; Chinese or emoji at a boundary could produce `chunk utf8 error` and abort the response.
- The browser initially had unbounded or weakly bounded chunk state.
- iOS and Android kept unbounded active buffers without byte/time limits.
- Android extracted chunk JSON fields with regular expressions, so escaped quotes, backslashes and newlines were not reliably decoded.
- Backend and clients did not share a maximum logical message size.
- Backend `_full_reload` used a 30-second cooldown that could suppress a later, legitimate replay-overflow recovery signal.

## Decision

### Shared protocol limits

All adapters implement these semantic limits:

```text
maximum logical message: 10 MiB UTF-8 bytes
maximum chunks per message: 1000
maximum active messages: 50
maximum total buffered bytes per client: 10 MiB
incomplete message timeout: 60 seconds
```

`chunk_begin` includes:

```json
{
  "type": "chunk_begin",
  "msg_id": "...",
  "total": 4,
  "size": 524288
}
```

Clients validate id, chunk count and declared size before allocating state.

### UTF-8-safe server splitting

Rust splits only at `str::is_char_boundary` positions. A chunk never contains a partial Unicode scalar and each chunk remains below the payload-byte limit.

Axum WebSocket upgrade limits are explicit:

- message size: 10 MiB;
- frame size: 1 MiB.

A result larger than the logical message contract is converted to a small string RPC error instead of leaving the caller to time out silently. String errors remain for compatibility with current iOS and Android response models.

### Bounded client assembly

Each client assembler owns:

- active buffer registry;
- per-message parts;
- UTF-8 byte accounting;
- total buffered-byte accounting;
- declared-size validation;
- duplicate, index and timeout handling;
- reset on disconnect/disposal.

Malformed or oversized input discards the affected logical message without closing the entire connection. When the active-message limit is reached, clients reject the new `chunk_begin` instead of evicting a valid in-flight buffer. An out-of-range index discards only its owning message, and every chunk-protocol consume first removes expired buffers.

### JSON parsing, not regular expressions

Android uses `kotlinx.serialization.json` for chunk envelopes. Escaped JSON strings are decoded by the JSON parser before assembly.

### Full reload is not time-suppressed

The server sends `_full_reload` whenever replay overflow proves that the client cannot catch up. Client-side Store/middleware logic already coalesces concurrent reloads. A server cooldown is rejected because it can hide a second real overflow and leave the client permanently stale.

## Consequences

### Positive

- Large messages containing Chinese, emoji, quotes and backslashes are reconstructed correctly.
- Memory use is bounded on every client.
- Incomplete messages expire before the next chunk-protocol consume, and disconnect cleanup is deterministic.
- Capacity pressure never destroys an unrelated valid in-flight message.
- Invalid indices cannot leave permanently incomplete buffers behind.
- Oversized results fail explicitly.
- Replay overflow cannot be silently hidden by a cooldown.
- Chunk logic is extracted from WebSocket clients into independently testable components.

### Negative

- Messages above 10 MiB are rejected instead of being delivered.
- Each platform maintains an implementation of the same protocol contract; contract tests and documentation must prevent drift.
- Current RPC error payload remains a string until iOS/Android response models support structured errors.

## Rejected Alternatives

### Slice Rust strings at fixed byte offsets

Rejected because fixed offsets can land inside a UTF-8 scalar.

### Leave mobile buffers unbounded

Rejected because one malformed peer can retain arbitrary memory.

### Parse Android chunk strings with regex

Rejected because JSON escaping is not a regular-language extraction problem and escaped content is corrupted.

### Keep `_full_reload` cooldown

Rejected because time suppression trades reduced traffic for possible permanent state divergence.

## Verification

Verified on 2026-06-21:

- Browser/desktop Vitest suite: 84 files, 1,627 tests passed.
- Svelte type check, production build, formatting, i18n, and architecture gates: passed with 0 blocking errors.
- Rust UTF-8 chunk tests: 5 passed as part of the full library suite.
- Rust full library suite: 462 tests passed.
- Rust Clippy with `-D warnings` and Rust formatting: passed.
- iOS SwiftPM suite: 84 tests passed, including 33 bounded-chunk tests.
- iOS Xcode simulator suite: 84 tests passed and the application plus Live Activity extension built successfully.
- Android JVM suite: 48 tests passed, including 33 bounded-chunk tests.
- Android `lintDebug`: passed with 0 errors.
- Android `assembleDebug`: passed and produced a debug APK.
- XcodeGen regeneration check: generated project opens without duplicate-group or malformed-project warnings.

## Fitness Functions

- Rust chunk boundaries must always be valid UTF-8 boundaries.
- Each platform must enforce the same logical size and chunk-count limits.
- Android chunk parsing must not use regular expressions.
- Disconnect/disposal must reset all chunk state.
- Reaching the active-message limit must reject the new begin without evicting existing buffers.
- An out-of-range chunk index must discard the affected message and release its accounted bytes.
- Every chunk-protocol consume must run timeout cleanup first.
- A second replay overflow must emit another `_full_reload` after the first client recovery completes.
- Cross-platform tests must include Unicode and escaped JSON content.
