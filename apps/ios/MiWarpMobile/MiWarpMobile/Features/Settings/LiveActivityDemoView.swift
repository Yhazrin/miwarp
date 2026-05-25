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

    // Debug info
    @State private var activitiesEnabled = false
    @State private var syncResult: LiveActivityStartResult?
    @State private var agentResult: LiveActivityStartResult?
    @State private var deviceSupportsDynamicIsland = false

    var body: some View {
        List {
            // MARK: - Device Capability Check
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Image(systemName: activitiesEnabled ? "checkmark.circle.fill" : "xmark.circle.fill")
                            .foregroundColor(activitiesEnabled ? .green : .red)
                        Text("Live Activities: \(activitiesEnabled ? "Enabled" : "Disabled")")
                    }

                    HStack {
                        Image(systemName: deviceSupportsDynamicIsland ? "capsule.portrait.fill" : "iphone")
                            .foregroundColor(deviceSupportsDynamicIsland ? .purple : .secondary)
                        Text("Dynamic Island: \(deviceSupportsDynamicIsland ? "Supported" : "Not Supported")")
                    }

                    if !activitiesEnabled {
                        Text("⚠️ Go to Settings → MiWarp → Live Activities and enable it")
                            .font(.caption)
                            .foregroundColor(.orange)
                    }

                    Text("ℹ️ Dynamic Island requires iPhone 14 Pro or later. Other iPhones show Lock Screen Live Activity only.")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
                .font(.callout)
            } header: {
                Text("Device Capability")
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
                        .foregroundColor(syncPhase.isActive ? .primary : .secondary)
                }

                HStack {
                    Text("Progress")
                    Spacer()
                    Text("\(syncCount) / \(syncTotal)")
                        .font(.caption.monospaced())
                        .foregroundColor(.secondary)
                }

                if let result = syncResult {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Image(systemName: result.isSuccess ? "checkmark.circle.fill" : "xmark.circle.fill")
                                .foregroundColor(result.isSuccess ? .green : .red)
                            Text(result.displayMessage)
                                .font(.caption)
                        }
                    }
                    .padding(.vertical, 4)
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
                        .foregroundColor(agentPhase.isActive ? .primary : .secondary)
                }

                HStack {
                    Text("Progress")
                    Spacer()
                    Text("\(agentStep) / \(agentTotal)")
                        .font(.caption.monospaced())
                        .foregroundColor(.secondary)
                }

                if let result = agentResult {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Image(systemName: result.isSuccess ? "checkmark.circle.fill" : "xmark.circle.fill")
                                .foregroundColor(result.isSuccess ? .green : .red)
                            Text(result.displayMessage)
                                .font(.caption)
                        }
                    }
                    .padding(.vertical, 4)
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
            checkCapabilities()
        }
    }

    // MARK: - Capabilities Check

    private func checkCapabilities() {
        let authInfo = ActivityAuthorizationInfo()
        activitiesEnabled = authInfo.areActivitiesEnabled

        // Check if device supports Dynamic Island (iPhone 14 Pro and later)
        // This is a simple check - in production you'd use device model detection
        #if targetEnvironment(simulator)
        deviceSupportsDynamicIsland = true // Simulator supports it
        #else
        // On real device, we'd need to check device model
        // For now, assume iPhone 14 Pro+ has Dynamic Island
        deviceSupportsDynamicIsland = false // Default to false, real device detection would be needed
        #endif
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
            // Auto-advance to connecting after 1s
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                guard syncPhase == .preparing else { return }
                updateSync(.connecting)
            }
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
        agentResult = nil

        let result = LiveActivityManager.shared.startAgentTask(
            taskId: agentTaskId,
            title: "Analyzing Workspace",
            workspaceName: "miwarp"
        )
        agentResult = result

        if result.isSuccess {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                guard agentPhase == .queued else { return }
                updateAgent(.running)
            }
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
