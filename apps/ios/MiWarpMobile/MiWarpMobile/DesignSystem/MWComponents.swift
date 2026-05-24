import SwiftUI

// MARK: - Native Glass Surface

private struct MWFallbackGlassSurface: ViewModifier {
    @EnvironmentObject private var theme: MWTheme
    let cornerRadius: CGFloat
    let borderColor: Color?
    let fillColor: Color?

    func body(content: Content) -> some View {
        content
            .background(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(.ultraThinMaterial)
                    .background(
                        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                            .fill(fillColor ?? theme.glassBg)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                            .strokeBorder(borderColor ?? theme.glassBorder, lineWidth: 1)
                    )
            )
    }
}

#if compiler(>=6.2)
@available(iOS 26.0, *)
private struct MWNativeLiquidGlassSurface: ViewModifier {
    @EnvironmentObject private var theme: MWTheme
    let cornerRadius: CGFloat
    let borderColor: Color?
    let fillColor: Color?

    func body(content: Content) -> some View {
        content
            .glassEffect(.regular, in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .background(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(fillColor ?? theme.glassBg)
                    .opacity(0.42)
            )
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .strokeBorder(borderColor ?? theme.glassBorder, lineWidth: 1)
            )
    }
}
#endif

extension View {
    @ViewBuilder
    func mwGlassSurface(
        cornerRadius: CGFloat = MWRadius.lg,
        borderColor: Color? = nil,
        fillColor: Color? = nil
    ) -> some View {
        #if compiler(>=6.2)
        if #available(iOS 26.0, *) {
            modifier(MWNativeLiquidGlassSurface(cornerRadius: cornerRadius, borderColor: borderColor, fillColor: fillColor))
        } else {
            modifier(MWFallbackGlassSurface(cornerRadius: cornerRadius, borderColor: borderColor, fillColor: fillColor))
        }
        #else
        modifier(MWFallbackGlassSurface(cornerRadius: cornerRadius, borderColor: borderColor, fillColor: fillColor))
        #endif
    }
}

// MARK: - Geometric Texture

struct MWGeometricPattern: View {
    @EnvironmentObject private var theme: MWTheme
    var opacityOverride: Double?

    private var opacity: Double {
        opacityOverride ?? theme.textureOpacity
    }

    var body: some View {
        Canvas { context, size in
            guard opacity > 0 else { return }

            let color = theme.effectiveColorScheme == .dark ? theme.accentSecondary : theme.accentPrimary
            let primary = color.opacity(opacity)
            let secondary = theme.textPrimary.opacity(opacity * 0.34)
            let gridStep: CGFloat = 28
            let angleOffset: CGFloat = gridStep * 0.58

            var gridPath = Path()
            var x = -size.height
            while x < size.width + size.height {
                gridPath.move(to: CGPoint(x: x, y: 0))
                gridPath.addLine(to: CGPoint(x: x + size.height * 0.58, y: size.height))
                x += gridStep
            }

            x = -size.height
            while x < size.width + size.height {
                gridPath.move(to: CGPoint(x: x + angleOffset, y: 0))
                gridPath.addLine(to: CGPoint(x: x - size.height * 0.58 + angleOffset, y: size.height))
                x += gridStep
            }

            var horizontal = Path()
            var y: CGFloat = gridStep
            while y < size.height {
                horizontal.move(to: CGPoint(x: 0, y: y))
                horizontal.addLine(to: CGPoint(x: size.width, y: y))
                y += gridStep * 1.72
            }

            var mazePath = Path()
            let cell = gridStep * 1.5
            var row: CGFloat = 0
            while row < size.height + cell {
                var col: CGFloat = 0
                while col < size.width + cell {
                    let start = CGPoint(x: col, y: row)
                    mazePath.move(to: start)
                    mazePath.addLine(to: CGPoint(x: col + cell * 0.62, y: row))
                    mazePath.addLine(to: CGPoint(x: col + cell * 0.62, y: row + cell * 0.38))
                    if Int((col + row) / cell).isMultiple(of: 2) {
                        mazePath.addLine(to: CGPoint(x: col + cell, y: row + cell * 0.38))
                    } else {
                        mazePath.move(to: CGPoint(x: col + cell * 0.18, y: row + cell * 0.72))
                        mazePath.addLine(to: CGPoint(x: col + cell * 0.78, y: row + cell * 0.72))
                    }
                    col += cell
                }
                row += cell
            }

            context.stroke(gridPath, with: .color(secondary), lineWidth: 0.45)
            context.stroke(horizontal, with: .color(secondary.opacity(0.7)), lineWidth: 0.35)
            context.stroke(mazePath, with: .color(primary), lineWidth: 1.0)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

struct MWPatternedBackdrop: View {
    @EnvironmentObject private var theme: MWTheme
    var baseColor: Color?
    var patternOpacity: Double?

    var body: some View {
        ZStack {
            baseColor ?? theme.bgDeepest
            if (patternOpacity ?? theme.textureOpacity) > 0 {
                MWGeometricPattern(opacityOverride: patternOpacity)
                    .blendMode(theme.effectiveColorScheme == .dark ? .screen : .multiply)
            }
        }
        .ignoresSafeArea()
    }
}

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
            .mwGlassSurface(cornerRadius: cornerRadius, borderColor: borderColor)
    }
}

// MARK: - Status Pill

struct MWStatusPill: View {
    let status: RunStatus

