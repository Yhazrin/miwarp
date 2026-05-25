#if canImport(ActivityKit)
import ActivityKit
import Foundation
import os.log

@MainActor
final class LiveActivityManager {
    static let shared = LiveActivityManager()

    private let logger = Logger(subsystem: "com.miwarp.mobile", category: "LiveActivity")

    /// Currently active sync activity
    private var syncActivity: Activity<SessionSyncAttributes>?

    /// Currently active agent activity
    private var agentActivity: Activity<AgentTaskAttributes>?

    private init() {}

    // MARK: - Session Sync

    func startSessionSync(
        taskId: String,
        workspaceName: String? = nil,
        desktopName: String? = nil
    ) {
        endSessionSync()

        let attrs = SessionSyncAttributes(taskId: taskId, workspaceName: workspaceName)
        let state = SessionSyncAttributes.ContentState(
            phase: .preparing,
            currentCount: 0,
            totalCount: 0,
            currentItemTitle: nil,
            desktopName: desktopName,
            startedAt: Date()
        )

        do {
            syncActivity = try Activity<SessionSyncAttributes>.request(
                attributes: attrs,
                content: .init(state: state, staleDate: nil),
                pushType: nil
            )
            logger.info("Started sync activity: \(taskId)")
        } catch {
            logger.error("Failed to start sync activity: \(error.localizedDescription)")
        }
    }

    func updateSessionSync(
        phase: SyncPhase,
        currentCount: Int,
        totalCount: Int,
        currentItemTitle: String? = nil,
        desktopName: String? = nil,
        errorMessage: String? = nil
    ) {
        guard let activity = syncActivity else { return }

        let state = SessionSyncAttributes.ContentState(
            phase: phase,
            currentCount: currentCount,
            totalCount: totalCount,
            currentItemTitle: currentItemTitle,
            desktopName: desktopName,
            startedAt: activity.content.state.startedAt,
            errorMessage: errorMessage
        )

        Task {
            await activity.update(.init(state: state, staleDate: nil))
        }
    }

    func endSessionSync(dismissAfter: TimeInterval = 8) {
        guard let activity = syncActivity else { return }
        syncActivity = nil

        Task {
            // Show final state briefly, then dismiss
            try? await Task.sleep(nanoseconds: UInt64(dismissAfter * 1_000_000_000))
            await activity.end(.init(state: activity.content.state, staleDate: nil), dismissalPolicy: .after(.now + dismissAfter))
        }
    }

    // MARK: - Agent Task

    func startAgentTask(
        taskId: String,
        title: String,
        workspaceName: String? = nil
    ) {
        endAgentTask()

        let attrs = AgentTaskAttributes(taskId: taskId, title: title)
        let state = AgentTaskAttributes.ContentState(
            phase: .queued,
            currentStep: 0,
            totalSteps: 0,
            stepTitle: "Starting...",
            workspaceName: workspaceName,
            startedAt: Date()
        )

        do {
            agentActivity = try Activity<AgentTaskAttributes>.request(
                attributes: attrs,
                content: .init(state: state, staleDate: nil),
                pushType: nil
            )
            logger.info("Started agent activity: \(taskId)")
        } catch {
            logger.error("Failed to start agent activity: \(error.localizedDescription)")
        }
    }

    func updateAgentTask(
        phase: AgentPhase,
        currentStep: Int,
        totalSteps: Int,
        stepTitle: String,
        workspaceName: String? = nil,
        errorMessage: String? = nil
    ) {
        guard let activity = agentActivity else { return }

        let state = AgentTaskAttributes.ContentState(
            phase: phase,
            currentStep: currentStep,
            totalSteps: totalSteps,
            stepTitle: stepTitle,
            workspaceName: workspaceName,
            startedAt: activity.content.state.startedAt,
            errorMessage: errorMessage
        )

        Task {
            await activity.update(.init(state: state, staleDate: nil))
        }
    }

    func endAgentTask(dismissAfter: TimeInterval = 8) {
        guard let activity = agentActivity else { return }
        agentActivity = nil

        Task {
            try? await Task.sleep(nanoseconds: UInt64(dismissAfter * 1_000_000_000))
            await activity.end(.init(state: activity.content.state, staleDate: nil), dismissalPolicy: .after(.now + dismissAfter))
        }
    }

    // MARK: - Status

    var hasActiveSync: Bool { syncActivity != nil }
    var hasActiveAgent: Bool { agentActivity != nil }
}
#endif
