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
    @State private var inspectorExpanded = false
    @State private var activeInspectorPanel: ChatInspectorPanel = .workspace

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
        Group {
            if layout.shouldUseSplitView {
                HStack(spacing: 0) {
                    chatSurface(layout: layout)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)

                    ChatInspectorSidebar(
                        activePanel: $activeInspectorPanel,
                        isExpanded: $inspectorExpanded,
                        runTitle: runTitle,
                        status: viewModel.reducer.currentStatus,
                        agent: viewModel.reducer.sessionAgent,
                        model: viewModel.reducer.sessionModel,
                        usage: viewModel.reducer.usage,
                        messages: viewModel.reducer.messages,
                        pendingPermissions: viewModel.reducer.pendingPermissions,
                        rawEventCount: viewModel.rawEvents.count,
                        complexityMode: $viewModel.complexityMode,
                        onOpenArtifacts: { viewModel.showArtifacts = true },
                        onOpenRawEvents: { viewModel.showRawEvents = true }
                    )
                }
            } else {
                chatSurface(layout: layout)
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
    }

    private func chatSurface(layout: MWAdaptiveLayout) -> some View {
        VStack(spacing: 0) {
            // Reconnect banner
            if case .reconnecting(let attempt) = store.connectionState {
                reconnectBanner(attempt: attempt)
            }

            if let notice = viewModel.reducer.protocolRecovery.notice {
                protocolRecoveryBanner(
                    notice: notice,
                    isRecovering: viewModel.reducer.protocolRecovery.isRecovering,
                    showReloadAction: viewModel.reducer.protocolRecovery.showReloadAction
                )
            }

            // Status bar
            runStatusBar

            // Messages
            if viewModel.isLoading {
                ScrollView {
                    VStack(spacing: MWSpacing.md) {
                        MiSkeletonCard(lines: 4, height: 168)
                        MiSkeletonCard(lines: 3, showsAvatar: true)
                        MiSkeletonCard(lines: 3, showsAvatar: true)
                    }
                    .padding(.horizontal, MWSpacing.lg)
                    .padding(.top, MWSpacing.xl)
                    .frame(maxWidth: layout.contentMaxWidth)
                    .frame(maxWidth: .infinity)
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
                InlineApprovalView(toolName: permission.toolName, description: permission.description) { approved in
                    Task { await viewModel.handlePermission(requestId: permission.id, approved: approved) }
                }
                .frame(maxWidth: layout.chatAssistantBubbleMaxWidth)
                .frame(maxWidth: .infinity)
                .padding(.horizontal, MWSpacing.lg)
                .padding(.bottom, MWSpacing.sm)
            }
        }
        .safeAreaInset(edge: .bottom) {
            ComposerBar(
                text: $viewModel.inputText,
                isRunning: viewModel.reducer.currentStatus == .running,
                canSend: !viewModel.reducer.protocolRecovery.isRecovering,
                queuedCount: viewModel.queuedMessageCount,
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
                    .font(MWTypography.monoCaption())
                    .foregroundStyle(MWColors.statusWarning)
                    .contentTransition(.numericText())
            }

            if viewModel.reducer.usage.inputTokens > 0 {
                HStack(spacing: MWSpacing.xxs) {
                    Image(systemName: "arrow.down.circle")
                        .font(MWTypography.caption())
                    Text(viewModel.formatTokens(viewModel.reducer.usage.inputTokens))
                        .font(MWTypography.monoCaption())
                }
                .foregroundStyle(theme.cardTextTertiary)
                .contentTransition(.numericText())
            }

            if viewModel.reducer.usage.outputTokens > 0 {
                HStack(spacing: MWSpacing.xxs) {
                    Image(systemName: "arrow.up.circle")
                        .font(MWTypography.caption())
                    Text(viewModel.formatTokens(viewModel.reducer.usage.outputTokens))
                        .font(MWTypography.monoCaption())
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
        MWStatusPill(status: status)
            .contentTransition(.opacity)
            .animation(MWMotion.springQuick, value: status)
    }

    // MARK: - Reconnect Banner

    private func reconnectBanner(attempt: Int) -> some View {
        HStack(spacing: MWSpacing.sm) {
            ProgressView()
                .scaleEffect(0.75)
            VStack(alignment: .leading, spacing: 1) {
                Text(String(localized: "chat.reconnecting"))
                    .font(MWTypography.subheadlineMedium())
                Text(String(format: String(localized: "chat.attempt"), attempt))
                    .font(MWTypography.caption2())
                    .foregroundStyle(theme.cardTextSecondary)
            }
            Spacer()
            Button(String(localized: "action.cancel")) {
                store.disconnect()
            }
            .font(MWTypography.subheadline())
        }
        .padding(.horizontal, MWSpacing.lg)
        .padding(.vertical, MWSpacing.sm)
        .background(MWColors.statusWarning.opacity(0.08))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(String(localized: "chat.reconnecting"))
    }

    private func protocolRecoveryBanner(
        notice: String,
        isRecovering: Bool,
        showReloadAction: Bool
    ) -> some View {
        HStack(spacing: MWSpacing.sm) {
            if isRecovering {
                ProgressView()
                    .scaleEffect(0.75)
            } else {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(MWColors.statusWarning)
            }

            Text(notice)
                .font(MWTypography.subheadline())
                .foregroundStyle(theme.cardTextPrimary)
                .multilineTextAlignment(.leading)

            Spacer()

            if showReloadAction {
                Button(String(localized: "protocol.reloadSession")) {
                    Task { await viewModel.loadHistory() }
                }
                .font(MWTypography.subheadlineMedium())
            }
        }
        .padding(.horizontal, MWSpacing.lg)
        .padding(.vertical, MWSpacing.sm)
        .background(MWColors.statusWarning.opacity(0.08))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - iPad Inspector

private enum ChatInspectorPanel: String, CaseIterable, Identifiable {
    case workspace
    case tools
    case artifacts
    case events

    var id: String { rawValue }

    var title: String {
        switch self {
        case .workspace: return String(localized: "chatInspector.workspace")
        case .tools: return String(localized: "chatInspector.tools")
        case .artifacts: return String(localized: "chat.artifacts")
        case .events: return String(localized: "chat.rawEvents")
        }
    }

    var systemImage: String {
        switch self {
        case .workspace: return "house"
        case .tools: return "wrench.and.screwdriver"
        case .artifacts: return "archivebox"
        case .events: return "list.bullet.rectangle"
        }
    }
}

private struct ChatInspectorSidebar: View {
    @Binding var activePanel: ChatInspectorPanel
    @Binding var isExpanded: Bool
    let runTitle: String
    let status: RunStatus
    let agent: String?
    let model: String?
    let usage: UsageSummary
    let messages: [DisplayMessage]
    let pendingPermissions: [PendingPermission]
    let rawEventCount: Int
    @Binding var complexityMode: ComplexityMode
    var onOpenArtifacts: () -> Void
    var onOpenRawEvents: () -> Void

    @EnvironmentObject private var theme: MWTheme

    private var toolCalls: [DisplayToolCall] {
        messages.flatMap(\.toolCalls)
    }

    var body: some View {
        HStack(spacing: 0) {
            rail

            if isExpanded {
                Divider()
                    .overlay(theme.divider)

                panelContent
                    .frame(width: 286)
                    .transition(.move(edge: .trailing).combined(with: .opacity))
            }
        }
        .frame(width: isExpanded ? 340 : 54)
        .frame(maxHeight: .infinity)
        .background(inspectorBackground)
        .animation(MWMotion.springStandard, value: isExpanded)
        .animation(MWMotion.springQuick, value: activePanel)
    }

    private var rail: some View {
        VStack(spacing: MWSpacing.sm) {
            ForEach(ChatInspectorPanel.allCases) { panel in
                inspectorButton(panel)
            }

            Spacer(minLength: MWSpacing.md)

            Button {
                MiHaptics.lightImpact()
                isExpanded.toggle()
            } label: {
                Image(systemName: isExpanded ? "sidebar.right" : "sidebar.right")
                    .font(MWTypography.body().weight(.medium))
                    .frame(width: 36, height: 36)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .foregroundStyle(theme.textSecondary)
            .background(
                RoundedRectangle(cornerRadius: MWRadius.md)
                    .fill(theme.bgHover.opacity(isExpanded ? 0.75 : 0.32))
            )
            .accessibilityLabel(isExpanded ? String(localized: "chatInspector.collapse") : String(localized: "chatInspector.expand"))
        }
        .padding(.horizontal, MWSpacing.sm)
        .padding(.vertical, MWSpacing.lg)
        .frame(width: 54)
        .frame(maxHeight: .infinity)
    }

    private func inspectorButton(_ panel: ChatInspectorPanel) -> some View {
        Button {
            MiHaptics.lightImpact()
            if activePanel == panel {
                isExpanded.toggle()
            } else {
                activePanel = panel
                isExpanded = true
            }
        } label: {
            ZStack(alignment: .topTrailing) {
                Image(systemName: panel.systemImage)
                    .font(MWTypography.body().weight(.medium))
                    .frame(width: 36, height: 36)

                if panel == .tools && !toolCalls.isEmpty {
                    countDot(toolCalls.count)
                } else if panel == .events && rawEventCount > 0 {
                    countDot(rawEventCount)
                } else if panel == .workspace && !pendingPermissions.isEmpty {
                    Circle()
                        .fill(MWColors.statusWarning)
                        .frame(width: 8, height: 8)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(activePanel == panel && isExpanded ? theme.accentPrimary : theme.textSecondary)
        .background(
            RoundedRectangle(cornerRadius: MWRadius.md)
                .fill(activePanel == panel && isExpanded ? theme.accentPrimary.opacity(0.16) : Color.clear)
        )
        .accessibilityLabel(panel.title)
    }

    private func countDot(_ count: Int) -> some View {
        Text(count > 99 ? "99+" : "\(count)")
            .font(MWTypography.caption2().weight(.bold))
            .foregroundStyle(MWColors.accentOnAccent)
            .lineLimit(1)
            .minimumScaleFactor(0.6)
            .padding(.horizontal, MWSpacing.xxs)
            .frame(minWidth: 16, minHeight: 16)
            .background(Capsule().fill(theme.accentPrimary))
            .offset(x: 3, y: -3)
    }

    private var panelContent: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: MWSpacing.sm) {
                Image(systemName: activePanel.systemImage)
                    .foregroundStyle(theme.accentPrimary)
                Text(activePanel.title)
                    .font(MWTypography.subheadlineMedium())
                    .foregroundStyle(theme.textPrimary)
                Spacer()
                Button {
                    MiHaptics.lightImpact()
                    isExpanded = false
                } label: {
                    Image(systemName: "chevron.right")
                        .font(MWTypography.caption().weight(.semibold))
                }
                .buttonStyle(.plain)
                .foregroundStyle(theme.textTertiary)
                .accessibilityLabel(String(localized: "chatInspector.collapse"))
            }
            .padding(.horizontal, MWSpacing.lg)
            .padding(.vertical, MWSpacing.md)

            Divider()
                .overlay(theme.divider)

            ScrollView {
                VStack(alignment: .leading, spacing: MWSpacing.md) {
                    switch activePanel {
                    case .workspace:
                        workspacePanel
                    case .tools:
                        toolsPanel
                    case .artifacts:
                        artifactsPanel
                    case .events:
                        eventsPanel
                    }
                }
                .padding(MWSpacing.lg)
            }
            .scrollIndicators(.hidden)
        }
    }

    private var workspacePanel: some View {
        VStack(alignment: .leading, spacing: MWSpacing.md) {
            inspectorCard {
                VStack(alignment: .leading, spacing: MWSpacing.sm) {
                    Text(runTitle)
                        .font(MWTypography.bodyMedium())
                        .foregroundStyle(theme.cardTextPrimary)
                        .lineLimit(3)

                    HStack(spacing: MWSpacing.sm) {
                        MWStatusPill(status: status)
                        if !pendingPermissions.isEmpty {
                            Label(String(localized: "chatInspector.needsApproval"), systemImage: "exclamationmark.triangle.fill")
                                .font(MWTypography.caption())
                                .foregroundStyle(MWColors.statusWarning)
                        }
                    }
                }
            }

            inspectorCard {
                VStack(alignment: .leading, spacing: MWSpacing.sm) {
                    metricRow(String(localized: "chatInspector.agent"), value: agent ?? "MiWarp")
                    metricRow(String(localized: "chatInspector.model"), value: model ?? String(localized: "chatInspector.pending"))
                    metricRow(String(localized: "chatInspector.messages"), value: "\(messages.count)")
                    metricRow(String(localized: "chatInspector.tools"), value: "\(toolCalls.count)")
                }
            }

            inspectorCard {
                VStack(alignment: .leading, spacing: MWSpacing.sm) {
                    metricRow(String(localized: "chatInspector.inputTokens"), value: compactNumber(usage.inputTokens))
                    metricRow(String(localized: "chatInspector.outputTokens"), value: compactNumber(usage.outputTokens))
                    metricRow(String(localized: "artifacts.cost"), value: String(format: "$%.4f", usage.costUsd))
                }
            }
        }
    }

    private var toolsPanel: some View {
        VStack(alignment: .leading, spacing: MWSpacing.md) {
            if toolCalls.isEmpty {
                emptyInspectorState(
                    icon: "checkmark.circle",
                    title: String(localized: "chat.allClear"),
                    message: String(localized: "chatInspector.noTools")
                )
            } else {
                ForEach(Array(toolCalls.suffix(12))) { tool in
                    inspectorCard {
                        VStack(alignment: .leading, spacing: MWSpacing.xs) {
                            HStack(spacing: MWSpacing.sm) {
                                Image(systemName: tool.isError ? "xmark.octagon.fill" : tool.isComplete ? "checkmark.circle.fill" : "circle.dotted")
                                    .foregroundStyle(tool.isError ? MWColors.statusError : tool.isComplete ? MWColors.statusSuccess : MWColors.statusRunning)
                                Text(tool.toolName)
                                    .font(MWTypography.monoCaption())
                                    .foregroundStyle(theme.cardTextPrimary)
                                    .lineLimit(1)
                                Spacer()
                            }

                            if let inputPreview = tool.inputPreview, !inputPreview.isEmpty {
                                Text(inputPreview)
                                    .font(MWTypography.caption())
                                    .foregroundStyle(theme.cardTextTertiary)
                                    .lineLimit(3)
                            }
                        }
                    }
                }
            }
        }
    }

    private var artifactsPanel: some View {
        VStack(alignment: .leading, spacing: MWSpacing.md) {
            inspectorAction(
                title: String(localized: "chat.artifacts"),
                subtitle: String(localized: "chatInspector.openArtifacts"),
                icon: "archivebox",
                action: onOpenArtifacts
            )

            inspectorAction(
                title: String(localized: "chat.rawEvents"),
                subtitle: String(format: String(localized: "chatInspector.rawEventCount"), rawEventCount),
                icon: "list.bullet.rectangle",
                action: onOpenRawEvents
            )
        }
    }

    private var eventsPanel: some View {
        VStack(alignment: .leading, spacing: MWSpacing.md) {
            inspectorCard {
                Picker(String(localized: "chat.mode"), selection: $complexityMode) {
                    ForEach(ComplexityMode.allCases, id: \.self) { mode in
                        Label(mode.displayName, systemImage: mode.systemImage)
                            .tag(mode)
                    }
                }
                .pickerStyle(.inline)
            }

            inspectorAction(
                title: String(localized: "chat.rawEvents"),
                subtitle: String(format: String(localized: "chatInspector.rawEventCount"), rawEventCount),
                icon: "list.bullet.rectangle",
                action: onOpenRawEvents
            )
        }
    }

    private func inspectorCard<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        content()
            .padding(MWSpacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: MWRadius.lg)
                    .fill(theme.cardBg.opacity(0.78))
                    .overlay(
                        RoundedRectangle(cornerRadius: MWRadius.lg)
                            .strokeBorder(theme.glassBorder.opacity(0.6), lineWidth: 1)
                    )
            )
    }

    private func inspectorAction(title: String, subtitle: String, icon: String, action: @escaping () -> Void) -> some View {
        Button {
            MiHaptics.lightImpact()
            action()
        } label: {
            HStack(spacing: MWSpacing.md) {
                Image(systemName: icon)
                    .font(MWTypography.title3().weight(.medium))
                    .foregroundStyle(theme.accentPrimary)
                    .frame(width: 28)

                VStack(alignment: .leading, spacing: MWSpacing.xxs) {
                    Text(title)
                        .font(MWTypography.subheadlineMedium())
                        .foregroundStyle(theme.cardTextPrimary)
                    Text(subtitle)
                        .font(MWTypography.caption())
                        .foregroundStyle(theme.cardTextTertiary)
                        .lineLimit(2)
                }

                Spacer()

                Image(systemName: "arrow.up.right")
                    .font(MWTypography.caption().weight(.bold))
                    .foregroundStyle(theme.cardTextTertiary)
            }
            .padding(MWSpacing.md)
            .background(
                RoundedRectangle(cornerRadius: MWRadius.lg)
                    .fill(theme.cardBg.opacity(0.78))
                    .overlay(
                        RoundedRectangle(cornerRadius: MWRadius.lg)
                            .strokeBorder(theme.glassBorder.opacity(0.6), lineWidth: 1)
                    )
            )
        }
        .buttonStyle(.plain)
    }

    private func metricRow(_ label: String, value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: MWSpacing.sm) {
            Text(label)
                .font(MWTypography.caption())
                .foregroundStyle(theme.cardTextTertiary)
            Spacer(minLength: MWSpacing.sm)
            Text(value)
                .font(MWTypography.monoCaption())
                .foregroundStyle(theme.cardTextPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
        }
    }

    private func emptyInspectorState(icon: String, title: String, message: String) -> some View {
        VStack(spacing: MWSpacing.sm) {
            Image(systemName: icon)
                .font(MWTypography.title2())
                .foregroundStyle(theme.textTertiary)
            Text(title)
                .font(MWTypography.subheadlineMedium())
                .foregroundStyle(theme.textSecondary)
            Text(message)
                .font(MWTypography.caption())
                .foregroundStyle(theme.textTertiary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, MWSpacing.xl)
    }

    private var inspectorBackground: some View {
        Rectangle()
            .fill(.ultraThinMaterial)
            .background(theme.bgDeep.opacity(0.86))
            .overlay(alignment: .leading) {
                Rectangle()
                    .fill(theme.glassBorder.opacity(0.7))
                    .frame(width: 1)
            }
    }

    private func compactNumber(_ value: Int) -> String {
        if value >= 1_000_000 {
            return String(format: "%.1fM", Double(value) / 1_000_000)
        }
        if value >= 1_000 {
            return String(format: "%.1fK", Double(value) / 1_000)
        }
        return "\(value)"
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
                    .font(MWTypography.subheadline().weight(.semibold))
                    .foregroundStyle(MWColors.statusWarning)
            }

            Label(toolName, systemImage: "wrench.and.screwdriver")
                .font(MWTypography.monoCaption())
                .foregroundStyle(theme.cardTextSecondary)

            if let desc = description, !desc.isEmpty {
                Text(desc)
                    .font(MWTypography.callout())
                    .foregroundStyle(theme.cardTextSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack(spacing: MWSpacing.md) {
                Button {
                    didRespond = true
                    onApprove?(false)
                } label: {
                    Text(String(localized: "action.deny"))
                        .font(MWTypography.subheadlineMedium())
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
                        .font(MWTypography.subheadlineMedium())
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, MWSpacing.sm)
                        .background(.tint, in: RoundedRectangle(cornerRadius: MWRadius.md))
                        .foregroundStyle(MWColors.accentOnAccent)
                }
                .disabled(didRespond)
                .accessibilityLabel(String(localized: "action.allow"))
            }
        }
        .padding(MWSpacing.lg)
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
