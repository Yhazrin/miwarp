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

    @EnvironmentObject private var store: MiWarpConnectionStore
    @EnvironmentObject private var theme: MWTheme
    @StateObject private var viewModel: ChatViewModel
    @State private var inputBarHeight: CGFloat = 60

    init(runId: String, runTitle: String) {
        self.runId = runId
        self.runTitle = runTitle
        _viewModel = StateObject(wrappedValue: ChatViewModel(runId: runId))
    }

    var body: some View {
        VStack(spacing: 0) {
            // Reconnect banner
            if case .reconnecting(let attempt) = store.connectionState {
                reconnectBanner(attempt: attempt)
            }

            // Status bar
            runStatusBar

            // Messages
            if viewModel.isLoading {
                ContentUnavailableView {
                    Label("Loading Messages", systemImage: "arrow.clockwise")
                } description: {
                    Text("Fetching conversation history...")
                }
            } else if let error = viewModel.error {
                ContentUnavailableView {
                    Label("Cannot Load Messages", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(error)
                } actions: {
                    Button("Retry") {
                        Task { await viewModel.loadHistory() }
                    }
                    .buttonStyle(.bordered)
                }
            } else {
                MessageListView(
                    messages: viewModel.reducer.messages,
                    complexityMode: viewModel.complexityMode,
                    inputBarHeight: inputBarHeight,
                    onApprove: { requestId, approved in
                        Task { await viewModel.handlePermission(requestId: requestId, approved: approved) }
                    }
                )
            }

            // Pending permissions
            if let permission = viewModel.reducer.pendingPermissions.first {
                InlineApprovalView(
                    toolName: permission.toolName,
                    description: permission.description
                ) { approved in
                    Task { await viewModel.handlePermission(requestId: permission.id, approved: approved) }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 8)
            }
        }
        .navigationTitle(runTitle)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
        .toolbar(.hidden, for: .tabBar)
        .background(MWPatternedBackdrop())
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Picker("Mode", selection: $viewModel.complexityMode) {
                        ForEach(ComplexityMode.allCases, id: \.self) { mode in
                            Label(mode.rawValue, systemImage: mode.systemImage)
                                .tag(mode)
                        }
                    }

                    Divider()

                    Button {
                        viewModel.showArtifacts = true
                    } label: {
                        Label("Artifacts", systemImage: "archivebox")
                    }

                    Button {
                        viewModel.showRawEvents = true
                    } label: {
                        Label("Raw Events", systemImage: "list.bullet.rectangle")
                    }
                } label: {
                    Image(systemName: viewModel.complexityMode.systemImage)
                }
            }
        }
        .safeAreaInset(edge: .bottom) {
            ChatInputBar(
                text: $viewModel.inputText,
                isRunning: viewModel.reducer.currentStatus == .running,
                canSend: store.isConnected,
                onSend: { Task { await viewModel.sendMessage() } },
                onStop: { Task { await viewModel.stopSession() } },
                onFork: { Task { await viewModel.forkSession() } }
            )
            .readSize { size in
                inputBarHeight = size.height
            }
        }
        .sheet(isPresented: $viewModel.showRawEvents) {
            RawEventView(events: viewModel.rawEvents)
        }
        .sheet(isPresented: $viewModel.showArtifacts) {
            NavigationStack {
                ArtifactsView(runId: runId)
            }
        }
        .task {
            viewModel.attach(store: store)
            await viewModel.loadHistory()
            await viewModel.subscribeToEvents()
        }
        .onChange(of: store.isConnected) { _, connected in
            if connected && viewModel.reducer.messages.isEmpty && !viewModel.isLoading {
                Task { await viewModel.loadHistory() }
            }
        }
    }

    // MARK: - Status Bar

    private var runStatusBar: some View {
        HStack(spacing: 10) {
            statusPill(viewModel.reducer.currentStatus)

            if viewModel.reducer.usage.costUsd > 0 {
                Label(String(format: "$%.4f", viewModel.reducer.usage.costUsd), systemImage: "dollarsign.circle")
                    .font(.caption.monospaced())
                    .foregroundStyle(MWColors.statusWarning)
            }

            if viewModel.reducer.usage.inputTokens > 0 {
                Label(viewModel.formatTokens(viewModel.reducer.usage.inputTokens), systemImage: "arrow.down.circle")
                    .font(.caption.monospaced())
                    .foregroundStyle(.tertiary)
            }

            if viewModel.reducer.usage.outputTokens > 0 {
                Label(viewModel.formatTokens(viewModel.reducer.usage.outputTokens), systemImage: "arrow.up.circle")
                    .font(.caption.monospaced())
                    .foregroundStyle(.tertiary)
            }

            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 6)
    }

    private func statusPill(_ status: RunStatus) -> some View {
        Text(status.displayLabel)
            .font(.caption.weight(.medium))
            .foregroundStyle(statusColor(status))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(statusColor(status).opacity(0.18), in: Capsule())
    }

    private func statusColor(_ status: RunStatus) -> Color {
        switch status {
        case .running: return theme.accentPrimary
        case .waitingApproval: return MWColors.statusWarning
        case .failed: return MWColors.statusError
        case .completed: return MWColors.statusSuccess
        case .pending: return .secondary
        case .idle: return .secondary
        case .stopped: return .gray
        }
    }

    // MARK: - Reconnect Banner

    private func reconnectBanner(attempt: Int) -> some View {
        HStack(spacing: 8) {
            ProgressView()
                .scaleEffect(0.75)
            VStack(alignment: .leading, spacing: 1) {
                Text("Reconnecting")
                    .font(.subheadline.weight(.medium))
                Text("Attempt \(attempt)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Button("Cancel") {
                store.disconnect()
            }
            .font(.subheadline)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(.orange.opacity(0.08))
    }
}

// MARK: - Inline Approval

struct InlineApprovalView: View {
    let toolName: String
    let description: String?
    var onApprove: ((Bool) -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                Image(systemName: "exclamationmark.shield.fill")
                    .foregroundStyle(MWColors.statusWarning)
                Text("Permission Required")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(MWColors.statusWarning)
            }

            Label(toolName, systemImage: "wrench.and.screwdriver")
                .font(.caption.monospaced())
                .foregroundStyle(.secondary)

            if let desc = description, !desc.isEmpty {
                Text(desc)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack(spacing: 12) {
                Button {
                    onApprove?(false)
                } label: {
                    Text("Deny")
                        .font(.subheadline.weight(.medium))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                        .background(.quaternary, in: RoundedRectangle(cornerRadius: 8))
                }

                Button {
                    onApprove?(true)
                } label: {
                    Text("Allow")
                        .font(.subheadline.weight(.medium))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                        .background(.tint, in: RoundedRectangle(cornerRadius: 8))
                        .foregroundStyle(.white)
                }
            }
        }
        .padding(14)
        .background(MWColors.cardBg, in: RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(.orange.opacity(0.3), lineWidth: 1)
        )
        .shadow(color: .orange.opacity(0.08), radius: 8)
    }
}
