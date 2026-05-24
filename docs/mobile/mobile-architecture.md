# MiWarp Mobile — Architecture

## Overview

MiWarp Mobile consists of two native clients (iOS and Android) that connect to a MiWarp Desktop instance via WebSocket. The desktop's existing web server and dispatch system serve as the backend — no new server-side code is required for basic functionality.

```
┌──────────────┐     WebSocket      ┌──────────────────┐
│  iOS Client  │◄──────────────────►│                  │
│  (SwiftUI)   │   ws://host:port   │  MiWarp Desktop  │
└──────────────┘   /ws?token=...    │  (Tauri + Rust)  │
                     │              │                  │
┌──────────────┐     │              │  ┌────────────┐  │
│ Android App  │◄────┘              │  │ Web Server │  │
│ (Compose)    │                    │  │ (Axum)     │  │
└──────────────┘                    │  └────────────┘  │
                                    │  ┌────────────┐  │
                                    │  │ Dispatcher │  │
                                    │  │ (90+ RPCs) │  │
                                    │  └────────────┘  │
                                    │  ┌────────────┐  │
                                    │  │ Broadcaster│  │
                                    │  │ (A+B class)│  │
                                    │  └────────────┘  │
                                    └──────────────────┘
```

## iOS Architecture

### Stack

| Layer | Technology |
|-------|-----------|
| UI | SwiftUI + NavigationStack |
| State | @Observable / ObservableObject |
| Concurrency | async/await, AsyncStream, Combine |
| WebSocket | URLSessionWebSocketTask |
| Storage | Keychain (tokens), UserDefaults (prefs) |
| QR Scanner | AVFoundation + VisionKit |
| Min Target | iOS 16+ |

### Module Structure

```
MiWarpMobile/
├── App/                    # App entry point, navigation router
├── Core/                   # Shared infrastructure
│   ├── MiWarpRPC.swift         # High-level RPC client
│   ├── MiWarpWebSocketClient.swift  # WebSocket transport
│   ├── MiWarpConnectionStore.swift  # Connection management
│   ├── MiWarpKeychain.swift    # Secure token storage
│   ├── MiWarpModels.swift      # Data models
│   ├── MiWarpEventReducer.swift # Event processing
│   └── MiWarpLogger.swift      # Logging (redacts tokens)
├── DesignSystem/           # Visual components
│   ├── MWTheme.swift           # Theme provider
│   ├── MWColors.swift          # Color tokens
│   ├── MWTypography.swift      # Font definitions
│   └── MWComponents.swift      # Reusable UI components
├── Features/               # Screen modules
│   ├── Pairing/                # Connection setup
│   ├── Sessions/               # Session hub
│   ├── Chat/                   # Chat view
│   ├── Artifacts/              # Files & diffs
│   └── Settings/               # Mobile settings
└── Resources/              # Assets, Info.plist
```

### Data Flow

```
User Action → View → ViewModel → RPC Client → WebSocket → Server
                                    ↓
                              AsyncStream ←── Broadcast Events
                                    ↓
                              EventReducer → View State Update → View Re-render
```

### WebSocket Client Design

The `MiWarpWebSocketClient` uses `URLSessionWebSocketTask` with:

1. **Connection lifecycle**: Connect → authenticate → subscribe → receive events
2. **Request/response**: Each RPC call gets a unique `id`, sent as JSON, response matched by `id`
3. **Broadcast events**: Received as unsolicited messages, forwarded via `AsyncStream`
4. **Reconnect**: Exponential backoff (1s → 2s → 4s → 8s → 30s max)
5. **Seq tracking**: Per-run `lastSeq` map for dedup on reconnect

```swift
class MiWarpWebSocketClient {
    private var task: URLSessionWebSocketTask?
    private var pendingRequests: [String: CheckedContinuation<...>]
    private var eventStream: AsyncStream<BroadcastEvent>
    
    func connect(host: String, port: Int, token: String) async throws
    func send<T: Decodable>(method: String, params: [String: Any]) async throws -> T
    func broadcastEvents() -> AsyncStream<BroadcastEvent>
    func disconnect()
}
```

### State Management

Using Swift's `@Observable` macro (iOS 17+) with fallback to `ObservableObject` (iOS 16):

