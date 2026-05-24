import SwiftUI

// MARK: - Glass Card

struct MWGlassCard<Content: View>: View {
    let content: Content
    var cornerRadius: CGFloat = MWRadius.lg
    var borderColor: Color?

    init(cornerRadius: CGFloat = MWRadius.lg, borderColor: Color? = nil, @ViewBuilder content: () -> Content) {
        self.cornerRadius = cornerRadius
        self.borderColor = borderColor
        self.content = content()
    }

    var body: some View {
        content
            .padding(MWSpacing.lg)
            .background(
                RoundedRectangle(cornerRadius: cornerRadius)
                    .fill(.ultraThinMaterial)
                    .overlay(
                        RoundedRectangle(cornerRadius: cornerRadius)
                            .strokeBorder(.white.opacity(0.2), lineWidth: 1)
                    )
            )
    }
}

// MARK: - Status Pill

struct MWStatusPill: View {
    let status: RunStatus

    var body: some View {
        HStack(spacing: MWSpacing.xs) {
            Circle()
                .fill(MWColors.color(for: status))
                .frame(width: 6, height: 6)
            Text(status.displayLabel)
                .font(MWTypography.caption())
                .foregroundColor(MWColors.textPrimary)
        }
        .padding(.horizontal, MWSpacing.sm)
        .padding(.vertical, MWSpacing.xs)
        .background(
            Capsule()
                .fill(MWColors.color(for: status).opacity(0.15))
        )
    }
}

// MARK: - Session Card

struct MWSessionCard: View {
    let run: MiWarpRun
    var onTap: (() -> Void)?

    private var glowColor: Color {
        switch run.status {
        case .running: return MWColors.glowRunning
        case .waitingApproval: return MWColors.glowApproval
        default: return .clear
        }
    }

    var body: some View {
        Button {
            onTap?()
        } label: {
            VStack(alignment: .leading, spacing: MWSpacing.sm) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: MWSpacing.xs) {
                        Text(run.displayTitle)
                            .font(MWTypography.bodyMedium())
                            .foregroundColor(MWColors.textPrimary)
                            .lineLimit(2)

                        HStack(spacing: MWSpacing.sm) {
                            Label(run.agent, systemImage: "cpu")
                            Text("·")
                                .foregroundColor(MWColors.textTertiary)
                            Label(run.model, systemImage: "cube")
                        }
                        .font(MWTypography.caption())
                        .foregroundColor(MWColors.textSecondary)
                    }

                    Spacer(minLength: MWSpacing.sm)

                    MWStatusPill(status: run.status)
                }

                HStack(spacing: MWSpacing.md) {
                    Label(run.shortCwd, systemImage: "folder")
                        .font(MWTypography.monoSmall())
                        .foregroundColor(MWColors.textTertiary)
                        .lineLimit(1)

                    Spacer()

                    Label("\(run.messageCount)", systemImage: "message")
                        .font(MWTypography.caption())
                        .foregroundColor(MWColors.textTertiary)

                    if let lastActivity = run.lastActivity {
                        Text(lastActivity.formatted(.relative(presentation: .named)))
                            .font(MWTypography.caption2())
                            .foregroundColor(MWColors.textTertiary)
                    }
                }