    private var statusColor: Color {
        switch status {
        case .running: return MWColors.statusRunning
        case .waitingApproval: return MWColors.statusApproval
        case .failed: return MWColors.statusError
        case .completed: return MWColors.statusSuccess
        case .pending: return MWColors.statusPending
        case .idle: return MWColors.statusIdle
        case .stopped: return MWColors.statusStopped
        }
    }

    var body: some View {
        Text(status.displayLabel)
            .font(MWTypography.caption())
            .foregroundColor(statusColor)
            .padding(.horizontal, MWSpacing.sm)
            .padding(.vertical, 3)
            .background(
                Capsule()
                    .fill(statusColor.opacity(0.12))
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
            VStack(alignment: .leading, spacing: 4) {
                // Row 1: title + status pill
                HStack(alignment: .top, spacing: MWSpacing.sm) {
                    Text(run.displayTitle)
                        .font(MWTypography.bodyMedium())
                        .foregroundColor(MWColors.textPrimary)
                        .lineLimit(2)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    MWStatusPill(status: run.status)
                }

                // Row 2: agent · model
                Text("\(run.agent) · \(run.model)")
                    .font(MWTypography.caption())
                    .foregroundColor(MWColors.textSecondary)
                    .lineLimit(1)

                // Row 3: cwd
                Text(run.shortCwd)
                    .font(MWTypography.monoSmall())
                    .foregroundColor(MWColors.textTertiary)
                    .lineLimit(1)

                    Label("\(run.messageCount ?? 0)", systemImage: "message")
                        .font(MWTypography.caption())
                        .foregroundColor(MWColors.textTertiary)

                    if let lastActivity = run.lastActivity {
                        Text("·")
                            .foregroundColor(MWColors.textTertiary)
                        Text(lastActivity.formatted(.relative(presentation: .named)))
                            .font(MWTypography.caption2())
                            .foregroundColor(MWColors.textTertiary)
                    }
                }

                // Source badge
                HStack(spacing: MWSpacing.sm) {
                    if run.source != .unknown {
                        HStack(spacing: MWSpacing.xs) {
                            Image(systemName: sourceIcon(run.source))
                                .font(MWTypography.caption2())
                            Text(sourceLabel(run.source))
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

                    Spacer()
                }
            }
            .padding(.horizontal, MWSpacing.md)
            .padding(.vertical, MWSpacing.sm)
            .background(
                RoundedRectangle(cornerRadius: MWRadius.md)
                    .fill(MWColors.cardBg)
                    .overlay(
                        RoundedRectangle(cornerRadius: MWRadius.md)
                            .strokeBorder(MWColors.divider.opacity(0.5), lineWidth: 0.5)
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
            if isUser { Spacer(minLength: 48) }

            VStack(alignment: isUser ? .trailing : .leading, spacing: MWSpacing.xs) {
                Text(content)
                    .font(isUser ? MWTypography.body() : MWTypography.body())
                    .foregroundColor(isUser ? MWColors.accentOnAccent : MWColors.textPrimary)
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
                    .fill(isUser ? MWColors.accentPrimary : MWColors.cardBg)
            )
            .overlay(
                RoundedRectangle(cornerRadius: isUser ? MWRadius.xl : MWRadius.lg)
                    .strokeBorder(
                        isUser ? Color.clear : MWColors.divider,
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
                .fill(MWColors.cardBg)
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
                        .foregroundColor(MWColors.accentOnAccent)
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
                .fill(MWColors.cardBg)
                .overlay(
                    RoundedRectangle(cornerRadius: MWRadius.lg)
                        .strokeBorder(MWColors.statusApproval.opacity(0.25), lineWidth: 1)
                )
                .shadow(color: MWColors.glowApproval, radius: 12, x: 0, y: 0)
        )
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
                        .fill(MWColors.inputBg)
                        .overlay(
                            RoundedRectangle(cornerRadius: MWRadius.xl)
                                .strokeBorder(
                                    isFocused ? MWColors.accentCyan.opacity(0.3) : MWColors.divider,
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
                .background(MWColors.glassBg)
                .overlay(
                    Rectangle()
                        .strokeBorder(MWColors.divider, lineWidth: 0.5)
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
                        .foregroundColor(MWColors.accentOnAccent)
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
        .background(MWPatternedBackdrop())
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
                            .foregroundColor(MWColors.accentOnAccent)
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
                                    .strokeBorder(MWColors.divider, lineWidth: 1)
                            )
                    }
                }
            }
            .padding(.top, MWSpacing.sm)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.horizontal, MWSpacing.xxxl)
        .background(MWPatternedBackdrop())
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
                .overlay(
                    MWGeometricPattern(opacityOverride: min(MWTheme.shared.textureOpacity, 0.10))
                        .blendMode(.screen)
                )
        )
    }
}
