#if canImport(ActivityKit)
import ActivityKit
import Foundation
import os.log

/// Result of starting a Live Activity
enum LiveActivityStartResult: Equatable {
    case success(activityId: String)
    case failure(error: String)
    case notSupported

    var isSuccess: Bool {
        if case .success = self { return true }
        return false
    }

    var displayMessage: String {
        switch self {
        case .success(let activityId):
            return "Created! ID: \(activityId.prefix(8))..."
        case .failure(let error):
            return "Failed: \(error)"
        case .notSupported:
            return "Live Activities not supported on this device"
        }
    }
}

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
    ) -> LiveActivityStartResult {
        endSessionSync()

        // Check if Live Activities are supported
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            logger.warning("Live Activities are not enabled on this device")
            return .notSupported
        }

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
            let activityId = syncActivity?.id ?? "unknown"
            logger.info("Started sync activity: \(taskId), ID: \(activityId)")
            return .success(activityId: activityId)
        } catch {
            logger.error("Failed to start sync activity: \(error.localizedDescription)")
            return .failure(error: error.localizedDescription)
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
            await activity.end(
                .init(state: activity.content.state, staleDate: nil),
                dismissalPolicy: .after(.now + dismissAfter)
            )
        }
    }

    // MARK: - Agent Task

    func startAgentTask(
        taskId: String,
        title: String,
        workspaceName: String? = nil
    ) -> LiveActivityStartResult {
        endAgentTask()

        // Check if Live Activities are supported
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            logger.warning("Live Activities are not enabled on this device")
            return .notSupported
        }

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
            let activityId = agentActivity?.id ?? "unknown"
            logger.info("Started agent activity: \(taskId), ID: \(activityId)")
            return .success(activityId: activityId)
        } catch {
            logger.error("Failed to start agent activity: \(error.localizedDescription)")
            return .failure(error: error.localizedDescription)
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
            await activity.end(
                .init(state: activity.content.state, staleDate: nil),
                dismissalPolicy: .after(.now + dismissAfter)
            )
        }
    }

    // MARK: - Status

    var hasActiveSync: Bool { syncActivity != nil }
    var hasActiveAgent: Bool { agentActivity != nil }
}
#endif
