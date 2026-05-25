#if canImport(ActivityKit)
import SwiftUI
import WidgetKit

// MARK: - Session Sync Widget

struct SessionSyncLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: SessionSyncAttributes.self) { context in
            // Lock Screen / StandBy
            SyncLockScreenView(
                attributes: context.attributes,
                state: context.state
            )
            .activityBackgroundTint(Color.black.opacity(0.85))
            .widgetURL(LiveActivityDeepLink.sync(taskId: context.attributes.taskId))
        } dynamicIsland: { context in
            DynamicIsland {
                // Expanded
                DynamicIslandExpandedRegion(.leading) {
                    MiWarpActivityAvatarRing(
                        progress: context.state.progress,
                        ringPhase: ringPhase(context.state.phase),
                        mascotState: .from(syncPhase: context.state.phase),
                        size: 46,
                        lineWidth: 3.25
                    )
                }

                DynamicIslandExpandedRegion(.trailing, priority: 1) {
                    SyncExpandedTrailing(
                        phase: context.state.phase,
                        currentCount: context.state.currentCount,
                        totalCount: context.state.totalCount,
                        progress: context.state.progress
                    )
                }

                DynamicIslandExpandedRegion(.center) {
                    SyncExpandedCenter(
                        phase: context.state.phase,
                        desktopName: context.state.desktopName,
                        currentItemTitle: context.state.currentItemTitle,
                        workspaceName: context.attributes.workspaceName,
                        errorMessage: context.state.errorMessage
                    )
                }

                DynamicIslandExpandedRegion(.bottom) {
                    ExpandedOpenAction()
                }
            } compactLeading: {
                SyncCompactLeading(phase: context.state.phase)
            } compactTrailing: {
                SyncCompactTrailing(
                    phase: context.state.phase,
                    currentCount: context.state.currentCount,
                    totalCount: context.state.totalCount
                )
            } minimal: {
                SyncCompactLeading(phase: context.state.phase)
            }
            .contentMargins(.horizontal, 14, for: .expanded)
            .contentMargins(.vertical, 8, for: .expanded)
            .contentMargins([.leading, .top, .bottom], 6, for: .compactLeading)
            .contentMargins(.all, 6, for: .minimal)
            .widgetURL(LiveActivityDeepLink.sync(taskId: context.attributes.taskId))
        }
    }

    private func ringPhase(_ phase: SyncPhase) -> MiWarpRingProgressView.RingPhase {
        switch phase {
        case .preparing: return .preparing
        case .connecting: return .connecting
        case .syncing, .importing, .exporting: return .syncing
        case .finishing: return .waiting
        case .completed: return .completed
        case .failed: return .failed
        }
    }
}

// MARK: - Agent Task Widget

struct AgentTaskLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: AgentTaskAttributes.self) { context in
            // Lock Screen / StandBy
            AgentLockScreenView(
                attributes: context.attributes,
                state: context.state
            )
            .activityBackgroundTint(Color.black.opacity(0.85))
            .widgetURL(LiveActivityDeepLink.agent(taskId: context.attributes.taskId))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    MiWarpActivityAvatarRing(
                        progress: context.state.progress,
                        ringPhase: ringPhase(context.state.phase),
                        mascotState: .from(agentPhase: context.state.phase),
                        size: 46,
                        lineWidth: 3.25
                    )
                }

                DynamicIslandExpandedRegion(.trailing, priority: 1) {
                    AgentExpandedTrailing(
                        phase: context.state.phase,
                        currentStep: context.state.currentStep,
                        totalSteps: context.state.totalSteps,
                        progress: context.state.progress
                    )
                }

                DynamicIslandExpandedRegion(.center) {
                    AgentExpandedCenter(
                        phase: context.state.phase,
                        fallbackTitle: context.attributes.title,
                        stepTitle: context.state.stepTitle,
                        workspaceName: context.state.workspaceName,
                        currentStep: context.state.currentStep,
                        totalSteps: context.state.totalSteps,
                        errorMessage: context.state.errorMessage
                    )
                }

                DynamicIslandExpandedRegion(.bottom) {
                    ExpandedOpenAction()
                }
            } compactLeading: {
                AgentCompactLeading(phase: context.state.phase)
            } compactTrailing: {
                AgentCompactTrailing(
                    phase: context.state.phase,
                    currentStep: context.state.currentStep,
                    totalSteps: context.state.totalSteps
                )
            } minimal: {
                AgentCompactLeading(phase: context.state.phase)
            }
            .contentMargins(.horizontal, 14, for: .expanded)
            .contentMargins(.vertical, 8, for: .expanded)
            .contentMargins([.leading, .top, .bottom], 6, for: .compactLeading)
            .contentMargins(.all, 6, for: .minimal)
            .widgetURL(LiveActivityDeepLink.agent(taskId: context.attributes.taskId))
        }
    }

    private func ringPhase(_ phase: AgentPhase) -> MiWarpRingProgressView.RingPhase {
        switch phase {
        case .queued: return .preparing
        case .running: return .syncing
        case .waiting: return .waiting
        case .completed: return .completed
        case .failed: return .failed
        }
    }
}

