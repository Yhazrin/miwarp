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
        case .preparing: return String(localized: "syncPhase.preparing")
        case .connecting: return String(localized: "syncPhase.connecting")
        case .syncing: return String(localized: "syncPhase.syncing")
        case .importing: return String(localized: "syncPhase.importing")
        case .exporting: return String(localized: "syncPhase.exporting")
        case .finishing: return String(localized: "syncPhase.finishing")
        case .completed: return String(localized: "syncPhase.completed")
        case .failed: return String(localized: "syncPhase.failed")
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
        case .queued: return String(localized: "agentPhase.queued")
        case .running: return String(localized: "agentPhase.running")
        case .waiting: return String(localized: "agentPhase.waiting")
        case .completed: return String(localized: "agentPhase.completed")
        case .failed: return String(localized: "agentPhase.failed")
        }
    }

    var isActive: Bool {
        switch self {
        case .completed, .failed: return false
        default: return true
        }
    }
}
