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
                        size: 44,
                        lineWidth: 3
                    )
                }

                DynamicIslandExpandedRegion(.trailing, priority: 1) {
                    SyncExpandedTrailing(
                        phase: context.state.phase,
                        currentCount: context.state.currentCount,
                        totalCount: context.state.totalCount
                    )
                }

                DynamicIslandExpandedRegion(.center) {
                    SyncExpandedCenter(
                        desktopName: context.state.desktopName,
                        currentItemTitle: context.state.currentItemTitle,
                        workspaceName: context.attributes.workspaceName
                    )
                }

                DynamicIslandExpandedRegion(.bottom) {
                    SyncExpandedBottom(
                        phase: context.state.phase,
                        taskId: context.attributes.taskId
                    )
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
                MiWarpActivityCompactRing(
                    progress: context.state.progress,
                    ringPhase: ringPhase(context.state.phase),
                    size: 16
                )
            }
            .contentMargins(.trailing, 32, for: .expanded)
            .contentMargins(.bottom, 8, for: .expanded)
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
                        size: 44,
                        lineWidth: 3
                    )
                }

                DynamicIslandExpandedRegion(.trailing, priority: 1) {
                    AgentExpandedTrailing(
                        phase: context.state.phase,
                        currentStep: context.state.currentStep,
                        totalSteps: context.state.totalSteps
                    )
                }

                DynamicIslandExpandedRegion(.center) {
                    AgentExpandedCenter(
                        title: context.attributes.title,
                        stepTitle: context.state.stepTitle,
                        workspaceName: context.state.workspaceName
                    )
                }

                DynamicIslandExpandedRegion(.bottom) {
                    AgentExpandedBottom(
                        phase: context.state.phase,
                        taskId: context.attributes.taskId
                    )
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
                MiWarpActivityCompactRing(
                    progress: context.state.progress,
                    ringPhase: ringPhase(context.state.phase),
                    size: 16
                )
            }
            .contentMargins(.trailing, 32, for: .expanded)
            .contentMargins(.bottom, 8, for: .expanded)
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

    var body: some View {
        VStack(alignment: .trailing, spacing: 2) {
            if totalCount > 0 {
                Text("\(currentCount)/\(totalCount)")
                    .font(.system(size: 20, weight: .bold).monospacedDigit())
                    .foregroundColor(.white)
            }
            Text(phase.displayTitle)
                .font(.system(size: 11, weight: .medium))
                .foregroundColor(.white.opacity(0.6))
        }
    }
}

struct SyncExpandedCenter: View {
    let desktopName: String?
    let currentItemTitle: String?
    let workspaceName: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("Syncing Sessions")
                .font(.system(size: 14, weight: .semibold))
                .foregroundColor(.white)

            if let desktop = desktopName {
                Text(desktop)
                    .font(.system(size: 11))
                    .foregroundColor(.white.opacity(0.6))
            } else if let ws = workspaceName {
                Text(ws)
                    .font(.system(size: 11))
                    .foregroundColor(.white.opacity(0.6))
            }

            if let item = currentItemTitle, !item.isEmpty {
                Text(item)
                    .font(.system(size: 10))
                    .foregroundColor(.white.opacity(0.45))
                    .lineLimit(1)
            }
        }
    }
}

struct SyncExpandedBottom: View {
    let phase: SyncPhase
    let taskId: String

    var body: some View {
        HStack {
            if phase.isActive {
                Label("Stop", systemImage: "stop.fill")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(Color(hex: 0xFF5A72))
            }
            Spacer()
            Label("Open", systemImage: "arrow.up.right")
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(Color(hex: 0x22D3EE))
        }
        .padding(.horizontal, 16)
        .padding(.top, 4)
    }
}

struct AgentExpandedTrailing: View {
    let phase: AgentPhase
    let currentStep: Int
    let totalSteps: Int

    var body: some View {
        VStack(alignment: .trailing, spacing: 2) {
            if totalSteps > 0 {
                Text("\(currentStep)/\(totalSteps)")
                    .font(.system(size: 20, weight: .bold).monospacedDigit())
                    .foregroundColor(.white)
            }
            Text(phase.displayTitle)
                .font(.system(size: 11, weight: .medium))
                .foregroundColor(.white.opacity(0.6))
        }
    }
}

struct AgentExpandedCenter: View {
    let title: String
    let stepTitle: String
    let workspaceName: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.system(size: 14, weight: .semibold))
                .foregroundColor(.white)
                .lineLimit(1)

            if let ws = workspaceName {
                Text(ws)
                    .font(.system(size: 11))
                    .foregroundColor(.white.opacity(0.6))
                    .lineLimit(1)
            }

            Text(stepTitle)
                .font(.system(size: 10))
                .foregroundColor(.white.opacity(0.45))
                .lineLimit(1)
        }
    }
}

struct AgentExpandedBottom: View {
    let phase: AgentPhase
    let taskId: String

    var body: some View {
        HStack {
            if phase.isActive {
                Label("Stop", systemImage: "stop.fill")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(Color(hex: 0xFF5A72))
            }
            Spacer()
            Label("Open", systemImage: "arrow.up.right")
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(Color(hex: 0x22D3EE))
        }
        .padding(.horizontal, 16)
        .padding(.top, 4)
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
