#if canImport(ActivityKit)
import ActivityKit
import Foundation

struct AgentTaskAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var phase: AgentPhase
        var currentStep: Int
        var totalSteps: Int
        var stepTitle: String
        var workspaceName: String?
        var startedAt: Date
        var errorMessage: String?

        /// Normalized progress 0.0–1.0
        var progress: Double {
            guard totalSteps > 0 else { return phase == .completed ? 1.0 : 0.05 }
            return Double(currentStep) / Double(totalSteps)
        }
    }

    var taskId: String
    var title: String
}
#endif
