# MiWarp Mobile — WebSocket Protocol Reference

This document defines the WebSocket protocol used by iOS and Android mobile clients to communicate with MiWarp Desktop.

## Connection

### URL Format

```
ws://{host}:{port}/ws?token={token}
```

- **host**: Desktop IP or hostname (e.g., `192.168.1.100`, `my-mac.local`)
- **port**: Web server port (default: `9476`)
- **token**: Authentication token (32-char alphanumeric)

### Authentication

The token is passed as a query parameter. The server validates it against the live token stored in memory.

On authentication failure, the server responds with HTTP 403 before upgrading to WebSocket.

### Token Rotation

When the desktop user regenerates the token, all active WebSocket connections are closed with code `4401` and reason `"token_rotated"`. The mobile client must prompt for re-authentication.

### Heartbeat

The server sends a `Ping` frame every 300 seconds. If the client doesn't respond with `Pong`, the connection is closed. The server also checks `token_version` on each heartbeat — a mismatch closes the connection with code `4401`, reason `"token_version_mismatch"`.

## Message Format

All messages are JSON-encoded text frames.

### Request (client → server)

```json
{
  "id": "uuid-or-string",
  "method": "method_name",
  "params": { "key": "value" }
}
```

- `id`: Optional correlation ID for matching responses. Generate a UUID or incrementing string.
- `method`: The dispatch method name.
- `params`: Method parameters (may be empty `{}` or omitted).

### Success Response (server → client)

```json
{
  "id": "same-correlation-id",
  "result": { ... }
}
```

### Error Response (server → client)

```json
{
  "id": "same-correlation-id",
  "error": "Human-readable error message"
}
```

### Parameter Normalization

Top-level camelCase keys in `params` are automatically converted to snake_case (e.g., `runId` → `run_id`). Nested objects are NOT converted. Mobile clients may use either convention.

## Broadcast Events

The server pushes events to subscribed clients without a request `id`.

### A-Class Events (Reliable, Sequenced)

```json
{
  "event": "bus-event",
  "seq": 123,
  "run_id": "run-uuid",
  "payload": { ... }
}
```

- `seq`: Monotonically increasing sequence number per `run_id`. Used for dedup and replay.
- `run_id`: The run this event belongs to.
- `payload`: A `BusEvent` variant object (see BusEvent Variants below).

### B-Class Events (Lossy, Non-Sequenced)

```json
{
  "event": "chat-delta",
  "run_id": "run-uuid",
  "payload": { ... }
}
```

B-class events with a `run_id` are only sent to clients subscribed to that run. B-class events without a `run_id` are sent to all connected clients.

## Subscription Management

### `_subscribe`

Subscribe to real-time events for a run.

**Request:**
```json
{
  "method": "_subscribe",
  "id": "1",
  "params": {
    "run_id": "run-uuid",
    "last_seq": 42
  }
}
```

- `run_id`: The run to subscribe to.
- `last_seq` (optional): The client's last known sequence number. Events after this are replayed from the persisted event log.

**Response:**
```json
{ "id": "1", "result": { "ok": true } }
```

Or if already replaying:
```json
{ "id": "1", "result": { "status": "already_replaying" } }
```

**Replay behavior:**
- Events with `seq > last_seq` are replayed from `events.jsonl`.
- During replay, new broadcast events are buffered (capacity: 4096).
- If the buffer overflows, a `_full_reload` signal is sent.

### `_unsubscribe`

Unsubscribe from a run's events.

**Request:**
```json
{
  "method": "_unsubscribe",
  "id": "2",
  "params": {
    "run_id": "run-uuid"
  }
}
```

**Response:**
```json
{ "id": "2", "result": { "ok": true } }
```

### `_full_reload` Signal

Sent when the replay buffer overflows. The client should discard its local event state and re-fetch all events.

```json
{
  "event": "_full_reload",
  "run_id": "run-uuid"
}
```

Has a 30-second cooldown per `run_id`.

## Dispatch Methods

### Runs

