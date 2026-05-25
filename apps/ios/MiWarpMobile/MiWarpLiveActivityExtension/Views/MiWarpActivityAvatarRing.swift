import SwiftUI

/// Combined avatar ring component: outer progress ring + center mascot.
struct MiWarpActivityAvatarRing: View {
    let progress: Double
    let ringPhase: MiWarpRingProgressView.RingPhase
    let mascotState: MascotState
    var size: CGFloat = 48
    var lineWidth: CGFloat = 3.5

    var body: some View {
        ZStack {
            MiWarpRingProgressView(
                progress: progress,
                phase: ringPhase,
                size: size,
                lineWidth: lineWidth
            )
            MiWarpMascotStatusView(
                state: mascotState,
                size: size * 0.55
            )
        }
    }
}

/// Compact version for Dynamic Island — smaller, no face details.
struct MiWarpActivityCompactRing: View {
    let progress: Double
    let ringPhase: MiWarpRingProgressView.RingPhase
    var size: CGFloat = 20

    var body: some View {
        MiWarpRingProgressView(
            progress: progress,
            phase: ringPhase,
            size: size,
            lineWidth: 2.5
        )
    }
}
