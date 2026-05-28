import SwiftUI

// MARK: - Status Indicator

struct MWStatusIndicator: View {
    let state: ConnectionState

    var color: Color {
        switch state {
        case .connected: return MWColors.statusSuccess
        case .connecting, .reconnecting: return MWColors.statusWarning
        case .authenticating: return MWColors.accentPrimary
        case .authFailed, .serverUnavailable: return MWColors.statusError
        case .disconnected: return MWColors.textTertiary
        }
    }

    private var isAnimating: Bool {
        switch state {
        case .connecting, .reconnecting, .authenticating: return true
        default: return false
        }
    }

    var body: some View {
        HStack(spacing: MWSpacing.xs) {
            ZStack {
                if isAnimating {
                    Circle()
                        .fill(color.opacity(0.25))
                        .frame(width: 12, height: 12)
                        .symbolEffect(.pulse.byLayer, options: .repeating)
                }
                Circle()
                    .fill(color)
                    .frame(width: 7, height: 7)
            }
            .frame(width: 12, height: 12)

            if state != .disconnected {
                Text(state.displayLabel)
                    .font(MWTypography.caption())
                    .foregroundStyle(.secondary)
                    .contentTransition(.opacity)
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(color.opacity(0.12), in: Capsule())
        .animation(MWMotion.springQuick, value: state)
    }
}
