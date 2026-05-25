import SwiftUI
import WidgetKit

/// Simplified mascot status indicator for Live Activities.
/// Uses geometric shapes and brand colors. Animated via TimelineView.
struct MiWarpMascotStatusView: View {
    let state: MascotState
    var size: CGFloat = 28

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 20.0)) { timeline in
            let time = timeline.date.timeIntervalSinceReferenceDate
            mascotContent(time: time)
        }
        .frame(width: size, height: size)
    }

    @ViewBuilder
    private func mascotContent(time: Double) -> some View {
        ZStack {
            // Base circle — mascot head
            Circle()
                .fill(mascotGradient)
                .frame(width: size, height: size)
                .scaleEffect(breathingScale(time: time))

            // Face based on state
            mascotFace(time: time)
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

    /// Subtle breathing scale animation
    private func breathingScale(time: Double) -> CGFloat {
        switch state {
        case .idle:
            return 1.0 + 0.03 * sin(time * 1.2)
        case .syncing:
            return 1.0 + 0.02 * sin(time * 2.5) // Faster for working
        case .thinking:
            return 1.0 + 0.04 * sin(time * 0.8) // Slower, deeper
        case .success:
            // One-time pop
            let phase = time.truncatingRemainder(dividingBy: 3.0)
            if phase < 0.4 {
                return 1.0 + 0.15 * sin(phase / 0.4 * .pi)
            }
            return 1.0
        default:
            return 1.0
        }
    }

    @ViewBuilder
    private func mascotFace(time: Double) -> some View {
        switch state {
        case .idle:
            // Calm eyes — two dots with gentle blink
            HStack(spacing: size * 0.15) {
                eyeCircle(time: time, offset: 0)
                eyeCircle(time: time, offset: 0.5)
            }
            .offset(y: -size * 0.05)

        case .connecting:
            // Searching — single eye scanning left-right
            Circle()
                .fill(.white)
                .frame(width: size * 0.14, height: size * 0.14)
                .offset(x: size * 0.1 * sin(time * 2.0))

        case .syncing:
            // Working — focused dots, slight vertical bob
            HStack(spacing: size * 0.12) {
                Circle().fill(.white).frame(width: size * 0.09, height: size * 0.12)
                Circle().fill(.white).frame(width: size * 0.09, height: size * 0.12)
            }
            .offset(y: -size * 0.03 + size * 0.02 * sin(time * 3.0))

        case .thinking:
            // Thinking — three dots pulsing above head
            HStack(spacing: size * 0.06) {
                thinkingDot(time: time, delay: 0)
                thinkingDot(time: time, delay: 0.3)
                thinkingDot(time: time, delay: 0.6)
            }
            .offset(y: -size * 0.22)

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

    /// Animated eye with periodic blink
    private func eyeCircle(time: Double, offset: Double) -> some View {
        let blinkCycle = (time + offset * 4.0).truncatingRemainder(dividingBy: 4.0)
        let isBlinking = blinkCycle > 3.7 && blinkCycle < 3.9
        let eyeHeight = isBlinking ? size * 0.02 : size * 0.1

        return Circle()
            .fill(.white)
            .frame(width: size * 0.1, height: eyeHeight)
    }

    /// Pulsing thinking dot
    private func thinkingDot(time: Double, delay: Double) -> some View {
        let phase = (time + delay).truncatingRemainder(dividingBy: 1.2)
        let opacity = phase < 0.6 ? 0.4 + 0.6 * (phase / 0.6) : 1.0 - 0.6 * ((phase - 0.6) / 0.6)
        let dotSize = size * 0.06 + size * 0.04 * (phase < 0.6 ? phase / 0.6 : (1.2 - phase) / 0.6)

        return Circle()
            .fill(.white.opacity(max(0.3, opacity)))
            .frame(width: dotSize, height: dotSize)
    }
}
