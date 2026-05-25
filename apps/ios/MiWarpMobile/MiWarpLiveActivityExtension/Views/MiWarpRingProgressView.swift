import SwiftUI
import WidgetKit

/// A circular progress ring with MiWarp brand gradient.
/// Uses TimelineView for widget-compatible animations.
struct MiWarpRingProgressView: View {
    let progress: Double
    let phase: RingPhase
    var size: CGFloat = 40
    var lineWidth: CGFloat = 3.5

    enum RingPhase {
        case preparing    // Low pulse
        case connecting   // Scanning animation
        case syncing      // Real progress
        case waiting      // Slow breathing
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
        TimelineView(.animation(minimumInterval: 1.0 / 30.0)) { timeline in
            let time = timeline.date.timeIntervalSinceReferenceDate
            ringContent(time: time)
        }
        .frame(width: size, height: size)
    }

    @ViewBuilder
    private func ringContent(time: Double) -> some View {
        ZStack {
            // Track
            Circle()
                .stroke(trackColor, lineWidth: lineWidth)

            // Progress arc
            Circle()
                .trim(from: 0, to: animatedProgress(time: time))
                .stroke(
                    ringColor,
                    style: StrokeStyle(lineWidth: lineWidth, lineCap: .round)
                )
                .rotationEffect(animatedRotation(time: time))
                .opacity(phase == .failed ? 0.4 : 1.0)
                .scaleEffect(animatedScale(time: time))

            // Phase-specific overlay
            switch phase {
            case .completed:
                Image(systemName: "checkmark")
                    .font(.system(size: size * 0.3, weight: .bold))
                    .foregroundColor(Color(hex: 0x41D6A2))
                    .scaleEffect(completedPopScale(time: time))
            case .failed:
                Image(systemName: "exclamationmark")
                    .font(.system(size: size * 0.28, weight: .bold))
                    .foregroundColor(Color(hex: 0xFF5A72))
            default:
                EmptyView()
            }
        }
    }

    // MARK: - Animation Helpers

    /// Animated progress value
    private func animatedProgress(time: Double) -> Double {
        switch phase {
        case .preparing:
            // Pulse between 0.03 and 0.08
            return 0.05 + 0.03 * sin(time * 2.0)
        case .connecting:
            // Scanning: rotating partial arc
            return 0.25 + 0.05 * sin(time * 1.5)
        case .waiting:
            // Slow breathing
            return normalizedProgress + 0.02 * sin(time * 0.8)
        default:
            return normalizedProgress
        }
    }

    /// Rotation effect for scanning/connecting phase
    private func animatedRotation(time: Double) -> Angle {
        switch phase {
        case .connecting:
            return .degrees(time * 60) // Continuous rotation
        default:
            return .degrees(-90) // Fixed start position
        }
    }

    /// Scale effect for breathing
    private func animatedScale(time: Double) -> CGFloat {
        switch phase {
        case .preparing:
            return 1.0 + 0.04 * sin(time * 2.0)
        case .waiting:
            return 1.0 + 0.03 * sin(time * 0.8)
        default:
            return 1.0
        }
    }

    /// Pop scale for completed state
    private func completedPopScale(time: Double) -> CGFloat {
        // Quick pop then settle
        let phase2 = time.truncatingRemainder(dividingBy: 2.0)
        if phase2 < 0.3 {
            return 1.0 + 0.2 * sin(phase2 / 0.3 * .pi)
        }
        return 1.0
    }
}
