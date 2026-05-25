import SwiftUI
import WidgetKit

/// A circular progress ring with MiWarp brand gradient.
/// Static by default so compact Live Activity regions stay glanceable.
struct MiWarpRingProgressView: View {
    let progress: Double
    let phase: RingPhase
    var size: CGFloat = 40
    var lineWidth: CGFloat = 3.5

    enum RingPhase {
        case preparing    // Low initial progress
        case connecting   // Partial connection progress
        case syncing      // Real progress
        case waiting      // Held progress
        case completed    // Full ring + check
        case failed       // Dim ring
    }

    private var normalizedProgress: Double {
        switch phase {
        case .preparing: return 0.05
        case .connecting: return 0.3
        case .syncing: return min(max(progress, 0.02), 1.0)
        case .waiting: return progress
        case .completed: return 1.0
        case .failed: return progress
        }
    }

    private var ringColor: LinearGradient {
        LinearGradient(
            colors: [Color(hex: 0xE6397C), Color(hex: 0x9F82FD)],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }

    private var trackColor: Color {
        Color.white.opacity(0.12)
    }

    var body: some View {
        ringContent
        .frame(width: size, height: size)
    }

    @ViewBuilder
    private var ringContent: some View {
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
                .opacity(phase == .failed ? 0.4 : 1.0)

            switch phase {
            case .completed:
                Image(systemName: "checkmark")
                    .font(.system(size: size * 0.3, weight: .bold))
                    .foregroundColor(Color(hex: 0x41D6A2))
            case .failed:
                Image(systemName: "exclamationmark")
                    .font(.system(size: size * 0.28, weight: .bold))
                    .foregroundColor(Color(hex: 0xFF5A72))
            default:
                EmptyView()
            }
        }
    }
}
