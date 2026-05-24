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
                MWReconnectBanner(attempt: attempt) {
                    store.disconnect()
                }
            }

            // Status bar
            runStatusBar

            // Messages
            if viewModel.isLoading {
                MWLoadingState(message: "Loading messages...")
            } else if let error = viewModel.error {
                MWErrorState(message: error, onAction: {
                    Task { await viewModel.loadHistory() }
                })
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
                MWApprovalCard(
                    requestId: permission.id,
                    toolName: permission.toolName,
                    description: permission.description
                ) { approved in
                    Task { await viewModel.handlePermission(requestId: permission.id, approved: approved) }
                }
                .padding(.horizontal, MWSpacing.lg)
                .padding(.bottom, MWSpacing.sm)
            }
        }
        .background(theme.bgDeepest)
        .navigationTitle(runTitle)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .tabBar)
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
        .onChange(of: store.isConnected) { connected in
            if connected && viewModel.reducer.messages.isEmpty && !viewModel.isLoading {
                Task { await viewModel.loadHistory() }
            }
        }
    }

    // MARK: - Status Bar

    private var runStatusBar: some View {
        HStack(spacing: MWSpacing.md) {
            MWStatusPill(status: viewModel.reducer.currentStatus)

            if viewModel.reducer.usage.costUsd > 0 {
                HStack(spacing: MWSpacing.xs) {
                    Image(systemName: "dollarsign.circle")
                        .font(MWTypography.caption2())
                    Text(String(format: "%.4f", viewModel.reducer.usage.costUsd))
                }
                .font(MWTypography.monoCaption())
                .foregroundColor(MWColors.statusWarning)
            }

            if viewModel.reducer.usage.inputTokens > 0 {
                HStack(spacing: MWSpacing.xs) {
                    Image(systemName: "arrow.down.circle")
                        .font(MWTypography.caption2())
                    Text(viewModel.formatTokens(viewModel.reducer.usage.inputTokens))
                }
                .font(MWTypography.monoCaption())
                .foregroundColor(MWColors.textTertiary)
            }

            if viewModel.reducer.usage.outputTokens > 0 {
                HStack(spacing: MWSpacing.xs) {
                    Image(systemName: "arrow.up.circle")
                        .font(MWTypography.caption2())
                    Text(viewModel.formatTokens(viewModel.reducer.usage.outputTokens))
                }
                .font(MWTypography.monoCaption())
                .foregroundColor(MWColors.textTertiary)
            }

            Spacer()
        }
        .padding(.horizontal, MWSpacing.lg)
        .padding(.vertical, MWSpacing.sm)
        .background(
            Rectangle()
                .fill(.ultraThinMaterial)
                .background(MWColors.glassBg)
                .overlay(
                    Rectangle()
                        .fill(MWColors.divider)
                        .frame(height: 0.5),
                    alignment: .bottom
                )
        )
    }
}
