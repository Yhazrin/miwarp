import SwiftUI

// MARK: - Complexity Mode

enum ComplexityMode: String, CaseIterable {
    case simple = "Simple"
    case focus = "Focus"
    case developer = "Developer"
    case raw = "Raw"

    var systemImage: String {
        switch self {
        case .simple: return "eye"
        case .focus: return "scope"
        case .developer: return "hammer"
        case .raw: return "terminal"
        }
    }
}

// MARK: - Chat View

struct ChatView: View {
    let runId: String
    let runTitle: String

    @Environment(MiWarpConnectionStore.self) private var store
    @State private var reducer = MiWarpEventReducer()
    @State private var inputText = ""
    @State private var isLoading = true
    @State private var error: String?
    @State private var complexityMode: ComplexityMode = .developer
    @State private var showRawEvents = false
    @State private var rawEvents: [BusEvent] = []

    var body: some View {
        VStack(spacing: 0) {
            // Reconnect banner
            if case .reconnecting(let attempt) = store.connectionState {
                MWReconnectBanner(attempt: attempt) {
                    store.disconnect()
                }
            }

            // Status bar
            runStatusBar

            // Messages
            if isLoading {
                MWLoadingState(message: "Loading messages...")
            } else if let error {
                MWErrorState(message: error) {
                    Task { await loadHistory() }
                }
            } else {
                MessageListView(
                    messages: reducer.messages,
                    complexityMode: complexityMode,
                    onApprove: { requestId, approved in
                        Task { await handlePermission(requestId: requestId, approved: approved) }
                    }
                )
            }

            // Pending permissions
            if let permission = reducer.pendingPermissions.first {
                MWApprovalCard(
                    requestId: permission.id,
                    toolName: permission.toolName,
                    description: permission.description
                ) { approved in
                    Task { await handlePermission(requestId: permission.id, approved: approved) }
                }
                .padding(.horizontal, MWSpacing.lg)
                .padding(.bottom, MWSpacing.sm)
            }

            // Input bar
            ChatInputBar(
                text: $inputText,
                isRunning: reducer.currentStatus == .running,
                canSend: store.isConnected,
                onSend: { Task { await sendMessage() } },
                onStop: { Task { await stopSession() } },
                onFork: { Task { await forkSession() } }
            )
        }
        .background(MWColors.bgDeepest)
        .navigationTitle(runTitle)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Picker("Mode", selection: $complexityMode) {
                        ForEach(ComplexityMode.allCases, id: \.self) { mode in
                            Label(mode.rawValue, systemImage: mode.systemImage)
                                .tag(mode)
                        }
                    }

                    Divider()

                    Button {
                        showRawEvents = true
                    } label: {
                        Label("Raw Events", systemImage: "list.bullet.rectangle")
                    }
                } label: {
                    Image(systemName: complexityMode.systemImage)
                }
            }
        }
        .sheet(isPresented: $showRawEvents) {
            RawEventView(events: rawEvents)
        }
        .task {
            await loadHistory()
            await subscribeToEvents()
        }
    }

    // MARK: - Status Bar

    private var runStatusBar: some View {
        HStack(spacing: MWSpacing.md) {
            MWStatusPill(status: reducer.currentStatus)

            if reducer.usage.costUsd > 0 {
                Text(String(format: "$%.4f", reducer.usage.costUsd))
                    .font(MWTypography.monoCaption())
                    .foregroundColor(MWColors.statusWarning)
            }

            if reducer.usage.inputTokens > 0 {
                Text("\(formatTokens(reducer.usage.inputTokens)) in")
                    .font(MWTypography.caption())
                    .foregroundColor(MWColors.textTertiary)
            }

            Spacer()

            Text("seq: \(reducer.lastSeq)")
                .font(MWTypography.caption2())
                .foregroundColor(MWColors.textTertiary)
        }
        .padding(.horizontal, MWSpacing.lg)
        .padding(.vertical, MWSpacing.sm)
        .background(MWColors.bgDeep)
    }

    // MARK: - Actions

    private func loadHistory() async {
        guard let rpc = store.rpc else {
            error = "Not connected"
            isLoading = false
            return
        }

        isLoading = true
        error = nil

        do {
            let events = try await rpc.getBusEvents(runId: runId)
            rawEvents = events
            reducer.loadHistory(events)
        } catch {
            self.error = error.localizedDescription
        }

        isLoading = false
    }

    private func subscribeToEvents() async {
        guard let rpc = store.rpc else { return }

        do {
            try await rpc.subscribe(runId: runId, lastSeq: reducer.lastSeq)
        } catch {
            MiWarpLogger.shared.error("Subscribe failed: \(error.localizedDescription)")
        }

        // Listen for real-time events
        for await event in store.wsClient.eventStream {
            guard event.runId == runId else { continue }
            rawEvents.append(event)
            reducer.processEvent(event)
        }
    }

    private func sendMessage() async {
        guard let rpc = store.rpc, !inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return
        }

        let message = inputText
        inputText = ""

        do {
            try await rpc.sendMessage(runId: runId, message: message)
        } catch {
            self.error = "Failed to send: \(error.localizedDescription)"
        }
    }

    private func stopSession() async {
        guard let rpc = store.rpc else { return }
        do {
            try await rpc.stopSession(runId: runId)
        } catch {
            self.error = "Failed to stop: \(error.localizedDescription)"
        }
    }

    private func forkSession() async {
        guard let rpc = store.rpc else { return }
        do {
            let newRunId = try await rpc.forkSession(runId: runId)
            MiWarpLogger.shared.info("Forked session: \(newRunId)")
        } catch {
            self.error = "Failed to fork: \(error.localizedDescription)"
        }
    }

    private func handlePermission(requestId: String, approved: Bool) async {
        guard let rpc = store.rpc else { return }
        do {
            try await rpc.respondPermission(
                runId: runId,
                requestId: requestId,
                behavior: approved ? "allow" : "deny",
                denyMessage: approved ? nil : "Denied from mobile"
            )
            reducer.removePermission(requestId: requestId)
        } catch {
            self.error = "Permission response failed: \(error.localizedDescription)"
        }
    }

    private func formatTokens(_ count: Int) -> String {
        if count >= 1_000_000 {
            return String(format: "%.1fM", Double(count) / 1_000_000)
        } else if count >= 1_000 {
            return String(format: "%.1fK", Double(count) / 1_000)
        }
        return "\(count)"
    }
}
