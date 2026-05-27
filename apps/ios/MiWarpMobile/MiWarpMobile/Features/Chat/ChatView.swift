import SwiftUI

// MARK: - Complexity Mode

enum ComplexityMode: String, CaseIterable {
    case simple = "Simple"
    case focus = "Focus"
    case developer = "Developer"
    case raw = "Raw"

    var displayName: String {
        switch self {
        case .simple: return String(localized: "chatMode.simple")
        case .focus: return String(localized: "chatMode.focus")
        case .developer: return String(localized: "chatMode.developer")
        case .raw: return String(localized: "chatMode.raw")
        }
    }

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
    @StateObject private var toastPresenter = MiToastPresenter()
    @State private var inputBarHeight: CGFloat = 60

    init(runId: String, runTitle: String) {
        self.runId = runId
        self.runTitle = runTitle
        _viewModel = StateObject(wrappedValue: ChatViewModel(runId: runId))
    }

    var body: some View {
        MWAdaptiveReader { layout in
            content(layout: layout)
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

    private func content(layout: MWAdaptiveLayout) -> some View {
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
                    Label(String(localized: "chat.loadingMessages"), systemImage: "arrow.clockwise")
                } description: {
                    Text(String(localized: "chat.fetchingHistory"))
                }
                .transition(.opacity)
            } else if let error = viewModel.error {
                ContentUnavailableView {
                    Label(String(localized: "chat.cannotLoadMessages"), systemImage: "exclamationmark.triangle")
                } description: {
                    Text(error)
                } actions: {
                    Button(String(localized: "action.retry")) {
                        Task { await viewModel.loadHistory() }
                    }
                    .buttonStyle(.bordered)
                }
                .transition(.opacity)
            } else {
                MessageTimeline(
                    messages: viewModel.reducer.messages,
                    complexityMode: viewModel.complexityMode,
                    inputBarHeight: inputBarHeight,
                    pendingPermissions: viewModel.reducer.pendingPermissions,
                    onApprove: { requestId, approved in
                        Task { await viewModel.handlePermission(requestId: requestId, approved: approved) }
                    },
                    toastPresenter: toastPresenter
                )
                .transition(.opacity)
            }

            // Pending permissions
            if let permission = viewModel.reducer.pendingPermissions.first {
                PermissionRequestCard(permission: permission) { approved in
                    Task { await viewModel.handlePermission(requestId: permission.id, approved: approved) }
                }
                .frame(maxWidth: layout.chatAssistantBubbleMaxWidth)
                .frame(maxWidth: .infinity)
                .padding(.horizontal, MWSpacing.lg)
                .padding(.bottom, MWSpacing.sm)
            }
        }
        .navigationTitle(runTitle)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
        .toolbar(.hidden, for: .tabBar)
        .background(MWPatternedBackdrop())
        .miToastPresenter(toastPresenter)
        .onChange(of: viewModel.error) { _, error in
            guard let error else { return }
            toastPresenter.error(String(localized: "chat.errorTitle"), message: error)
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Picker(String(localized: "chat.mode"), selection: $viewModel.complexityMode) {
                        ForEach(ComplexityMode.allCases, id: \.self) { mode in
                            Label(mode.displayName, systemImage: mode.systemImage)
                                .tag(mode)
                        }
                    }

                    Divider()

                    Button {
                        viewModel.showArtifacts = true
                    } label: {
                        Label(String(localized: "chat.artifacts"), systemImage: "archivebox")
                    }

                    Button {
                        viewModel.showRawEvents = true
                    } label: {
                        Label(String(localized: "chat.rawEvents"), systemImage: "list.bullet.rectangle")
                    }
                } label: {
                    Image(systemName: viewModel.complexityMode.systemImage)
                }
                .accessibilityLabel(String(localized: "a11y.modeSelector"))
            }
        }
        .safeAreaInset(edge: .bottom) {
            ComposerBar(
                text: $viewModel.inputText,
                isRunning: viewModel.reducer.currentStatus == .running,
                canSend: store.isConnected,
                provider: viewModel.reducer.sessionAgent ?? "MiWarp",
                model: viewModel.reducer.sessionModel ?? "Model pending",
                runtimeStatus: store.connectionState,
                toastPresenter: toastPresenter,
                onSend: { MiHaptics.lightImpact(); Task { await viewModel.sendMessage() } },
                onStop: { Task { await viewModel.stopSession() } },
                onAttach: {
                    toastPresenter.show("Attachments", message: "File attach is reserved for the next mobile pass.", kind: .info)
                }
            )
            .frame(maxWidth: layout.chatContentMaxWidth)
            .frame(maxWidth: .infinity)
            .readSize { size in
                inputBarHeight = size.height
            }
        }
    }

    // MARK: - Status Bar

    private var runStatusBar: some View {
        HStack(spacing: MWSpacing.lg) {
            statusPill(viewModel.reducer.currentStatus)

            if viewModel.reducer.usage.costUsd > 0 {
                Text(String(format: "$%.4f", viewModel.reducer.usage.costUsd))
                    .font(.caption.monospaced())
                    .foregroundStyle(MWColors.statusWarning)
                    .contentTransition(.numericText())
            }

            if viewModel.reducer.usage.inputTokens > 0 {
                HStack(spacing: 2) {
                    Image(systemName: "arrow.down.circle")
                        .font(.caption)
                    Text(viewModel.formatTokens(viewModel.reducer.usage.inputTokens))
                        .font(.caption.monospaced())
                }
                .foregroundStyle(theme.cardTextTertiary)
                .contentTransition(.numericText())
            }

            if viewModel.reducer.usage.outputTokens > 0 {
                HStack(spacing: 2) {
                    Image(systemName: "arrow.up.circle")
                        .font(.caption)
                    Text(viewModel.formatTokens(viewModel.reducer.usage.outputTokens))
                        .font(.caption.monospaced())
                }
                .foregroundStyle(theme.cardTextTertiary)
                .contentTransition(.numericText())
            }

            Spacer()
        }
        .padding(.horizontal, MWSpacing.lg)
        .padding(.vertical, MWSpacing.sm)
        .accessibilityElement(children: .combine)
        .animation(MWMotion.springQuick, value: viewModel.reducer.usage.costUsd)
    }

    private func statusPill(_ status: RunStatus) -> some View {
        Text(status.displayLabel)
            .font(.caption.weight(.medium))
            .foregroundStyle(statusColor(status))
            .padding(.horizontal, MWSpacing.sm)
            .padding(.vertical, 3)
            .background(statusColor(status).opacity(0.18), in: Capsule())
            .contentTransition(.opacity)
            .animation(MWMotion.springQuick, value: status)
    }

    private func statusColor(_ status: RunStatus) -> Color {
        switch status {
        case .running: return theme.accentPrimary
        case .waitingApproval: return MWColors.statusWarning
        case .failed: return MWColors.statusError
        case .completed: return MWColors.statusSuccess
        case .pending: return MWColors.statusPending
        case .idle: return MWColors.statusIdle
        case .stopped: return MWColors.statusStopped
        }
    }

    // MARK: - Reconnect Banner

    private func reconnectBanner(attempt: Int) -> some View {
        HStack(spacing: MWSpacing.sm) {
            ProgressView()
                .scaleEffect(0.75)
            VStack(alignment: .leading, spacing: 1) {
                Text(String(localized: "chat.reconnecting"))
                    .font(.subheadline.weight(.medium))
                Text(String(format: String(localized: "chat.attempt"), attempt))
                    .font(.caption2)
                    .foregroundStyle(theme.cardTextSecondary)
            }
            Spacer()
            Button(String(localized: "action.cancel")) {
                store.disconnect()
            }
            .font(.subheadline)
        }
        .padding(.horizontal, MWSpacing.lg)
        .padding(.vertical, MWSpacing.sm)
        .background(MWColors.statusWarning.opacity(0.08))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(String(localized: "chat.reconnecting"))
    }
}

