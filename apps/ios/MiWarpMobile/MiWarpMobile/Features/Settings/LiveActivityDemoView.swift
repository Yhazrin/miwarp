#if canImport(ActivityKit)
import ActivityKit
import SwiftUI

/// Local test entry for manually starting, updating, completing, and failing Live Activities.
struct LiveActivityDemoView: View {
    @EnvironmentObject private var theme: MWTheme
    @State private var syncTaskId = UUID().uuidString.prefix(8).description
    @State private var agentTaskId = UUID().uuidString.prefix(8).description
    @State private var syncCount = 0
    @State private var syncTotal = 12
    @State private var agentStep = 0
    @State private var agentTotal = 5
    @State private var syncPhase: SyncPhase = .preparing
    @State private var agentPhase: AgentPhase = .queued

    // Debug info
    @State private var activitiesEnabled = false
    @State private var syncResult: LiveActivityStartResult?
    @State private var agentResult: LiveActivityStartResult?

    var body: some View {
        List {
            // MARK: - Device Capability Check
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Image(systemName: activitiesEnabled ? "checkmark.circle.fill" : "xmark.circle.fill")
                            .foregroundColor(activitiesEnabled ? MWColors.statusSuccess : MWColors.statusError)
                        Text("Live Activities: \(activitiesEnabled ? "Enabled" : "Disabled")")
                            .foregroundColor(theme.cardTextPrimary)
                    }

                    HStack {
                        Image(systemName: "capsule.portrait.fill")
                            .foregroundColor(MWColors.accentPrimary)
                        Text(String(localized: "liveActivity.dynamicIslandHint"))
                            .foregroundColor(theme.cardTextPrimary)
                    }

                    if !activitiesEnabled {
                        Text(String(localized: "liveActivity.enableHint"))
                            .font(.caption)
                            .foregroundColor(MWColors.statusWarning)
                    }

                    Text(String(localized: "liveActivity.lockScreenOnly"))
                        .font(.caption2)
                        .foregroundColor(theme.cardTextSecondary)
                }
                .font(.callout)
            } header: {
                Text(String(localized: "liveActivity.deviceCapability"))
                    .foregroundColor(theme.cardTextSecondary)
            }

            // MARK: - Session Sync Demo
            Section {
                HStack {
                    Text(String(localized: "liveActivity.taskId"))
                        .foregroundColor(theme.cardTextPrimary)
                    Spacer()
                    Text(syncTaskId)
                        .font(.caption.monospaced())
                        .foregroundColor(theme.cardTextSecondary)
                }

                HStack {
                    Text(String(localized: "liveActivity.phase"))
                        .foregroundColor(theme.cardTextPrimary)
                    Spacer()
                    Text(syncPhase.displayTitle)
                        .foregroundColor(syncPhase.isActive ? theme.cardTextPrimary : theme.cardTextSecondary)
                }

                HStack {
                    Text(String(localized: "liveActivity.progress"))
                        .foregroundColor(theme.cardTextPrimary)
                    Spacer()
                    Text("\(syncCount) / \(syncTotal)")
                        .font(.caption.monospaced())
                        .foregroundColor(theme.cardTextSecondary)
                }

                if let result = syncResult {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Image(systemName: result.isSuccess ? "checkmark.circle.fill" : "xmark.circle.fill")
                                .foregroundColor(result.isSuccess ? MWColors.statusSuccess : MWColors.statusError)
                            Text(result.displayMessage)
                                .font(.caption)
                                .foregroundColor(theme.cardTextPrimary)
                        }
                    }
                    .padding(.vertical, 4)
                }

                Button {
                    startSync()
                } label: {
                    Label(String(localized: "liveActivity.startSync"), systemImage: "play.fill")
                        .foregroundColor(theme.cardTextPrimary)
                }
                .disabled(syncPhase != .preparing)

                Button {
                    advanceSync()
                } label: {
                    Label(String(localized: "liveActivity.advanceSync"), systemImage: "arrow.right.circle")
                        .foregroundColor(theme.cardTextPrimary)
                }
                .disabled(!syncPhase.isActive)

                Button {
                    completeSync()
                } label: {
                    Label(String(localized: "liveActivity.completeSync"), systemImage: "checkmark.circle")
                        .foregroundColor(theme.cardTextPrimary)
                }
                .disabled(!syncPhase.isActive)

                Button {
                    failSync()
                } label: {
                    Label(String(localized: "liveActivity.failSync"), systemImage: "xmark.circle")
                        .foregroundColor(MWColors.statusError)
                }
                .disabled(!syncPhase.isActive)

                Button {
                    resetSync()
                } label: {
                    Label(String(localized: "liveActivity.reset"), systemImage: "arrow.counterclockwise")
                        .foregroundColor(theme.cardTextPrimary)
                }
            } header: {
                Label(String(localized: "liveActivity.sessionSync"), systemImage: "arrow.triangle.2.circlepath")
                    .foregroundColor(theme.cardTextSecondary)
            }

            // MARK: - Agent Task Demo
            Section {
                HStack {
                    Text(String(localized: "liveActivity.taskId"))
                        .foregroundColor(theme.cardTextPrimary)
                    Spacer()
                    Text(agentTaskId)
                        .font(.caption.monospaced())
                        .foregroundColor(theme.cardTextSecondary)
                }

                HStack {
                    Text(String(localized: "liveActivity.phase"))
                        .foregroundColor(theme.cardTextPrimary)
                    Spacer()
                    Text(agentPhase.displayTitle)
                        .foregroundColor(agentPhase.isActive ? theme.cardTextPrimary : theme.cardTextSecondary)
                }

                HStack {
                    Text(String(localized: "liveActivity.progress"))
                        .foregroundColor(theme.cardTextPrimary)
                    Spacer()
                    Text("\(agentStep) / \(agentTotal)")
                        .font(.caption.monospaced())
                        .foregroundColor(theme.cardTextSecondary)
                }

                if let result = agentResult {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Image(systemName: result.isSuccess ? "checkmark.circle.fill" : "xmark.circle.fill")
                                .foregroundColor(result.isSuccess ? MWColors.statusSuccess : MWColors.statusError)
                            Text(result.displayMessage)
                                .font(.caption)
                                .foregroundColor(theme.cardTextPrimary)
                        }
                    }
                    .padding(.vertical, 4)
                }

                Button {
                    startAgent()
                } label: {
                    Label(String(localized: "liveActivity.startAgent"), systemImage: "play.fill")
                        .foregroundColor(theme.cardTextPrimary)
                }
                .disabled(agentPhase != .queued)

                Button {
                    advanceAgent()
                } label: {
                    Label(String(localized: "liveActivity.advanceAgent"), systemImage: "arrow.right.circle")
                        .foregroundColor(theme.cardTextPrimary)
                }
                .disabled(!agentPhase.isActive)

                Button {
                    completeAgent()
                } label: {
                    Label(String(localized: "liveActivity.completeAgent"), systemImage: "checkmark.circle")
                        .foregroundColor(theme.cardTextPrimary)
                }
                .disabled(!agentPhase.isActive)

                Button {
                    failAgent()
                } label: {
                    Label(String(localized: "liveActivity.failAgent"), systemImage: "xmark.circle")
                        .foregroundColor(MWColors.statusError)
                }
                .disabled(!agentPhase.isActive)

                Button {
                    resetAgent()
                } label: {
                    Label(String(localized: "liveActivity.reset"), systemImage: "arrow.counterclockwise")
                        .foregroundColor(theme.cardTextPrimary)
                }
            } header: {
                Label(String(localized: "liveActivity.agentTask"), systemImage: "brain")
            }
        }
        .navigationTitle(String(localized: "liveActivity.title"))
        .task {
            checkCapabilities()
        }
    }

    // MARK: - Capabilities Check

    private func checkCapabilities() {
        let authInfo = ActivityAuthorizationInfo()
        activitiesEnabled = authInfo.areActivitiesEnabled
    }

    // MARK: - Sync Controls

    private func startSync() {
        syncPhase = .preparing
        syncCount = 0
        syncTaskId = UUID().uuidString.prefix(8).description
        syncResult = nil

        let result = LiveActivityManager.shared.startSessionSync(
            taskId: syncTaskId,
            workspaceName: "miwarp",
            desktopName: "MacBook Pro"
        )
        syncResult = result

        if result.isSuccess {
            updateSync(.connecting, currentItemTitle: "Starting")
        }
    }

    private func advanceSync() {
        syncCount += 1
        if syncCount >= syncTotal {
            completeSync()
            return
        }

        let phase: SyncPhase = syncCount < 3 ? .connecting : .syncing
        updateSync(phase)
    }

    private func completeSync() {
        syncCount = syncTotal
        updateSync(.completed)
        LiveActivityManager.shared.endSessionSync()
    }

    private func failSync() {
        updateSync(.failed, error: "Connection lost")
        LiveActivityManager.shared.endSessionSync(dismissAfter: 15)
    }

    private func resetSync() {
        syncPhase = .preparing
        syncCount = 0
        syncTaskId = UUID().uuidString.prefix(8).description
        syncResult = nil
    }

    private func updateSync(_ phase: SyncPhase, currentItemTitle: String? = nil, error: String? = nil) {
        syncPhase = phase
        LiveActivityManager.shared.updateSessionSync(
            phase: phase,
            currentCount: syncCount,
            totalCount: syncTotal,
            currentItemTitle: phase.isActive ? (currentItemTitle ?? "session-\(syncCount)") : nil,
            desktopName: "MacBook Pro",
            errorMessage: error
        )
    }

    // MARK: - Agent Controls

    private func startAgent() {
        agentPhase = .queued
        agentStep = 0
        agentTaskId = UUID().uuidString.prefix(8).description
        agentResult = nil

        let result = LiveActivityManager.shared.startAgentTask(
            taskId: agentTaskId,
            title: "Analyzing Workspace",
            workspaceName: "miwarp"
        )
        agentResult = result

        if result.isSuccess {
            updateAgent(.running, stepTitle: "Starting")
        }
    }

    private func advanceAgent() {
        agentStep += 1
        if agentStep >= agentTotal {
            completeAgent()
            return
        }

        let stepTitles = ["Scanning files", "Analyzing imports", "Checking types", "Running linter", "Generating report"]
        let title = agentStep < stepTitles.count ? stepTitles[agentStep] : "Step \(agentStep)"
        updateAgent(.running, stepTitle: title)
    }

    private func completeAgent() {
        agentStep = agentTotal
        updateAgent(.completed, stepTitle: "Analysis complete")
        LiveActivityManager.shared.endAgentTask()
    }

    private func failAgent() {
        updateAgent(.failed, stepTitle: "Error occurred", error: "Out of memory")
        LiveActivityManager.shared.endAgentTask(dismissAfter: 15)
    }

    private func resetAgent() {
        agentPhase = .queued
        agentStep = 0
        agentTaskId = UUID().uuidString.prefix(8).description
        agentResult = nil
    }

    private func updateAgent(_ phase: AgentPhase, stepTitle: String? = nil, error: String? = nil) {
        agentPhase = phase
        LiveActivityManager.shared.updateAgentTask(
            phase: phase,
            currentStep: agentStep,
            totalSteps: agentTotal,
            stepTitle: stepTitle ?? phase.displayTitle,
            workspaceName: "miwarp",
            errorMessage: error
        )
    }
}
#endif
