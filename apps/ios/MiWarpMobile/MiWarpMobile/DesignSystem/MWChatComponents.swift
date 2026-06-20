import SwiftUI

// MARK: - Session Card (compact高级列表row, pure display)

struct MWSessionCard: View {
    let run: MiWarpRun

    // Status dot color — semantic, using MWColors
    private var statusColor: Color {
        MWColors.color(for: run.status)
    }

    // Glow for running state
    private var statusGlow: Bool {
        run.status == .running
    }

    var body: some View {
        VStack(alignment: .leading, spacing: MWSpacing.nano) {
            // Row 1: status dot + title + time
            HStack(alignment: .top, spacing: MWSpacing.sm) {
                // Status dot — 8pt, with pulse glow for active states
                ZStack {
                    if statusGlow {
                        Circle()
                            .fill(statusColor.opacity(0.25))
                            .frame(width: 14, height: 14)
                            .symbolEffect(.pulse.byLayer, options: .repeating)
                    }
                    Circle()
                        .fill(statusColor)
                        .frame(width: 8, height: 8)
                }
                .frame(width: 14, height: 14)

                // Title — semibold, 2 lines max
                Text(run.displayTitle)
                    .font(MWTypography.bodyMedium())
                    .foregroundColor(MWColors.textPrimary)
                    .lineLimit(2)
                    .frame(maxWidth: .infinity, alignment: .leading)

                // Time — right aligned, muted
                if let time = run.displayRelativeTime {
                    Text(time)
                        .font(MWTypography.footnote())
                        .foregroundColor(MWColors.textTertiary)
                        .frame(alignment: .trailing)
                }
            }

            // Row 2: agent · model
            Text(run.displayAgentModel)
                .font(MWTypography.footnote())
                .foregroundColor(MWColors.textTertiary)
                .lineLimit(1)

            // Row 3: cwd · message count (only if metadata exists)
            if run.hasMetadata {
                HStack(spacing: MWSpacing.sm) {
                    if let cwd = run.displayCwd {
                        Text(cwd)
                            .font(MWTypography.monoSmall())
                            .foregroundColor(MWColors.textTertiary.opacity(0.7))
                            .lineLimit(1)
                    }
                    if run.displayCwd != nil, run.displayMessageCount != nil {
                        Text("·")
                            .foregroundColor(MWColors.textTertiary.opacity(0.5))
                    }
                    if let msgs = run.displayMessageCount {
                        Text(msgs)
                            .font(MWTypography.caption())
                            .foregroundColor(MWColors.textTertiary.opacity(0.7))
                            .lineLimit(1)
                    }
                }
            }
        }
        .padding(.vertical, MWSpacing.sm)
        .contentShape(Rectangle())
    }
}

// MARK: - Chat Bubble

struct MWChatBubble: View {
    @EnvironmentObject private var theme: MWTheme
    let role: String
    let content: String
    var isStreaming: Bool = false

    var isUser: Bool { role == "user" }

    var body: some View {
        HStack {
            if isUser { Spacer(minLength: 48) }

            VStack(alignment: isUser ? .trailing : .leading, spacing: MWSpacing.xs) {
                Text(content)
                    .font(MWTypography.body())
                    .foregroundColor(isUser ? theme.accentOnAccent : theme.cardTextPrimary)
                    .textSelection(.enabled)

                if isStreaming {
                    HStack(spacing: MWSpacing.xs) {
                        ProgressView()
                            .scaleEffect(0.6)
                            .tint(MWColors.accentCyan)
                        Text(String(localized: "chat.streaming"))
                            .font(MWTypography.caption2())
                            .foregroundColor(theme.cardTextTertiary)
                    }
                }
            }
            .padding(.horizontal, MWSpacing.lg)
            .padding(.vertical, MWSpacing.md)
            .background(
                RoundedRectangle(cornerRadius: isUser ? MWRadius.xl : MWRadius.lg)
                    .fill(isUser ? theme.accentPrimary : theme.bgSurface)
            )
            .overlay(
                RoundedRectangle(cornerRadius: isUser ? MWRadius.xl : MWRadius.lg)
                    .strokeBorder(
                        isUser ? Color.clear : theme.divider,
                        lineWidth: 0.5
                    )
            )

            if !isUser { Spacer(minLength: 48) }
        }
    }
}

// MARK: - Tool Call Card

struct MWToolCallCard: View {
    @EnvironmentObject private var theme: MWTheme
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
        if isError { return theme.statusError }
        if isComplete { return theme.statusDone }
        return theme.accentCyan
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
                        .font(MWTypography.footnote())
                        .foregroundColor(statusColor)