                // Source badge + indicators
                HStack(spacing: MWSpacing.sm) {
                    if run.source != .unknown {
                        HStack(spacing: MWSpacing.xs) {
                            Image(systemName: sourceIcon(run.source))
                                .font(MWTypography.caption2())
                            Text(run.source.rawValue.capitalized)
                                .font(MWTypography.caption2())
                        }
                        .foregroundColor(MWColors.accentCyan)
                        .padding(.horizontal, MWSpacing.sm)
                        .padding(.vertical, 2)
                        .background(
                            Capsule()
                                .fill(MWColors.accentCyan.opacity(0.1))
                        )
                    }

                    if run.hasApprovalPending {
                        Label("Approval", systemImage: "exclamationmark.shield.fill")
                            .font(MWTypography.caption2())
                            .foregroundColor(MWColors.statusWarning)
                    }
                    if run.hasFilesChanged {
                        Label("Files", systemImage: "doc.badge.arrow.up")
                            .font(MWTypography.caption2())
                            .foregroundColor(MWColors.accentCyan)
                    }
                    if run.hasArtifacts {
                        Label("Artifacts", systemImage: "archivebox")
                            .font(MWTypography.caption2())
                            .foregroundColor(MWColors.accentPrimary)
                    }

                    Spacer()
                }
            }
            .padding(MWSpacing.lg)
            .background(
                RoundedRectangle(cornerRadius: MWRadius.lg)
                    .fill(.ultraThinMaterial)
                    .overlay(
                        RoundedRectangle(cornerRadius: MWRadius.lg)
                            .strokeBorder(
                                run.status == .waitingApproval
                                    ? MWColors.statusWarning.opacity(0.3)
                                    : .white.opacity(0.15),
                                lineWidth: run.status == .waitingApproval ? 1 : 0.5
                            )
                    )
            )
            .mwGlassGlow(glowColor, radius: run.status == .running ? 16 : 12,
                         isActive: run.status == .running || run.status == .waitingApproval)
        }
        .buttonStyle(.plain)
    }

    private func sourceIcon(_ source: RunSource) -> String {
        switch source {
        case .cli: return "terminal"
        case .web: return "globe"
        case .mobile: return "iphone"
        case .api: return "point.3.connected.trianglepath.dotted"
        case .unknown: return "questionmark.circle"
        }
    }
}

// MARK: - Chat Bubble

struct MWChatBubble: View {
    let role: String
    let content: String
    var isStreaming: Bool = false

    var isUser: Bool { role == "user" }

    var body: some View {
        HStack {
            if isUser { Spacer(minLength: 48) }

            VStack(alignment: isUser ? .trailing : .leading, spacing: MWSpacing.xs) {
                Text(content)
                    .font(isUser ? MWTypography.body() : MWTypography.body())
                    .foregroundColor(isUser ? .white : MWColors.textPrimary)
                    .textSelection(.enabled)

                if isStreaming {
                    HStack(spacing: MWSpacing.xs) {
                        ProgressView()
                            .scaleEffect(0.6)
                            .tint(MWColors.accentCyan)
                        Text("streaming")
                            .font(MWTypography.caption2())
                            .foregroundColor(MWColors.textTertiary)
                    }
                }
            }
            .padding(.horizontal, MWSpacing.lg)
            .padding(.vertical, MWSpacing.md)
            .background(
                RoundedRectangle(cornerRadius: isUser ? MWRadius.xl : MWRadius.lg)
                    .fill(isUser ? MWColors.accentPrimary : MWColors.bgSurface)
            )
            .overlay(
                RoundedRectangle(cornerRadius: isUser ? MWRadius.xl : MWRadius.lg)
                    .strokeBorder(
                        isUser ? Color.clear : .white.opacity(0.1),
                        lineWidth: 0.5
                    )
            )

            if !isUser { Spacer(minLength: 48) }
        }
    }
}

// MARK: - Tool Call Card

struct MWToolCallCard: View {
    let toolName: String
    let inputPreview: String?
    let output: String?
    var isComplete: Bool = false
    var isError: Bool = false
    let isExpanded: Bool
    var onToggle: (() -> Void)?

    var statusIcon: String {
        if isError { return "xmark.circle.fill" }
        if isComplete { return "checkmark.circle.fill" }
        return "arrow.triangle.2.circlepath"
    }

    var statusColor: Color {
        if isError { return MWColors.statusError }
        if isComplete { return MWColors.statusDone }
        return MWColors.accentCyan
    }