| Method | Params | Returns |
|--------|--------|---------|
| `list_runs` | — | Array of run objects |
| `get_run` | `{ "id": "..." }` | Single run object |
| `start_run` | `{ "prompt", "cwd", "agent", "model?", "remote_host_name?", "platform_id?", "execution_path?" }` | Run object |
| `rename_run` | `{ "id", "name" }` | `{ "ok": true }` |
| `soft_delete_runs` | `{ "ids": ["..."] }` | `{ "ok": true }` |
| `update_run_model` | `{ "id", "model" }` | `{ "ok": true }` |
| `stop_run` | `{ "id" }` | `{ "ok": true }` |
| `search_runs` | `{ "filters": { ... } }` | Array of matching runs |
| `search_prompts` | `{ "query", "max_results?" }` | Array of prompt matches |

### Session Management

| Method | Params | Returns |
|--------|--------|---------|
| `start_session` | `{ "run_id", "mode?", "session_id?", "initial_message?", "attachments?", "platform_id?", "permission_mode_override?" }` | Session info |
| `send_session_message` | `{ "run_id", "message", "attachments?" }` | `{ "ok": true }` |
| `stop_session` | `{ "run_id" }` | `{ "ok": true }` |
| `fork_session` | `{ "run_id" }` | `{ "new_run_id": "..." }` |
| `send_session_control` | `{ "run_id", "subtype", "params?" }` | Control response |
| `respond_permission` | `{ "run_id", "request_id", "behavior", "updated_permissions?", "updated_input?", "deny_message?", "interrupt?" }` | `{ "ok": true }` |
| `approve_session_tool` | `{ "run_id", "tool_name" }` | `{ "ok": true }` |
| `respond_hook_callback` | `{ "run_id", "request_id", "decision", "updated_input?" }` | `{ "ok": true }` |
| `cancel_control_request` | `{ "run_id", "request_id" }` | `{ "ok": true }` |
| `respond_elicitation` | `{ "run_id", "request_id", "action", "content?" }` | `{ "ok": true }` |

**`behavior` values for `respond_permission`:**
- `"allow_once"` — Allow this single tool call
- `"allow_always"` — Allow this tool for the session
- `"deny"` — Deny the tool call
- `"deny_with_message"` — Deny with explanation (use `deny_message` field)

**`action` values for `respond_elicitation`:**
- `"accept"` — Accept the elicited input
- `"decline"` — Decline
- `"cancel"` — Cancel the elicitation

### Events

| Method | Params | Returns |
|--------|--------|---------|
| `get_bus_events` | `{ "id", "since_seq?" }` | Array of bus events |
| `get_run_events` | `{ "id", "since_seq?" }` | Array of run events |

### Artifacts & Git

| Method | Params | Returns |
|--------|--------|---------|
| `get_run_artifacts` | `{ "id" }` | `{ "files_changed", "diff_summary", "commands", "cost_estimate" }` |
| `export_conversation` | `{ "run_id" }` | Exported conversation data |
| `get_git_summary` | `{ "cwd" }` | Git summary |
| `get_git_branch` | `{ "cwd" }` | Current branch name |
| `get_git_diff` | `{ "cwd", "staged?", "file?" }` | Diff content |
| `get_git_status` | `{ "cwd" }` | Git status |
| `get_git_timeline` | `{ "cwd", "limit?" }` | Recent git history |

### Web Server

| Method | Params | Returns |
|--------|--------|---------|
| `get_web_server_status` | — | `{ "enabled", "running", "port", "bind", "warning?" }` |

### Settings

| Method | Params | Returns |
|--------|--------|---------|
| `get_user_settings` | — | User settings (token field stripped) |
| `update_user_settings` | `{ "patch": { ... } }` | Updated settings |

### Prompt Favorites

| Method | Params | Returns |
|--------|--------|---------|
| `list_prompt_favorites` | — | Array of favorites |
| `add_prompt_favorite` | `{ "run_id", "seq", "text" }` | `{ "ok": true }` |
| `remove_prompt_favorite` | `{ "run_id", "seq" }` | `{ "ok": true }` |

## BusEvent Variants

Each `payload` in a `bus-event` has a type field identifying the variant:

### Session Lifecycle

| Type | Key Fields | Description |
|------|-----------|-------------|
| `session_init` | `model`, `tools`, `cwd`, `mcp_servers`, `plugins` | Session started with metadata |
| `run_state` | `state` (running/completed/failed/stopped) | Run state change |
| `compact_boundary` | — | Context compaction occurred |
| `system_status` | `status` (e.g., "compacting") | System status change |

### Messages

