import SwiftUI

// MARK: - Status Indicator

struct MWStatusIndicator: View {
    let state: ConnectionState

    var color: Color {
        switch state {
        case .connected: return MWColors.statusSuccess
        case .connecting, .reconnecting: return MWColors.statusPending
        case .authFailed, .serverUnavailable: return MWColors.statusError
        default: return MWColors.textTertiary
        }
    }

    var body: some View {
        HStack(spacing: MWSpacing.xs) {
            Circle()
                .fill(color)
                .frame(width: 7, height: 7)
            if state != .disconnected {
                Text(state.displayLabel)
                    .font(MWTypography.caption())
                    .foregroundColor(MWColors.textSecondary)
            }
        }
        .padding(.horizontal, MWSpacing.sm)
        .padding(.vertical, MWSpacing.xs)
        .background(
            Capsule()
                .fill(color.opacity(0.1))
        )
    }
}
