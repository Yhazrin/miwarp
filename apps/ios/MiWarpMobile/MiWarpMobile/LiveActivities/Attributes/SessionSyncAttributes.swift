#if canImport(ActivityKit)
import ActivityKit
import Foundation

struct SessionSyncAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var phase: SyncPhase
        var currentCount: Int
        var totalCount: Int
        var currentItemTitle: String?
        var desktopName: String?
        var startedAt: Date
        var errorMessage: String?

        /// Normalized progress 0.0–1.0
        var progress: Double {
            guard totalCount > 0 else { return phase == .completed ? 1.0 : 0.05 }
            return Double(currentCount) / Double(totalCount)
        }
    }

    var taskId: String
    var workspaceName: String?
}
#endif