// MARK: - Expanded Sub-views

struct SyncExpandedTrailing: View {
    let phase: SyncPhase
    let currentCount: Int
    let totalCount: Int
    let progress: Double

    var body: some View {
        Text(statusValue)
            .font(.system(size: 20, weight: .bold).monospacedDigit())
            .foregroundColor(.white)
            .lineLimit(1)
            .minimumScaleFactor(0.72)
            .contentTransition(.numericText())
    }

    private var statusValue: String {
        if totalCount > 0 {
            return "\(currentCount)/\(totalCount)"
        }

        switch phase {
        case .completed:
            return "Done"
        case .failed:
            return "Fail"
        default:
            return "\(Int(progress * 100))%"
        }
    }
}

struct SyncExpandedCenter: View {
    let phase: SyncPhase
    let desktopName: String?
    let currentItemTitle: String?
    let workspaceName: String?
    let errorMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text("Syncing Sessions")
                .font(.system(size: 15, weight: .semibold))
                .foregroundColor(.white)
                .lineLimit(1)

            Text(subtitle)
                .font(.system(size: 11, weight: .medium))
                .foregroundColor(subtitleColor)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
        }
    }

    private var subtitle: String {
        if let errorMessage, !errorMessage.isEmpty {
            return errorMessage
        }

        if phase == .completed {
            return "All sessions synced"
        }

        if let currentItemTitle, !currentItemTitle.isEmpty {
            return currentItemTitle
        }

        if let workspaceName, !workspaceName.isEmpty {
            return "Workspace \(workspaceName)"
        }

        if let desktopName, !desktopName.isEmpty {
            return desktopName
        }

        return "Preparing sync"
    }

    private var subtitleColor: Color {
        phase == .failed ? Color(hex: 0xFF8A9A) : .white.opacity(0.62)
    }
}

struct AgentExpandedTrailing: View {
    let phase: AgentPhase
    let currentStep: Int
    let totalSteps: Int
    let progress: Double

    var body: some View {
        Text(statusValue)
            .font(.system(size: 20, weight: .bold).monospacedDigit())
            .foregroundColor(.white)
            .lineLimit(1)
            .minimumScaleFactor(0.72)
            .contentTransition(.numericText())
    }

    private var statusValue: String {
        if totalSteps > 0 {
            return "\(currentStep)/\(totalSteps)"
        }

        switch phase {
        case .completed:
            return "Done"
        case .failed:
            return "Fail"
        default:
            return "\(Int(progress * 100))%"
        }
    }
}

struct AgentExpandedCenter: View {
    let phase: AgentPhase
    let fallbackTitle: String
    let stepTitle: String
    let workspaceName: String?
    let currentStep: Int
    let totalSteps: Int
    let errorMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title)
                .font(.system(size: 15, weight: .semibold))
                .foregroundColor(.white)
                .lineLimit(1)

            Text(subtitle)
                .font(.system(size: 11, weight: .medium))
                .foregroundColor(subtitleColor)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
        }
    }

    private var title: String {
        if let workspaceName, !workspaceName.isEmpty {
            return "Analyzing \(workspaceName)"
        }
        return fallbackTitle
    }

    private var subtitle: String {
        if let errorMessage, !errorMessage.isEmpty {
            return errorMessage
        }

        if phase == .completed {
            return "Task complete"
        }

        if totalSteps > 0 {
            return "Step \(currentStep) of \(totalSteps) · \(stepTitle)"
        }

        return stepTitle
    }

    private var subtitleColor: Color {
        phase == .failed ? Color(hex: 0xFF8A9A) : .white.opacity(0.62)
    }
}

struct ExpandedOpenAction: View {
    var body: some View {
        HStack {
            Spacer()
            Label("Open", systemImage: "arrow.up.right")
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(Color(hex: 0x22D3EE))
                .labelStyle(.titleAndIcon)
                .padding(.horizontal, 10)
                .frame(height: 22)
                .background(Color.white.opacity(0.08), in: Capsule())
        }
        .frame(maxWidth: .infinity, minHeight: 22, maxHeight: 24, alignment: .center)
        .padding(.top, 1)
    }
}

// MARK: - Bundle

@main
struct MiWarpLiveActivityBundle: WidgetBundle {
    var body: some Widget {
        SessionSyncLiveActivityWidget()
        AgentTaskLiveActivityWidget()
    }
}
#endif
