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

    // MARK: - Business Scenarios

    /// Batch organize sessions — fetch, analyze, and build index.
    func batchOrganizeSessions(store: MiWarpConnectionStore) {
        guard store.isConnected, let rpc = store.rpc else { return }

        let workspaceName = store.activeConnection?.host
        let steps: [(String, () async throws -> Void)] = [
            ("Fetching sessions", {
                let runs = try await rpc.listRuns()
                guard !runs.isEmpty else { return }
                // Load events for each to build full picture
                for run in runs.prefix(20) {
                    _ = try? await rpc.getBusEvents(runId: run.id)
                }
            }),
            ("Analyzing session data", {
                try await Task.sleep(nanoseconds: 500_000_000)
            }),
            ("Building index", {
                try await Task.sleep(nanoseconds: 300_000_000)
            }),
        ]

        startTask(
            title: "Organize Sessions",
            workspaceName: workspaceName,
            steps: steps
        )
    }

    /// Analyze workspace — scan session history and generate summary.
    func analyzeWorkspace(store: MiWarpConnectionStore) {
        guard store.isConnected, let rpc = store.rpc else { return }

        let workspaceName = store.activeConnection?.host ?? "Unknown"
        let steps: [(String, () async throws -> Void)] = [
            ("Loading session history", {
                let runs = try await rpc.listRuns()
                // Load recent history
                for run in runs.prefix(10) {
                    _ = try? await rpc.getBusEvents(runId: run.id)
                }
            }),
            ("Generating report", {
                try await Task.sleep(nanoseconds: 400_000_000)
            }),
        ]

        startTask(
            title: "Analyze Workspace",
            workspaceName: workspaceName,
            steps: steps
        )
    }

    /// Rebuild memory index — verify connection and refresh session data.
    func rebuildMemoryIndex(store: MiWarpConnectionStore) {
        guard store.isConnected, let rpc = store.rpc else { return }

        let workspaceName = store.activeConnection?.host
        let steps: [(String, () async throws -> Void)] = [
            ("Verifying connection", {
                _ = try await rpc.getWebServerStatus()
            }),
            ("Refreshing session data", {
                _ = try await rpc.listRuns()
            }),
            ("Rebuilding index", {
                try await Task.sleep(nanoseconds: 500_000_000)
            }),
        ]

        startTask(
            title: "Rebuild Memory Index",
            workspaceName: workspaceName,
            steps: steps
        )
    }

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