    var body: some View {
        VStack(alignment: .leading, spacing: MWSpacing.sm) {
            Button {
                withAnimation(.easeInOut(duration: MWMotion.normal)) {
                    onToggle?()
                }
            } label: {
                HStack(spacing: MWSpacing.sm) {
                    Image(systemName: statusIcon)
                        .font(.system(size: 12))
                        .foregroundColor(statusColor)

                    Text(toolName)
                        .font(MWTypography.monoCaption())
                        .foregroundColor(MWColors.accentCyan)

                    Spacer()

                    if !isComplete && !isError {
                        ProgressView()
                            .scaleEffect(0.6)
                            .tint(MWColors.accentCyan)
                    }

                    Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                        .font(MWTypography.caption2())
                        .foregroundColor(MWColors.textTertiary)
                }
            }
            .buttonStyle(.plain)

            if isExpanded {
                if let input = inputPreview, !input.isEmpty {
                    VStack(alignment: .leading, spacing: MWSpacing.xs) {
                        Text("Input")
                            .font(MWTypography.caption2())
                            .foregroundColor(MWColors.textTertiary)
                        Text(input)
                            .font(MWTypography.monoSmall())
                            .foregroundColor(MWColors.textSecondary)
                            .textSelection(.enabled)
                    }
                }

                if let output = output, !output.isEmpty {
                    VStack(alignment: .leading, spacing: MWSpacing.xs) {
                        Text("Output")
                            .font(MWTypography.caption2())
                            .foregroundColor(MWColors.textTertiary)
                        Text(output)
                            .font(MWTypography.monoSmall())
                            .foregroundColor(isError ? MWColors.statusError : MWColors.textSecondary)
                            .lineLimit(15)
                            .textSelection(.enabled)
                    }
                }
            }
        }
        .padding(MWSpacing.md)
        .background(
            RoundedRectangle(cornerRadius: MWRadius.md)
                .fill(MWColors.bgDeep)
                .overlay(
                    RoundedRectangle(cornerRadius: MWRadius.md)
                        .strokeBorder(
                            isError ? MWColors.statusError.opacity(0.2) : MWColors.accentCyan.opacity(0.15),
                            lineWidth: 0.5
                        )
                )
        )
    }
}

// MARK: - Approval Card

struct MWApprovalCard: View {
    let requestId: String
    let toolName: String
    let description: String?
    var onApprove: ((Bool) -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: MWSpacing.md) {
            // Header
            HStack(spacing: MWSpacing.sm) {
                Image(systemName: "exclamationmark.shield.fill")
                    .font(.system(size: 16))
                    .foregroundColor(MWColors.statusWarning)

                Text("Permission Required")
                    .font(MWTypography.bodyMedium())
                    .foregroundColor(MWColors.statusWarning)

                Spacer()
            }

            // Tool name
            HStack(spacing: MWSpacing.xs) {
                Image(systemName: "wrench.and.screwdriver")
                    .font(.caption2)
                    .foregroundColor(MWColors.textTertiary)
                Text(toolName)
                    .font(MWTypography.monoCaption())
                    .foregroundColor(MWColors.accentCyan)
            }

            // Description
            if let desc = description, !desc.isEmpty {
                Text(desc)
                    .font(MWTypography.callout())
                    .foregroundColor(MWColors.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            // Action buttons
            HStack(spacing: MWSpacing.md) {
                Button {
                    onApprove?(false)
                } label: {
                    Label("Deny", systemImage: "xmark")
                        .font(MWTypography.subheadlineMedium())
                        .foregroundColor(MWColors.textSecondary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, MWSpacing.sm)
                        .background(
                            RoundedRectangle(cornerRadius: MWRadius.md)
                                .fill(MWColors.bgSurface)
                        )
                }

                Button {
                    onApprove?(true)
                } label: {
                    Label("Allow", systemImage: "checkmark")
                        .font(MWTypography.subheadlineMedium())
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, MWSpacing.sm)
                        .background(
                            RoundedRectangle(cornerRadius: MWRadius.md)
                                .fill(MWColors.accentPrimary)
                        )
                }
            }
        }
        .padding(MWSpacing.lg)
        .background(
            RoundedRectangle(cornerRadius: MWRadius.lg)
                .fill(MWColors.bgElevated)
                .overlay(
                    RoundedRectangle(cornerRadius: MWRadius.lg)
                        .strokeBorder(MWColors.statusWarning.opacity(0.25), lineWidth: 1)
                )
                .shadow(color: MWColors.statusWarning.opacity(0.08), radius: 12, x: 0, y: 0)
        )
    }
}

// MARK: - Diff File Row

struct MWDiffFileRow: View {
    let path: String
    let status: FileChangeStatus
    let additions: Int?
    let deletions: Int?

    var statusIcon: String {
        switch status {
        case .added: return "plus.circle.fill"
        case .modified: return "pencil.circle.fill"
        case .deleted: return "minus.circle.fill"
        case .renamed: return "arrow.triangle.2.circlepath"
        }
    }

    var statusColor: Color {
        switch status {
        case .added: return MWColors.statusSuccess
        case .modified: return MWColors.statusWarning
        case .deleted: return MWColors.statusError
        case .renamed: return MWColors.accentCyan
        }
    }

