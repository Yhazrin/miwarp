import SwiftUI

// MARK: - Sync Compact

struct SyncCompactLeading: View {
    let phase: SyncPhase

    var body: some View {
        MiWarpActivityCompactRing(
            progress: 0,
            ringPhase: ringPhase,
            size: 20
        )
    }

    private var ringPhase: MiWarpRingProgressView.RingPhase {
        switch phase {
        case .preparing: return .preparing
        case .connecting: return .connecting
        case .syncing, .importing, .exporting: return .syncing
        case .finishing: return .waiting
        case .completed: return .completed
        case .failed: return .failed
        }
    }
}

struct SyncCompactTrailing: View {
    let phase: SyncPhase
    let currentCount: Int
    let totalCount: Int

    var body: some View {
        switch phase {
        case .completed:
            Text("Done")
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(Color(hex: 0x41D6A2))
        case .failed:
            Text("Failed")
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(Color(hex: 0xFF5A72))
        default:
            if totalCount > 0 {
                Text("\(currentCount)/\(totalCount)")
                    .font(.system(size: 12, weight: .medium).monospacedDigit())
                    .foregroundColor(.white.opacity(0.85))
            } else {
                Text(phase.displayTitle)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(.white.opacity(0.85))
            }
        }
    }
}

// MARK: - Agent Compact

struct AgentCompactLeading: View {
    let phase: AgentPhase

    var body: some View {
        MiWarpActivityCompactRing(
            progress: 0,
            ringPhase: ringPhase,
            size: 20
        )
    }

    private var ringPhase: MiWarpRingProgressView.RingPhase {
        switch phase {
        case .queued: return .preparing
        case .running: return .syncing
        case .waiting: return .waiting
        case .completed: return .completed
        case .failed: return .failed
        }
    }
}

struct AgentCompactTrailing: View {
    let phase: AgentPhase
    let currentStep: Int
    let totalSteps: Int

    var body: some View {
        switch phase {
        case .completed:
            Text("Done")
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(Color(hex: 0x41D6A2))
        case .failed:
            Text("Failed")
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(Color(hex: 0xFF5A72))
        default:
            if totalSteps > 0 {
                Text("\(currentStep)/\(totalSteps)")
                    .font(.system(size: 12, weight: .medium).monospacedDigit())
                    .foregroundColor(.white.opacity(0.85))
            } else {
                Text(phase.displayTitle)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(.white.opacity(0.85))
            }
        }
    }
}
