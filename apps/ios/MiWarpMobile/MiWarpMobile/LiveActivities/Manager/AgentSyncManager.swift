#if canImport(ActivityKit)
import ActivityKit
import Foundation

/// Manages agent task lifecycle with Live Activity updates.
/// Wraps any multi-step background task with progress tracking.
@MainActor
final class AgentSyncManager: ObservableObject {
    static let shared = AgentSyncManager()

    @Published var isRunning = false
    @Published var currentStep = 0
    @Published var totalSteps = 0
    @Published var stepTitle = ""
    @Published var phase: AgentPhase = .queued
    @Published var errorMessage: String?

    private let liveActivity = LiveActivityManager.shared
    private var task: Task<Void, Never>?

    private init() {}

    /// Start a multi-step agent task with Live Activity tracking.
    /// - Parameters:
    ///   - title: Task title displayed in the Live Activity
    ///   - workspaceName: Optional workspace name
    ///   - steps: Array of (stepTitle, action) pairs. Each action is called sequentially.
    func startTask(
        title: String,
        workspaceName: String? = nil,
        steps: [(String, () async throws -> Void)]
    ) {
        guard !isRunning else { return }

        isRunning = true
        phase = .queued
        totalSteps = steps.count
        currentStep = 0
        errorMessage = nil

        let taskId = UUID().uuidString.prefix(8).description

        liveActivity.startAgentTask(
            taskId: taskId,
            title: title,
            workspaceName: workspaceName
        )

        task = Task {
            // Brief queued state
            updatePhase(.queued)
            try? await Task.sleep(nanoseconds: 300_000_000)

            for (index, step) in steps.enumerated() {
                if Task.isCancelled { break }

                currentStep = index + 1
                stepTitle = step.0
                updatePhase(.running)
                updateProgress(step: index + 1, total: steps.count, title: step.0)

                do {
                    try await step.1()
                } catch {
                    failTask(error.localizedDescription)
                    return
                }

                // Brief pause between steps
                try? await Task.sleep(nanoseconds: 200_000_000)
            }

            // Complete
            phase = .completed
            stepTitle = "Complete"
            liveActivity.updateAgentTask(
                phase: .completed,
                currentStep: steps.count,
                totalSteps: steps.count,
                stepTitle: "Complete"
            )
            liveActivity.endAgentTask()
            isRunning = false
        }
    }

    func cancelTask() {
        task?.cancel()
        task = nil
        failTask("Cancelled by user")
    }

    private func updatePhase(_ newPhase: AgentPhase) {
        phase = newPhase
        liveActivity.updateAgentTask(
            phase: newPhase,
            currentStep: currentStep,
            totalSteps: totalSteps,
            stepTitle: stepTitle
        )
    }

    private func updateProgress(step: Int, total: Int, title: String) {
        liveActivity.updateAgentTask(
            phase: .running,
            currentStep: step,
            totalSteps: total,
            stepTitle: title
        )
    }

    private func failTask(_ message: String) {
        phase = .failed
        errorMessage = message
        isRunning = false
        liveActivity.updateAgentTask(
            phase: .failed,
            currentStep: currentStep,
            totalSteps: totalSteps,
            stepTitle: stepTitle,
            errorMessage: message
        )
        liveActivity.endAgentTask(dismissAfter: 15)
    }
}
#endif
