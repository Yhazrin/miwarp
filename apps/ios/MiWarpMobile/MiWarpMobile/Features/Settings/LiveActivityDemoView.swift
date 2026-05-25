#if canImport(ActivityKit)
import ActivityKit
import SwiftUI

/// Local test entry for manually starting, updating, completing, and failing Live Activities.
struct LiveActivityDemoView: View {
    @State private var syncTaskId = UUID().uuidString.prefix(8).description
    @State private var agentTaskId = UUID().uuidString.prefix(8).description
    @State private var syncCount = 0
    @State private var syncTotal = 12
    @State private var agentStep = 0
    @State private var agentTotal = 5
    @State private var syncPhase: SyncPhase = .preparing
    @State private var agentPhase: AgentPhase = .queued
    @State private var activityAuthInfo = ""

    var body: some View {
        List {
            Section {
                Text(activityAuthInfo)
                    .font(.caption)
                    .foregroundColor(.secondary)
            } header: {
                Text("Live Activity Authorization")
            }

            // MARK: - Session Sync Demo
            Section {
                HStack {
                    Text("Task ID")
                    Spacer()
                    Text(syncTaskId)
                        .font(.caption.monospaced())
                        .foregroundColor(.secondary)
                }

                HStack {
                    Text("Phase")
                    Spacer()
                    Text(syncPhase.displayTitle)
                        .foregroundColor(.secondary)
                }

                HStack {
                    Text("Progress")
                    Spacer()
                    Text("\(syncCount) / \(syncTotal)")
                        .font(.caption.monospaced())
                        .foregroundColor(.secondary)
                }

                Button {
                    startSync()
                } label: {
                    Label("Start Sync Activity", systemImage: "play.fill")
                }
                .disabled(syncPhase != .preparing)

                Button {
                    advanceSync()
                } label: {
                    Label("Advance Sync", systemImage: "arrow.right.circle")
                }
                .disabled(!syncPhase.isActive)

                Button {
                    completeSync()
                } label: {
                    Label("Complete Sync", systemImage: "checkmark.circle")
                }
                .disabled(!syncPhase.isActive)

                Button {
                    failSync()
                } label: {
                    Label("Fail Sync", systemImage: "xmark.circle")
                        .foregroundColor(.red)
                }
                .disabled(!syncPhase.isActive)

                Button {
                    resetSync()
                } label: {
                    Label("Reset", systemImage: "arrow.counterclockwise")
                }
            } header: {
                Label("Session Sync", systemImage: "arrow.triangle.2.circlepath")
            }

            // MARK: - Agent Task Demo
            Section {
                HStack {
                    Text("Task ID")
                    Spacer()
                    Text(agentTaskId)
                        .font(.caption.monospaced())
                        .foregroundColor(.secondary)
                }

                HStack {
                    Text("Phase")
                    Spacer()
                    Text(agentPhase.displayTitle)
                        .foregroundColor(.secondary)
                }

                HStack {
                    Text("Progress")
                    Spacer()
                    Text("\(agentStep) / \(agentTotal)")
                        .font(.caption.monospaced())
                        .foregroundColor(.secondary)
                }

                Button {
                    startAgent()
                } label: {
                    Label("Start Agent Activity", systemImage: "play.fill")
                }
                .disabled(agentPhase != .queued)

                Button {
                    advanceAgent()
                } label: {
                    Label("Advance Agent", systemImage: "arrow.right.circle")
                }
                .disabled(!agentPhase.isActive)

                Button {
                    completeAgent()
                } label: {
                    Label("Complete Agent", systemImage: "checkmark.circle")
                }
                .disabled(!agentPhase.isActive)

                Button {
                    failAgent()
                } label: {
                    Label("Fail Agent", systemImage: "xmark.circle")
                        .foregroundColor(.red)
                }
                .disabled(!agentPhase.isActive)

                Button {
                    resetAgent()
                } label: {
                    Label("Reset", systemImage: "arrow.counterclockwise")
                }
            } header: {
                Label("Agent Task", systemImage: "brain")
            }
        }
        .navigationTitle("Live Activity Demo")
        .task {
            checkAuthorization()
        }
    }

    // MARK: - Authorization

    private func checkAuthorization() {
        let authInfo = ActivityAuthorizationInfo()
        activityAuthInfo = "Are Activities Enabled: \(authInfo.areActivitiesEnabled)"
    }

    // MARK: - Sync Controls

    private func startSync() {
        syncPhase = .preparing
        syncCount = 0
        syncTaskId = UUID().uuidString.prefix(8).description

        LiveActivityManager.shared.startSessionSync(
            taskId: syncTaskId,
            workspaceName: "miwarp",
            desktopName: "MacBook Pro"
        )

        // Auto-advance to connecting after 1s
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
            guard syncPhase == .preparing else { return }
            updateSync(.connecting)
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
    }

    private func updateSync(_ phase: SyncPhase, error: String? = nil) {
        syncPhase = phase
        LiveActivityManager.shared.updateSessionSync(
            phase: phase,
            currentCount: syncCount,
            totalCount: syncTotal,
            currentItemTitle: phase.isActive ? "session-\(syncCount)" : nil,
            desktopName: "MacBook Pro",
            errorMessage: error
        )
    }

    // MARK: - Agent Controls

    private func startAgent() {
        agentPhase = .queued
        agentStep = 0
        agentTaskId = UUID().uuidString.prefix(8).description

        LiveActivityManager.shared.startAgentTask(
            taskId: agentTaskId,
            title: "Analyzing Workspace",
            workspaceName: "miwarp"
        )

        DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
            guard agentPhase == .queued else { return }
            updateAgent(.running)
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