    var body: some View {
        HStack(spacing: MWSpacing.sm) {
            Image(systemName: statusIcon)
                .foregroundColor(statusColor)
                .frame(width: 16)

            Text(path)
                .font(MWTypography.monoCaption())
                .foregroundColor(MWColors.textPrimary)
                .lineLimit(1)
                .truncationMode(.middle)

            Spacer()

            if let add = additions, add > 0 {
                Text("+\(add)")
                    .font(MWTypography.monoSmall())
                    .foregroundColor(MWColors.statusSuccess)
            }
            if let del = deletions, del > 0 {
                Text("-\(del)")
                    .font(MWTypography.monoSmall())
                    .foregroundColor(MWColors.statusError)
            }
        }
        .padding(.vertical, MWSpacing.xs)
    }
}

// MARK: - Input Bar

struct MWInputBar: View {
    @Binding var text: String
    var isRunning: Bool = false
    var canSend: Bool = true
    var onSend: (() -> Void)?
    var onStop: (() -> Void)?
    var onFork: (() -> Void)?

    @FocusState private var isFocused: Bool

    var body: some View {
        HStack(alignment: .bottom, spacing: MWSpacing.sm) {
            // Text field with glass background
            TextField("Type a message...", text: $text, axis: .vertical)
                .textFieldStyle(.plain)
                .font(MWTypography.body())
                .lineLimit(1...6)
                .focused($isFocused)
                .padding(.horizontal, MWSpacing.md)
                .padding(.vertical, MWSpacing.sm)
                .background(
                    RoundedRectangle(cornerRadius: MWRadius.xl)
                        .fill(.ultraThinMaterial)
                        .overlay(
                            RoundedRectangle(cornerRadius: MWRadius.xl)
                                .strokeBorder(
                                    isFocused ? MWColors.accentCyan.opacity(0.3) : .white.opacity(0.1),
                                    lineWidth: 1
                                )
                        )
                )

            if isRunning {
                // Stop button
                Button {
                    onStop?()
                } label: {
                    Image(systemName: "stop.circle.fill")
                        .font(.system(size: 30))
                        .foregroundColor(MWColors.statusError)
                }

                // Fork button
                Button {
                    onFork?()
                } label: {
                    Image(systemName: "arrow.branch")
                        .font(.system(size: 20))
                        .foregroundColor(MWColors.accentCyan)
                        .frame(width: 30, height: 30)
                }
            } else {
                // Send button
                Button {
                    onSend?()
                } label: {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.system(size: 30))
                        .foregroundColor(
                            (!canSend || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                                ? MWColors.textTertiary
                                : MWColors.accentPrimary
                        )
                }
                .disabled(!canSend || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(.horizontal, MWSpacing.lg)
        .padding(.vertical, MWSpacing.md)
        .background(
            Rectangle()
                .fill(.ultraThinMaterial)
                .overlay(
                    Rectangle()
                        .strokeBorder(.white.opacity(0.15), lineWidth: 0.5)
                        .padding(.top, 0.5)
                )
        )
    }
}

// MARK: - Glass Glow Modifier

struct MWGlassGlow: ViewModifier {
    let color: Color
    var radius: CGFloat = 12
    var isActive: Bool = true

    func body(content: Content) -> some View {
        content
            .shadow(color: isActive ? color : .clear, radius: radius, x: 0, y: 0)
    }
}

extension View {
    func mwGlassGlow(_ color: Color, radius: CGFloat = 12, isActive: Bool = true) -> some View {
        modifier(MWGlassGlow(color: color, radius: radius, isActive: isActive))
    }
}

// MARK: - Empty State

struct MWEmptyState: View {
    let icon: String
    let title: String
    let message: String
    var actionTitle: String?
    var actionIcon: String?
    var onAction: (() -> Void)?

    init(icon: String, title: String, message: String, actionTitle: String? = nil, actionIcon: String? = nil, onAction: (() -> Void)? = nil) {
        self.icon = icon
        self.title = title
        self.message = message
        self.actionTitle = actionTitle
        self.actionIcon = actionIcon
        self.onAction = onAction
    }

    var body: some View {
        VStack(spacing: MWSpacing.xl) {
            Image(systemName: icon)
                .font(.system(size: 52))
                .foregroundStyle(MWColors.accentPrimary, MWColors.accentCyan)
                .padding(.bottom, MWSpacing.sm)

            VStack(spacing: MWSpacing.sm) {
                Text(title)
                    .font(MWTypography.title3())
                    .foregroundColor(MWColors.textPrimary)
                Text(message)
                    .font(MWTypography.callout())
                    .foregroundColor(MWColors.textSecondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let actionTitle, let onAction {
                Button {
                    onAction()
                } label: {
                    Label(actionTitle, systemImage: actionIcon ?? "arrow.right")
                        .font(MWTypography.bodyMedium())
                        .foregroundColor(.white)
                        .padding(.horizontal, MWSpacing.xl)
                        .padding(.vertical, MWSpacing.md)
                        .background(
                            Capsule()
                                .fill(MWColors.accentPrimary)
                        )
                }
                .padding(.top, MWSpacing.sm)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.horizontal, MWSpacing.xxxl)
    }
}

// MARK: - Error State

struct MWErrorState: View {
    let title: String
    let message: String
    var actionTitle: String?
    var secondaryTitle: String?
    var onAction: (() -> Void)?
    var onSecondary: (() -> Void)?

    init(message: String, title: String = "Something went wrong", actionTitle: String? = "Retry", secondaryTitle: String? = nil, onAction: (() -> Void)? = nil, onSecondary: (() -> Void)? = nil) {
        self.title = title
        self.message = message
        self.actionTitle = actionTitle
        self.secondaryTitle = secondaryTitle
        self.onAction = onAction
        self.onSecondary = onSecondary
    }

    var body: some View {
        VStack(spacing: MWSpacing.xl) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 48))
                .foregroundColor(MWColors.statusError)

            VStack(spacing: MWSpacing.sm) {
                Text(title)
                    .font(MWTypography.title3())
                    .foregroundColor(MWColors.textPrimary)
                Text(message)
                    .font(MWTypography.callout())
                    .foregroundColor(MWColors.textSecondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack(spacing: MWSpacing.md) {
                if let actionTitle, let onAction {
                    Button {
                        onAction()
                    } label: {
                        Label(actionTitle, systemImage: "arrow.clockwise")
                            .font(MWTypography.bodyMedium())
                            .foregroundColor(.white)
                            .padding(.horizontal, MWSpacing.xl)
                            .padding(.vertical, MWSpacing.md)
                            .background(
                                Capsule()
                                    .fill(MWColors.accentPrimary)
                            )
                    }
                }

                if let secondaryTitle, let onSecondary {
                    Button {
                        onSecondary()
                    } label: {
                        Text(secondaryTitle)
                            .font(MWTypography.bodyMedium())
                            .foregroundColor(MWColors.textSecondary)
                            .padding(.horizontal, MWSpacing.lg)
                            .padding(.vertical, MWSpacing.md)
                            .background(
                                Capsule()
                                    .strokeBorder(.white.opacity(0.15), lineWidth: 1)
                            )
                    }
                }
            }
            .padding(.top, MWSpacing.sm)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.horizontal, MWSpacing.xxxl)
    }
}

// MARK: - Loading State

struct MWLoadingState: View {
    var message: String = "Loading..."

    var body: some View {
        VStack(spacing: MWSpacing.lg) {
            ProgressView()
                .scaleEffect(1.2)
                .tint(MWColors.accentCyan)
            Text(message)
                .font(MWTypography.callout())
                .foregroundColor(MWColors.textTertiary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Reconnect Banner

struct MWReconnectBanner: View {
    let attempt: Int
    var onCancel: (() -> Void)?

    var body: some View {
        HStack(spacing: MWSpacing.sm) {
            ProgressView()
                .scaleEffect(0.75)
                .tint(MWColors.statusWarning)

            VStack(alignment: .leading, spacing: 2) {
                Text("Reconnecting")
                    .font(MWTypography.subheadlineMedium())
                    .foregroundColor(MWColors.statusWarning)
                Text("Attempt \(attempt)")
                    .font(MWTypography.caption2())
                    .foregroundColor(MWColors.textTertiary)
            }

            Spacer()

            Button("Cancel") {
                onCancel?()
            }
            .font(MWTypography.subheadline())
            .foregroundColor(MWColors.textSecondary)
        }
        .padding(.horizontal, MWSpacing.lg)
        .padding(.vertical, MWSpacing.sm)
        .background(
            Rectangle()
                .fill(MWColors.statusWarning.opacity(0.08))
                .overlay(
                    Rectangle()
                        .fill(MWColors.statusWarning.opacity(0.04))
                        .blur(radius: 8)
                )
        )
    }
}
