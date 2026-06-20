import SwiftUI

// MARK: - Status Pill

struct MWStatusPill: View {
    let status: RunStatus

    private var statusColor: Color {
        MWColors.pillColor(for: status)
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
                .animation(MWMotion.springGentle, value: normalizedProgress)

            stateIcon
                .transition(.scale(scale: 0.5).combined(with: .opacity))
        }
        .frame(width: size, height: size)
        .animation(MWMotion.springStandard, value: state)
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
            .font(MWTypography.caption())
            .fontWeight(.medium)
            .padding(.horizontal, MWSpacing.sm)
            .padding(.vertical, MWSpacing.nano)
            .foregroundStyle(style.tint)
            .background(
                Capsule().fill(style.tint.opacity(0.12))
            )
            .overlay(
                Capsule().stroke(style.tint.opacity(0.2), lineWidth: 0.5)
            )
            .accessibilityLabel(text)
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
        .accessibilityHidden(true)
    }
}
