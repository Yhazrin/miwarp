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

    /// Pre-rendered tile image — path computation happens once, not every frame.
    @State private var cachedImage: CGImage?
    @State private var cachedScheme: ColorScheme?
    @State private var cachedTheme: MWAccentTheme?
    @State private var cachedOpacity: Double?

    private let tileSize: CGFloat = 512  // Covers any iOS screen when tiled

    var body: some View {
        Canvas { context, size in
            guard let cgImage = cachedImage else { return }
            let tile = Image(decorative: cgImage, scale: 1, orientation: .up)
            let cols = Int(ceil(size.width / tileSize)) + 1
            let rows = Int(ceil(size.height / tileSize)) + 1
            for row in 0..<rows {
                for col in 0..<cols {
                    let origin = CGPoint(x: CGFloat(col) * tileSize, y: CGFloat(row) * tileSize)
                    context.draw(tile, at: origin, anchor: .topLeading)
                }
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .onAppear { renderIfNeeded() }
        .onChange(of: theme.accentTheme) { _, _ in invalidateCache() }
        .onChange(of: theme.effectiveColorScheme) { _, _ in invalidateCache() }
        .onChange(of: opacity) { _, _ in invalidateCache() }
    }

    private func invalidateCache() {
        cachedImage = nil
        cachedScheme = nil
        cachedTheme = nil
        cachedOpacity = nil
    }

    private func renderIfNeeded() {
        guard cachedImage == nil
            || cachedScheme != theme.effectiveColorScheme
            || cachedTheme != theme.accentTheme
            || cachedOpacity != opacity
        else { return }

        cachedScheme = theme.effectiveColorScheme
        cachedTheme = theme.accentTheme
        cachedOpacity = opacity

        cachedImage = renderTile(
            primaryColor: (theme.effectiveColorScheme == .dark ? theme.accentSecondary : theme.accentPrimary).opacity(opacity),
            secondaryColor: theme.textPrimary.opacity(opacity * 0.34)
        )
    }

    private func renderTile(primaryColor: Color, secondaryColor: Color) -> CGImage? {
        let w = Int(tileSize)
        let h = Int(tileSize)
        guard let ctx = CGContext(data: nil, width: w, height: h,
            bitsPerComponent: 8, bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }

        let gridStep: CGFloat = 28
        let angleOffset = gridStep * 0.58
        let hFloat = CGFloat(h)
        let wFloat = CGFloat(w)

        // Diagonal grid lines
        var gridPath = Path()
        var x: CGFloat = -hFloat
        while x < wFloat + hFloat {
            gridPath.move(to: CGPoint(x: x, y: 0))
            gridPath.addLine(to: CGPoint(x: x + hFloat * 0.58, y: hFloat))
            x += gridStep
        }
        x = -hFloat
        while x < wFloat + hFloat {
            gridPath.move(to: CGPoint(x: x + angleOffset, y: 0))
            gridPath.addLine(to: CGPoint(x: x - hFloat * 0.58 + angleOffset, y: hFloat))
            x += gridStep
        }

        // Horizontal lines
        var horizPath = Path()
        var y: CGFloat = gridStep
        while y < hFloat {
            horizPath.move(to: CGPoint(x: 0, y: y))
            horizPath.addLine(to: CGPoint(x: wFloat, y: y))
            y += gridStep * 1.72
        }

        // Maze pattern
        var mazePath = Path()
        let cell = gridStep * 1.5
        var row: CGFloat = 0
        while row < hFloat + cell {
            var col: CGFloat = 0
            while col < wFloat + cell {
                mazePath.move(to: CGPoint(x: col, y: row))
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

        // Three separate stroke passes via CGContext (batched per color)
        ctx.setStrokeColor(secondaryColor.cgColor!)
        ctx.setLineWidth(0.45)
        ctx.addPath(gridPath.cgPath)
        ctx.strokePath()

        ctx.setLineWidth(0.35)
        ctx.addPath(horizPath.cgPath)
        ctx.strokePath()

        ctx.setStrokeColor(primaryColor.cgColor!)
        ctx.setLineWidth(1.0)
        ctx.addPath(mazePath.cgPath)
        ctx.strokePath()

        return ctx.makeImage()
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
        VStack(alignment: .leading, spacing: 3) {
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
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(MWColors.textPrimary)
                    .lineLimit(2)
                    .frame(maxWidth: .infinity, alignment: .leading)

                // Time — right aligned, muted
                if let time = run.displayRelativeTime {
                    Text(time)
                        .font(.system(size: 12))
                        .foregroundColor(MWColors.textTertiary)
                        .frame(alignment: .trailing)
                }
            }

            // Row 2: agent · model
            Text(run.displayAgentModel)
                .font(.system(size: 12))
                .foregroundColor(MWColors.textTertiary)
                .lineLimit(1)

            // Row 3: cwd · message count (only if metadata exists)
            if run.hasMetadata {
                HStack(spacing: MWSpacing.sm) {
                    if let cwd = run.displayCwd {
                        Text(cwd)
                            .font(.system(size: 11).monospaced())
                            .foregroundColor(MWColors.textTertiary.opacity(0.7))
                            .lineLimit(1)
                    }
                    if run.displayCwd != nil, run.displayMessageCount != nil {
                        Text("·")
                            .foregroundColor(MWColors.textTertiary.opacity(0.5))
                    }
                    if let msgs = run.displayMessageCount {
                        Text(msgs)
                            .font(.system(size: 11))
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
                        Text("streaming")
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
                        .font(.system(size: 12))
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
                        Text("Input")
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
                        Text("Output")
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
                    .font(.system(size: 16))
                    .foregroundColor(theme.statusWarning)

                Text("Permission Required")
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
                    Label("Deny", systemImage: "xmark")
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
                    Label("Allow", systemImage: "checkmark")
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

// MARK: - Input Bar

struct MWInputBar: View {
    @EnvironmentObject private var theme: MWTheme
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
                        .fill(theme.inputBg)
                        .overlay(
                            RoundedRectangle(cornerRadius: MWRadius.xl)
                                .strokeBorder(
                                    isFocused ? theme.accentCyan.opacity(0.3) : theme.divider,
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
                        .foregroundColor(theme.statusError)
                }

                // Fork button
                Button {
                    onFork?()
                } label: {
                    Image(systemName: "arrow.branch")
                        .font(.system(size: 20))
                        .foregroundColor(theme.accentCyan)
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
                                ? theme.cardTextTertiary
                                : theme.accentPrimary
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
                .background(theme.glassBg)
                .overlay(
                    Rectangle()
                        .strokeBorder(theme.divider, lineWidth: 0.5)
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
    @EnvironmentObject private var theme: MWTheme

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
                    MWGeometricPattern(opacityOverride: min(theme.textureOpacity, 0.10))
                        .blendMode(.screen)
                )
        )
    }
}

// MARK: - View Size Reader

struct SizePreferenceKey: PreferenceKey {
    static var defaultValue: CGSize = .zero
    static func reduce(value: inout CGSize, nextValue: () -> CGSize) {
        value = nextValue()
    }
}

extension View {
    func readSize(_ onChange: @escaping (CGSize) -> Void) -> some View {
        background(
            GeometryReader { geometry in
                Color.clear
                    .preference(key: SizePreferenceKey.self, value: geometry.size)
            }
        )
        .onPreferenceChange(SizePreferenceKey.self) { size in
            onChange(size)
        }
    }
}

// MARK: - Task Progress Ring

/// A circular progress ring with MiWarp brand styling.
/// Supports progress tracking with completed checkmark and failed warning states.
struct MWTaskProgressRing: View {
    let progress: Double
    let state: RingState
    var size: CGFloat = 40
    var lineWidth: CGFloat = 4

    enum RingState {
        case running
        case waiting
        case completed
        case failed
    }

    private var normalizedProgress: Double {
        switch state {
        case .running, .waiting: return min(max(progress, 0.02), 1.0)
        case .completed: return 1.0
        case .failed: return progress
        }
    }

    private var ringColor: Color {
        switch state {
        case .running: return MWColors.statusRunning
        case .waiting: return MWColors.statusWarning
        case .completed: return MWColors.statusSuccess
        case .failed: return MWColors.statusError
        }
    }

    private var trackColor: Color {
        switch state {
        case .failed: return MWColors.statusError.opacity(0.15)
        default: return MWColors.divider
        }
    }

    var body: some View {
        ZStack {
            Circle()
                .stroke(trackColor, lineWidth: lineWidth)

            Circle()
                .trim(from: 0, to: normalizedProgress)
                .stroke(
                    ringColor,
                    style: StrokeStyle(lineWidth: lineWidth, lineCap: .round)
                )
                .rotationEffect(.degrees(-90))
                .opacity(state == .failed ? 0.5 : 1.0)
                .animation(.spring(duration: 0.6, bounce: 0.2), value: normalizedProgress)

            stateIcon
                .transition(.scale(scale: 0.5).combined(with: .opacity))
        }
        .frame(width: size, height: size)
        .animation(.spring(duration: 0.4, bounce: 0.3), value: state)
    }

    @ViewBuilder
    private var stateIcon: some View {
        switch state {
        case .completed:
            Image(systemName: "checkmark")
                .font(.system(size: size * 0.35, weight: .bold))
                .foregroundColor(MWColors.statusSuccess)
        case .failed:
            Image(systemName: "exclamationmark")
                .font(.system(size: size * 0.3, weight: .bold))
                .foregroundColor(MWColors.statusError)
        default:
            EmptyView()
        }
    }
}

// MARK: - Thinking Indicator

/// Animated three-dot bouncing indicator for chat typing/thinking states.
/// Respects Reduce Motion accessibility setting.
struct MWThinkingIndicator: View {
    var size: IndicatorSize = .medium

    enum IndicatorSize {
        case small
        case medium

        var dotSize: CGFloat {
            switch self {
            case .small: return 4
            case .medium: return 6
            }
        }

        var spacing: CGFloat {
            switch self {
            case .small: return 2
            case .medium: return 3
            }
        }
    }

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.periodic(from: .now, by: 0.35)) { timeline in
            let phase = Int(timeline.date.timeIntervalSinceReferenceDate / 0.35) % 3
            HStack(spacing: size.spacing) {
                ForEach(0..<3, id: \.self) { index in
                    Circle()
                        .fill(MWColors.textTertiary)
                        .frame(width: size.dotSize, height: size.dotSize)
                        .offset(y: !reduceMotion && phase == index ? -(size.dotSize * 0.5) : 0)
                        .animation(
                            reduceMotion ? .none : .easeInOut(duration: 0.2),
                            value: phase
                        )
                }
            }
        }
    }
}

// MARK: - Status Badge

/// Capsule-shaped status badge with semantic colors for workflow states.
struct MWStatusBadge: View {
    let text: String
    let style: BadgeStyle

    @MainActor
    enum BadgeStyle {
        case info
        case success
        case warning
        case error
        case neutral

        var tint: Color {
            switch self {
            case .info: return MWColors.accentPrimary
            case .success: return MWColors.statusSuccess
            case .warning: return MWColors.statusWarning
            case .error: return MWColors.statusError
            case .neutral: return MWColors.textTertiary
            }
        }
    }

    init(text: String, style: BadgeStyle) {
        self.text = text
        self.style = style
    }

    /// Convenience initializer from RunStatus
    init(status: RunStatus) {
        self.text = status.displayLabel
        self.style = Self.badgeStyle(for: status)
    }

    /// Convenience initializer from ConnectionState
    init(connectionState: ConnectionState) {
        self.text = connectionState.displayLabel
        self.style = Self.badgeStyle(for: connectionState)
    }

    private static func badgeStyle(for status: RunStatus) -> BadgeStyle {
        switch status {
        case .running: return .info
        case .pending, .idle: return .neutral
        case .waitingApproval: return .warning
        case .completed: return .success
        case .failed, .stopped: return .error
        }
    }

    private static func badgeStyle(for state: ConnectionState) -> BadgeStyle {
        switch state {
        case .connected: return .success
        case .connecting, .authenticating, .reconnecting: return .info
        case .disconnected, .authFailed, .serverUnavailable: return .error
        }
    }

    var body: some View {
        Text(text)
            .font(.caption)
            .fontWeight(.medium)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .foregroundStyle(style.tint)
            .background(
                Capsule().fill(style.tint.opacity(0.12))
            )
            .overlay(
                Capsule().stroke(style.tint.opacity(0.2), lineWidth: 0.5)
            )
    }
}

// MARK: - Status Dot

/// Small circular status indicator for use in list rows.
struct MWStatusDot: View {
    let status: DotStatus
    var showGlow: Bool = false

    @MainActor
    enum DotStatus {
        case connected
        case disconnected
        case syncing
        case running
        case waiting
        case completed
        case failed
        case localOnly

        var color: Color {
            switch self {
            case .connected: return MWColors.statusSuccess
            case .disconnected: return MWColors.statusError
            case .syncing: return MWColors.accentCyan
            case .running: return MWColors.statusRunning
            case .waiting: return MWColors.statusWarning
            case .completed: return MWColors.textTertiary
            case .failed: return MWColors.statusError
            case .localOnly: return MWColors.statusWarning
            }
        }
    }

    init(status: DotStatus, showGlow: Bool = false) {
        self.status = status
        self.showGlow = showGlow
    }

    private var isAnimating: Bool {
        status == .running || status == .syncing
    }

    var body: some View {
        ZStack {
            if isAnimating {
                Circle()
                    .fill(status.color.opacity(0.25))
                    .frame(width: 14, height: 14)
                    .symbolEffect(.pulse.byLayer, options: .repeating)
            }
            Circle()
                .fill(status.color)
                .frame(width: 8, height: 8)
        }
        .frame(width: 14, height: 14)
        .shadow(
            color: showGlow ? status.color.opacity(0.5) : .clear,
            radius: showGlow ? 4 : 0
        )
    }
}
