import SwiftUI

struct MiWarpIslandDot: View {
    let color: Color

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: 9, height: 9)
    }
}

// MARK: - Sync Compact

struct SyncCompactLeading: View {
    let phase: SyncPhase

    var body: some View {
        MiWarpIslandDot(color: islandColor)
    }

    private var islandColor: Color {
        switch phase {
        case .preparing, .connecting, .syncing, .importing, .exporting:
            return Color(hex: 0xE6397C)
        case .finishing:
            return Color(hex: 0x9F82FD)
        case .completed:
            return Color(hex: 0x41D6A2)
        case .failed:
            return Color(hex: 0xFF5A72)
        }
    }
}

struct SyncCompactTrailing: View {
    let phase: SyncPhase
    let currentCount: Int
    let totalCount: Int

    var body: some View {
        Text(label)
            .font(.system(size: 12, weight: .semibold).monospacedDigit())
            .foregroundColor(.white)
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .contentTransition(.numericText())
    }

    private var label: String {
        switch phase {
        case .completed:
            return "Done"
        case .failed:
            return "Fail"
        default:
            return totalCount > 0 ? "\(currentCount)/\(totalCount)" : "Sync"
        }
    }
}

// MARK: - Agent Compact

struct AgentCompactLeading: View {
    let phase: AgentPhase

    var body: some View {
        MiWarpIslandDot(color: islandColor)
    }

    private var islandColor: Color {
        switch phase {
        case .running:
            return Color(hex: 0xE6397C)
        case .queued, .waiting:
            return Color(hex: 0x9F82FD)
        case .completed:
            return Color(hex: 0x41D6A2)
        case .failed:
            return Color(hex: 0xFF5A72)
        }
    }
}

struct AgentCompactTrailing: View {
    let phase: AgentPhase
    let currentStep: Int
    let totalSteps: Int

    var body: some View {
        Text(label)
            .font(.system(size: 12, weight: .semibold).monospacedDigit())
            .foregroundColor(.white)
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .contentTransition(.numericText())
    }

    private var label: String {
        switch phase {
        case .completed:
            return "Done"
        case .failed:
            return "Fail"
        default:
            return totalSteps > 0 ? "\(currentStep)/\(totalSteps)" : "Run"
        }
    }
}