                    Text(toolName)
                        .font(MWTypography.monoCaption())
                        .foregroundColor(theme.accentCyan)

                    Spacer()

                    if !isComplete && !isError {
                        ProgressView()
                            .scaleEffect(0.6)
                            .tint(theme.accentCyan)
                    }

                    Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                        .font(MWTypography.caption2())
                        .foregroundColor(theme.cardTextTertiary)
                }
            }
            .buttonStyle(.plain)

            if isExpanded {
                if let input = inputPreview, !input.isEmpty {
                    VStack(alignment: .leading, spacing: MWSpacing.xs) {
                        Text(String(localized: "chat.toolInput"))
                            .font(MWTypography.caption2())
                            .foregroundColor(theme.cardTextTertiary)
                        Text(input)
                            .font(MWTypography.monoSmall())
                            .foregroundColor(theme.cardTextSecondary)
                            .textSelection(.enabled)
                    }
                }

                if let output = output, !output.isEmpty {
                    VStack(alignment: .leading, spacing: MWSpacing.xs) {
                        Text(String(localized: "chat.toolOutput"))
                            .font(MWTypography.caption2())
                            .foregroundColor(theme.cardTextTertiary)
                        Text(output)
                            .font(MWTypography.monoSmall())
                            .foregroundColor(isError ? theme.statusError : theme.cardTextSecondary)
                            .lineLimit(15)
                            .textSelection(.enabled)
                    }
                }
            }
        }
        .padding(MWSpacing.md)
        .background(
            RoundedRectangle(cornerRadius: MWRadius.md)
                .fill(theme.bgSurface)
                .overlay(
                    RoundedRectangle(cornerRadius: MWRadius.md)
                        .strokeBorder(
                            isError ? theme.statusError.opacity(0.2) : theme.accentCyan.opacity(0.15),
                            lineWidth: 0.5
                        )
                )
        )
    }
}

// MARK: - Approval Card

struct MWApprovalCard: View {
    @EnvironmentObject private var theme: MWTheme
    let requestId: String
    let toolName: String
    let description: String?
    var onApprove: ((Bool) -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: MWSpacing.md) {
            // Header
            HStack(spacing: MWSpacing.sm) {
                Image(systemName: "exclamationmark.shield.fill")
                    .font(MWTypography.title3())
                    .foregroundColor(theme.statusWarning)

                Text(String(localized: "chat.permissionRequired"))
                    .font(MWTypography.bodyMedium())
                    .foregroundColor(theme.statusWarning)

                Spacer()
            }

            // Tool name
            HStack(spacing: MWSpacing.xs) {
                Image(systemName: "wrench.and.screwdriver")
                    .font(.caption2)
                    .foregroundColor(theme.cardTextTertiary)
                Text(toolName)
                    .font(MWTypography.monoCaption())
                    .foregroundColor(theme.accentCyan)
            }

            // Description
            if let desc = description, !desc.isEmpty {
                Text(desc)
                    .font(MWTypography.callout())
                    .foregroundColor(theme.cardTextSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            // Action buttons
            HStack(spacing: MWSpacing.md) {
                Button {
                    onApprove?(false)
                } label: {
                    Label(String(localized: "action.deny"), systemImage: "xmark")
                        .font(MWTypography.subheadlineMedium())
                        .foregroundColor(theme.cardTextSecondary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, MWSpacing.sm)
                        .background(
                            RoundedRectangle(cornerRadius: MWRadius.md)
                                .fill(theme.bgSurface)
                        )
                }

                Button {
                    onApprove?(true)
                } label: {
                    Label(String(localized: "action.allow"), systemImage: "checkmark")
                        .font(MWTypography.subheadlineMedium())
                        .foregroundColor(theme.accentOnAccent)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, MWSpacing.sm)
                        .background(
                            RoundedRectangle(cornerRadius: MWRadius.md)
                                .fill(theme.accentPrimary)
                        )
                }
            }
        }
        .padding(MWSpacing.lg)
        .background(
            RoundedRectangle(cornerRadius: MWRadius.lg)
                .fill(theme.bgSurface)
                .overlay(
                    RoundedRectangle(cornerRadius: MWRadius.lg)
                        .strokeBorder(theme.statusApproval.opacity(0.25), lineWidth: 1)
                )
                .shadow(color: theme.glowApproval, radius: 12, x: 0, y: 0)
        )
    }
}
