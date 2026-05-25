import Foundation

/// Represents the mascot's emotional/working state for Live Activity display.
enum MascotState: String, Codable, Hashable {
    case idle
    case connecting
    case syncing
    case thinking
    case success
    case error

    /// Map from SyncPhase to MascotState
    static func from(syncPhase: SyncPhase) -> MascotState {
        switch syncPhase {
        case .preparing: return .idle
        case .connecting: return .connecting
        case .syncing, .importing, .exporting: return .syncing
        case .finishing: return .thinking
        case .completed: return .success
        case .failed: return .error
        }
    }

    /// Map from AgentPhase to MascotState
    static func from(agentPhase: AgentPhase) -> MascotState {
        switch agentPhase {
        case .queued: return .idle
        case .running: return .syncing
        case .waiting: return .thinking
        case .completed: return .success
        case .failed: return .error
        }
    }
}
