import SwiftUI

/// Simplified mascot status indicator for Live Activities.
/// Uses geometric shapes and brand colors instead of complex artwork.
struct MiWarpMascotStatusView: View {
    let state: MascotState
    var size: CGFloat = 28

    var body: some View {
        ZStack {
            // Base circle — mascot head
            Circle()
                .fill(mascotGradient)
                .frame(width: size, height: size)

            // Face based on state
            mascotFace
                .frame(width: size * 0.6, height: size * 0.6)
        }
    }

    private var mascotGradient: LinearGradient {
        switch state {
        case .error:
            return LinearGradient(
                colors: [Color(hex: 0xFF5A72), Color(hex: 0xE6397C)],
                startPoint: .top, endPoint: .bottom
            )
        case .success:
            return LinearGradient(
                colors: [Color(hex: 0x41D6A2), Color(hex: 0x22D3EE)],
                startPoint: .top, endPoint: .bottom
            )
        default:
            return LinearGradient(
                colors: [Color(hex: 0xE6397C), Color(hex: 0x9F82FD)],
                startPoint: .top, endPoint: .bottom
            )
        }
    }

    @ViewBuilder
    private var mascotFace: some View {
        switch state {
        case .idle:
            // Calm eyes — two dots
            HStack(spacing: size * 0.15) {
                Circle().fill(.white).frame(width: size * 0.1, height: size * 0.1)
                Circle().fill(.white).frame(width: size * 0.1, height: size * 0.1)
            }
            .offset(y: -size * 0.05)

        case .connecting:
            // Searching — single eye scanning
            Circle()
                .fill(.white)
                .frame(width: size * 0.14, height: size * 0.14)
                .offset(x: size * 0.08)

        case .syncing:
            // Working — focused dots
            HStack(spacing: size * 0.12) {
                Circle().fill(.white).frame(width: size * 0.09, height: size * 0.12)
                Circle().fill(.white).frame(width: size * 0.09, height: size * 0.12)
            }
            .offset(y: -size * 0.03)

        case .thinking:
            // Thinking — dots above head
            HStack(spacing: size * 0.08) {
                Circle().fill(.white.opacity(0.6)).frame(width: size * 0.06, height: size * 0.06)
                Circle().fill(.white.opacity(0.8)).frame(width: size * 0.08, height: size * 0.08)
                Circle().fill(.white).frame(width: size * 0.1, height: size * 0.1)
            }
            .offset(y: -size * 0.2)

        case .success:
            // Happy — curved smile
            VStack(spacing: size * 0.06) {
                HStack(spacing: size * 0.14) {
                    Circle().fill(.white).frame(width: size * 0.09, height: size * 0.09)
                    Circle().fill(.white).frame(width: size * 0.09, height: size * 0.09)
                }
                Circle()
                    .trim(from: 0, to: 0.5)
                    .stroke(.white, style: StrokeStyle(lineWidth: size * 0.05, lineCap: .round))
                    .frame(width: size * 0.2, height: size * 0.1)
                    .rotationEffect(.degrees(180))
            }

        case .error:
            // Confused — X eyes
            HStack(spacing: size * 0.14) {
                Image(systemName: "xmark")
                    .font(.system(size: size * 0.1, weight: .bold))
                    .foregroundColor(.white)
                Image(systemName: "xmark")
                    .font(.system(size: size * 0.1, weight: .bold))
                    .foregroundColor(.white)
            }
            .offset(y: -size * 0.03)
        }
    }
}
