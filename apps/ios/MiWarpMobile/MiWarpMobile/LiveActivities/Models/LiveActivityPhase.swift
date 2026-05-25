import Foundation

// MARK: - Sync Phase

enum SyncPhase: String, Codable, Hashable {
    case preparing
    case connecting
    case syncing
    case importing
    case exporting
    case finishing
    case completed
    case failed

    var displayTitle: String {
        switch self {
        case .preparing: return "Preparing"
        case .connecting: return "Connecting"
        case .syncing: return "Syncing"
        case .importing: return "Importing"
        case .exporting: return "Exporting"
        case .finishing: return "Finishing"
        case .completed: return "Completed"
        case .failed: return "Failed"
        }
    }

    var isActive: Bool {
        switch self {
        case .completed, .failed: return false
        default: return true
        }
    }
}

// MARK: - Agent Phase

enum AgentPhase: String, Codable, Hashable {
    case queued
    case running
    case waiting
    case completed
    case failed

    var displayTitle: String {
        switch self {
        case .queued: return "Queued"
        case .running: return "Running"
        case .waiting: return "Waiting"
        case .completed: return "Completed"
        case .failed: return "Failed"
        }
    }

    var isActive: Bool {
        switch self {
        case .completed, .failed: return false
        default: return true
        }
    }
}