// MARK: - Inline Approval

struct InlineApprovalView: View {
    let toolName: String
    let description: String?
    var onApprove: ((Bool) -> Void)?
    @State private var didRespond = false
    @EnvironmentObject private var theme: MWTheme

    var body: some View {
        VStack(alignment: .leading, spacing: MWSpacing.lg) {
            HStack(spacing: MWSpacing.sm) {
                Image(systemName: "exclamationmark.shield.fill")
                    .symbolEffect(.pulse.byLayer, options: .repeating)
                    .foregroundStyle(MWColors.statusWarning)
                Text(String(localized: "chat.permissionRequired"))
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(MWColors.statusWarning)
            }

            Label(toolName, systemImage: "wrench.and.screwdriver")
                .font(.caption.monospaced())
                .foregroundStyle(theme.cardTextSecondary)

            if let desc = description, !desc.isEmpty {
                Text(desc)
                    .font(.callout)
                    .foregroundStyle(theme.cardTextSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack(spacing: MWSpacing.md) {
                Button {
                    didRespond = true
                    onApprove?(false)
                } label: {
                    Text(String(localized: "action.deny"))
                        .font(.subheadline.weight(.medium))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, MWSpacing.sm)
                        .background(.quaternary, in: RoundedRectangle(cornerRadius: MWRadius.md))
                }
                .disabled(didRespond)
                .accessibilityLabel(String(localized: "action.deny"))

                Button {
                    didRespond = true
                    onApprove?(true)
                } label: {
                    Text(String(localized: "action.allow"))
                        .font(.subheadline.weight(.medium))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, MWSpacing.sm)
                        .background(.tint, in: RoundedRectangle(cornerRadius: MWRadius.md))
                        .foregroundStyle(MWColors.accentOnAccent)
                }
                .disabled(didRespond)
                .accessibilityLabel(String(localized: "action.allow"))
            }
        }
        .padding(14)
        .background(MWColors.cardBg, in: RoundedRectangle(cornerRadius: MWRadius.card))
        .overlay(
            RoundedRectangle(cornerRadius: MWRadius.card)
                .stroke(MWColors.statusWarning.opacity(0.3), lineWidth: 1)
        )
        .shadow(color: MWColors.statusWarning.opacity(0.1), radius: 8)
        .transition(.asymmetric(
            insertion: .scale(scale: 0.95).combined(with: .opacity),
            removal: .scale(scale: 0.95).combined(with: .opacity)
        ))
        .animation(MWMotion.springStandard, value: didRespond)
        .sensoryFeedback(.warning, trigger: didRespond)
    }
}
