import SwiftUI

// MARK: - Glass Card

struct MWGlassCard<Content: View>: View {
    let content: Content
    var cornerRadius: CGFloat = MWRadius.lg

    init(cornerRadius: CGFloat = MWRadius.lg, @ViewBuilder content: () -> Content) {
        self.cornerRadius = cornerRadius
        self.content = content()
    }

    var body: some View {
        content
            .padding(MWSpacing.lg)
            .background(
                RoundedRectangle(cornerRadius: cornerRadius)
                    .fill(MWColors.glassBg)
                    .overlay(
                        RoundedRectangle(cornerRadius: cornerRadius)
                            .strokeBorder(MWColors.glassBorder, lineWidth: 1)
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

    var body: some View {
        Button {
            onTap?()
        } label: {
            VStack(alignment: .leading, spacing: MWSpacing.sm) {
                HStack {
                    Text(run.displayTitle)
                        .font(MWTypography.bodyMedium())
                        .foregroundColor(MWColors.textPrimary)
                        .lineLimit(1)
                    Spacer()
                    MWStatusPill(status: run.status)
                }

                HStack(spacing: MWSpacing.md) {
                    Label(run.agent, systemImage: "cpu")
                    Label(run.shortCwd, systemImage: "folder")
                    Label(run.model, systemImage: "cube")
                }
                .font(MWTypography.caption())
                .foregroundColor(MWColors.textSecondary)

                HStack {
                    Label("\(run.messageCount) messages", systemImage: "message")
                    Spacer()
                    if let lastActivity = run.lastActivity {
                        Text(lastActivity.formatted(.relative(presentation: .named)))
                    }
                }
                .font(MWTypography.caption2())
                .foregroundColor(MWColors.textTertiary)
            }
            .padding(MWSpacing.lg)
            .background(
                RoundedRectangle(cornerRadius: MWRadius.lg)
                    .fill(MWColors.bgElevated)
                    .overlay(
                        RoundedRectangle(cornerRadius: MWRadius.lg)
                            .strokeBorder(MWColors.glassBorder, lineWidth: 0.5)
                    )
            )
        }
        .buttonStyle(.plain)
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
            if isUser { Spacer(minLength: 60) }

            VStack(alignment: isUser ? .trailing : .leading, spacing: MWSpacing.xs) {
                Text(content)
                    .font(MWTypography.body())
                    .foregroundColor(isUser ? .white : MWColors.textPrimary)
                    .textSelection(.enabled)

                if isStreaming {
                    ProgressView()
                        .scaleEffect(0.7)
                        .tint(MWColors.accentPrimary)
                }
            }
            .padding(.horizontal, MWSpacing.lg)
            .padding(.vertical, MWSpacing.md)
            .background(
                RoundedRectangle(cornerRadius: MWRadius.xl)
                    .fill(isUser ? MWColors.accentPrimary : MWColors.bgSurface)
            )

            if !isUser { Spacer(minLength: 60) }
        }
    }
}

// MARK: - Tool Call Card

struct MWToolCallCard: View {
    let toolName: String
    let inputPreview: String?
    let output: String?
    let isExpanded: Bool
    var onToggle: (() -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: MWSpacing.sm) {
            Button {
                withAnimation(MWMotion.standardEasing.curve) {
                    onToggle?()
                }
            } label: {
                HStack {
                    Image(systemName: "wrench.and.screwdriver")
                        .foregroundColor(MWColors.accentCyan)
                    Text(toolName)
                        .font(MWTypography.monoCaption())
                        .foregroundColor(MWColors.accentCyan)
                    Spacer()
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
                            .foregroundColor(MWColors.textSecondary)
                            .lineLimit(10)
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
                        .strokeBorder(MWColors.accentCyan.opacity(0.2), lineWidth: 0.5)
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
            HStack {
                Image(systemName: "exclamationmark.shield.fill")
                    .foregroundColor(MWColors.statusWarning)
                Text("Permission Required")
                    .font(MWTypography.bodyMedium())
                    .foregroundColor(MWColors.statusWarning)
            }

            Text(toolName)
                .font(MWTypography.monoCaption())
                .foregroundColor(MWColors.textPrimary)

            if let desc = description {
                Text(desc)
                    .font(MWTypography.callout())
                    .foregroundColor(MWColors.textSecondary)
            }

            HStack(spacing: MWSpacing.md) {
                Button {
                    onApprove?(false)
                } label: {
                    Text("Deny")
                        .font(MWTypography.bodyMedium())
                        .foregroundColor(MWColors.statusError)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, MWSpacing.sm)
                        .background(
                            RoundedRectangle(cornerRadius: MWRadius.md)
                                .strokeBorder(MWColors.statusError, lineWidth: 1)
                        )
                }

                Button {
                    onApprove?(true)
                } label: {
                    Text("Allow")
                        .font(MWTypography.bodyMedium())
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
                        .strokeBorder(MWColors.statusWarning.opacity(0.3), lineWidth: 1)
                )
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
        VStack(spacing: 0) {
            Divider()
                .background(MWColors.glassBorder)

            HStack(alignment: .bottom, spacing: MWSpacing.sm) {
                TextField("Type a message...", text: $text, axis: .vertical)
                    .textFieldStyle(.plain)
                    .font(MWTypography.body())
                    .lineLimit(1...6)
                    .focused($isFocused)
                    .padding(.horizontal, MWSpacing.md)
                    .padding(.vertical, MWSpacing.sm)
                    .background(
                        RoundedRectangle(cornerRadius: MWRadius.lg)
                            .fill(MWColors.bgSurface)
                    )

                if isRunning {
                    Button {
                        onStop?()
                    } label: {
                        Image(systemName: "stop.circle.fill")
                            .font(.system(size: 28))
                            .foregroundColor(MWColors.statusError)
                    }

                    Button {
                        onFork?()
                    } label: {
                        Image(systemName: "arrow.branch")
                            .font(.system(size: 22))
                            .foregroundColor(MWColors.accentCyan)
                    }
                } else {
                    Button {
                        onSend?()
                    } label: {
                        Image(systemName: "arrow.up.circle.fill")
                            .font(.system(size: 28))
                            .foregroundColor(canSend ? MWColors.accentPrimary : MWColors.textTertiary)
                    }
                    .disabled(!canSend || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .padding(.horizontal, MWSpacing.lg)
            .padding(.vertical, MWSpacing.sm)
            .background(MWColors.bgDeep)
        }
    }
}

// MARK: - Empty State

struct MWEmptyState: View {
    let icon: String
    let title: String
    let message: String

    var body: some View {
        VStack(spacing: MWSpacing.lg) {
            Image(systemName: icon)
                .font(.system(size: 48))
                .foregroundColor(MWColors.textTertiary)
            Text(title)
                .font(MWTypography.title3())
                .foregroundColor(MWColors.textPrimary)
            Text(message)
                .font(MWTypography.callout())
                .foregroundColor(MWColors.textSecondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.horizontal, MWSpacing.xxxl)
    }
}

// MARK: - Error State

struct MWErrorState: View {
    let message: String
    var onRetry: (() -> Void)?

    var body: some View {
        VStack(spacing: MWSpacing.lg) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 48))
                .foregroundColor(MWColors.statusError)
            Text("Something went wrong")
                .font(MWTypography.title3())
                .foregroundColor(MWColors.textPrimary)
            Text(message)
                .font(MWTypography.callout())
                .foregroundColor(MWColors.textSecondary)
                .multilineTextAlignment(.center)
            if let onRetry {
                Button("Retry", action: onRetry)
                    .buttonStyle(.bordered)
                    .tint(MWColors.accentPrimary)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.horizontal, MWSpacing.xxxl)
    }
}

// MARK: - Loading State

struct MWLoadingState: View {
    var message: String = "Loading..."

    var body: some View {
        VStack(spacing: MWSpacing.md) {
            ProgressView()
                .tint(MWColors.accentPrimary)
            Text(message)
                .font(MWTypography.callout())
                .foregroundColor(MWColors.textSecondary)
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
                .scaleEffect(0.8)
                .tint(MWColors.statusWarning)
            Text("Reconnecting (attempt \(attempt))...")
                .font(MWTypography.subheadline())
                .foregroundColor(MWColors.statusWarning)
            Spacer()
            Button("Cancel") {
                onCancel?()
            }
            .font(MWTypography.subheadline())
            .foregroundColor(MWColors.textSecondary)
        }
        .padding(.horizontal, MWSpacing.lg)
        .padding(.vertical, MWSpacing.sm)
        .background(MWColors.statusWarning.opacity(0.1))
    }
}