| Type | Key Fields | Description |
|------|-----------|-------------|
| `user_message` | `text`, `attachments?` | User input |
| `message_delta` | `text` | Streaming text chunk |
| `message_complete` | `text`, `usage?` | Final message with optional usage |
| `thinking_delta` | `text` | Extended thinking text |

### Tools

| Type | Key Fields | Description |
|------|-----------|-------------|
| `tool_start` | `tool_name`, `tool_use_id`, `input?` | Tool invocation started |
| `tool_end` | `tool_name`, `tool_use_id`, `output?`, `error?` | Tool invocation completed |
| `tool_input_delta` | `tool_use_id`, `input_json_delta` | Streaming tool input |
| `tool_progress` | `tool_use_id`, `elapsed_ms` | Tool elapsed time |
| `tool_use_summary` | `summary` | Tool use summary |

### Permissions

| Type | Key Fields | Description |
|------|-----------|-------------|
| `permission_prompt` | `request_id`, `tool_name`, `tool_use_id`, `input?`, `dangerous?` | Waiting for permission |
| `permission_denied` | `tool_name`, `reason?` | Permission denied |

### Commands & Hooks

| Type | Key Fields | Description |
|------|-----------|-------------|
| `command_output` | `command`, `output` | Slash command output |
| `hook_started` | `hook_name`, `request_id` | Hook started |
| `hook_progress` | `request_id`, `progress` | Hook progress |
| `hook_response` | `request_id`, `response` | Hook completed |
| `hook_callback` | `request_id`, `callback_data` | Hook needs user decision |

### Usage & Files

| Type | Key Fields | Description |
|------|-----------|-------------|
| `usage_update` | `input_tokens`, `output_tokens`, `cost?` | Token usage update |
| `files_persisted` | `files` | Files written to disk |
| `artifact_update` | `artifact_type`, `data` | Artifact produced |

### Other

| Type | Key Fields | Description |
|------|-----------|-------------|
| `task_notification` | `task_id`, `status` | Background task status |
| `control_cancelled` | `request_id` | Control request cancelled |
| `elicitation_prompt` | `request_id`, `prompt_data` | MCP server needs input |
| `rate_limit_event` | `retry_after?` | API rate limited |
| `auth_status` | `authenticated`, `provider?` | Auth status |
| `ralph_started` | — | Ralph loop started |
| `ralph_iteration` | `iteration` | Ralph loop iteration |
| `ralph_complete` | — | Ralph loop complete |
| `raw` | `data` | Raw passthrough from CLI |

## Reconnection Strategy

### Recommended Backoff

```
Attempt 1: 1 second
Attempt 2: 2 seconds
Attempt 3: 4 seconds
Attempt 4: 8 seconds
Attempt 5+: 30 seconds (max)
```

### Reconnection Flow

1. On disconnect, wait per backoff schedule.
2. Attempt connection with saved credentials.
3. On success, call `_subscribe` with `last_seq` from local state.
4. Server replays missed events.
5. If `_full_reload` is received, call `get_bus_events` without `since_seq` to fetch all events.

### Seq Deduplication

- Each A-class event has a `seq` per `run_id`.
- Maintain a `lastSeenSeq` map: `Map<runId, Int>`.
- On receiving an event, if `event.seq <= lastSeenSeq[runId]`, discard it.
- Otherwise, process and update `lastSeenSeq[runId] = event.seq`.

### Offline Queue

Messages sent while disconnected should be queued locally and retried on reconnection. The mobile client should show a visual indicator for queued messages.

## Error Codes

| Close Code | Reason | Meaning |
|-----------|--------|---------|
| 4401 | `token_rotated` | Token was regenerated; re-authenticate |
| 4401 | `token_version_mismatch` | Token version changed; re-authenticate |
| 4401 | `session_expired` | Cookie session expired (not applicable for mobile) |
| 1000 | Normal closure | Intentional disconnect |
| 1001 | Going away | Server shutting down |
| 1006 | Abnormal closure | Network failure (no close frame received) |

## Security Notes

- Token is transmitted in the query string — use on trusted networks only.
- For untrusted networks, use an SSH tunnel or VPN.
- The server does not support TLS natively — use a reverse proxy (ngrok, cloudflared) for TLS.
- Token rotation disconnects all clients immediately.
- No session content is uploaded to any third-party service.