- `ConnectionStore` — manages saved connections, active connection state
- `SessionHubViewModel` — list of runs, filters, search
- `ChatViewModel` — messages, event stream, input state
- Each ViewModel owns its RPC calls and event subscriptions

## Android Architecture

### Stack

| Layer | Technology |
|-------|-----------|
| UI | Jetpack Compose + Material 3 |
| State | StateFlow + ViewModel |
| Concurrency | Kotlin Coroutines + Flow |
| WebSocket | OkHttp WebSocket |
| Storage | DataStore (prefs), EncryptedSharedPreferences (tokens) |
| QR Scanner | CameraX + ML Kit Barcode |
| Min Target | Android 10 (API 29) |

### Module Structure

```
com.miwarp.mobile/
├── app/                    # App entry, navigation, DI
│   ├── MainActivity.kt
│   ├── MiWarpMobileApp.kt
│   └── AppNavGraph.kt
├── core/                   # Shared infrastructure
│   ├── rpc/
│   │   ├── MiWarpRpcClient.kt
│   │   ├── MiWarpWebSocketClient.kt
│   │   └── RpcModels.kt
│   ├── storage/
│   │   ├── ConnectionStore.kt
│   │   └── SecureTokenStore.kt
│   ├── model/
│   │   └── MiWarpModels.kt
│   ├── reducer/
│   │   └── MiWarpEventReducer.kt
│   └── util/
│       └── Logger.kt
├── design/                 # Visual components
│   ├── MWTheme.kt
│   ├── MWColors.kt
│   ├── MWTypography.kt
│   └── MWComponents.kt
├── feature/                # Screen modules
│   ├── pairing/
│   ├── sessions/
│   ├── chat/
│   ├── artifacts/
│   └── settings/
└── data/                   # Repository layer
```

### Data Flow

```
User Action → Composable → ViewModel → RPC Client → OkHttp WS → Server
                                    ↓
                              SharedFlow ←── Broadcast Events
                                    ↓
                              EventReducer → StateFlow → Composable Recomposition
```

### WebSocket Client Design

The `MiWarpWebSocketClient` uses OkHttp's WebSocket with:

1. **Connection**: `OkHttpClient.newWebSocket()` with custom `WebSocketListener`
2. **Request/response**: Correlation via `CompletableDeferred` stored in a map
3. **Broadcast events**: Emitted to `SharedFlow<BroadcastEvent>`
4. **Reconnect**: Exponential backoff via `delay()` in a coroutine
5. **Seq tracking**: Same per-run `lastSeq` map as iOS

```kotlin
class MiWarpWebSocketClient(private val client: OkHttpClient) {
    private val _events = MutableSharedFlow<BroadcastEvent>(extraBufferCapacity = 64)
    val events: SharedFlow<BroadcastEvent> = _events
    
    suspend fun connect(host: String, port: Int, token: String)
    suspend fun <T> send(method: String, params: Map<String, Any?> = emptyMap()): T
    fun disconnect()
}
```

### State Management

Using Kotlin `StateFlow` in ViewModels:

- `ConnectionViewModel` — connection state, saved connections
- `SessionHubViewModel` — run list, filters, search
- `ChatViewModel` — messages, event stream, input state
- State exposed as `StateFlow<UiState>`, collected via `collectAsStateWithLifecycle()`

## Shared Design Principles

### Platform-Adapted, Not Platform-Locked

Both apps share the same design tokens and component semantics, but each follows its platform's interaction patterns:

- iOS uses `NavigationStack`, swipe gestures, SF Symbols
- Android uses Compose Navigation, Material motion, Material Icons

### No Third-Party UI Frameworks

Both apps use only platform-native UI frameworks. No React Native, no Flutter, no WebView.

### Zero Server Changes Required

The mobile apps work with the existing desktop web server. All required dispatch methods already exist. The only desktop enhancement is the Mobile Access settings panel (QR code, pairing link).

### Offline-First Queuing

Messages sent while disconnected are queued locally and retried on reconnection. The UI shows visual indicators for queued messages.

### Security by Default

- Tokens in secure storage only
- No logging of tokens
- No auto-approval of permissions
- No public network exposure
- Clear-all data option
