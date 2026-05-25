import SwiftUI

// MARK: - Sync Expanded

struct SyncExpandedView: View {
    let attributes: SessionSyncAttributes
    let state: SessionSyncAttributes.ContentState

    var body: some View {
        HStack(spacing: 13) {
            MiWarpActivityAvatarRing(
                progress: state.progress,
                ringPhase: ringPhase,
                mascotState: .from(syncPhase: state.phase),
                size: 46,
                lineWidth: 3.25
            )

            SyncExpandedCenter(
                phase: state.phase,
                desktopName: state.desktopName,
                currentItemTitle: state.currentItemTitle,
                workspaceName: attributes.workspaceName,
                errorMessage: state.errorMessage
            )

            Spacer()

            SyncExpandedTrailing(
                phase: state.phase,
                currentCount: state.currentCount,
                totalCount: state.totalCount,
                progress: state.progress
            )
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
    }

    private var ringPhase: MiWarpRingProgressView.RingPhase {
        switch state.phase {
        case .preparing: return .preparing
        case .connecting: return .connecting
        case .syncing, .importing, .exporting: return .syncing
        case .finishing: return .waiting
        case .completed: return .completed
        case .failed: return .failed
        }
    }
}

// MARK: - Agent Expanded

struct AgentExpandedView: View {
    let attributes: AgentTaskAttributes
    let state: AgentTaskAttributes.ContentState

    var body: some View {
        HStack(spacing: 13) {
            MiWarpActivityAvatarRing(
                progress: state.progress,
                ringPhase: ringPhase,
                mascotState: .from(agentPhase: state.phase),
                size: 46,
                lineWidth: 3.25
            )

            AgentExpandedCenter(
                phase: state.phase,
                fallbackTitle: attributes.title,
                stepTitle: state.stepTitle,
                workspaceName: state.workspaceName,
                currentStep: state.currentStep,
                totalSteps: state.totalSteps,
                errorMessage: state.errorMessage
            )

            Spacer()

            AgentExpandedTrailing(
                phase: state.phase,
                currentStep: state.currentStep,
                totalSteps: state.totalSteps,
                progress: state.progress
            )
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
    }

    private var ringPhase: MiWarpRingProgressView.RingPhase {
        switch state.phase {
        case .queued: return .preparing
        case .running: return .syncing
        case .waiting: return .waiting
        case .completed: return .completed
        case .failed: return .failed
        }
    }
}
