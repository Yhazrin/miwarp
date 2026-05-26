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
        state == .connecting || state == .reconnecting || state == .authenticating
    }

    var body: some View {
        HStack(spacing: 4) {
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
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .contentTransition(.opacity)
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(color.opacity(0.1), in: Capsule())
        .animation(.spring(duration: 0.3, bounce: 0.2), value: state)
    }
}
