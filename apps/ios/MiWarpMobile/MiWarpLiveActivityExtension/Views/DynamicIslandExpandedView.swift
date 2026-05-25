import SwiftUI

// MARK: - Sync Expanded

struct SyncExpandedView: View {
    let attributes: SessionSyncAttributes
    let state: SessionSyncAttributes.ContentState

    var body: some View {
        HStack(spacing: 12) {
            // Left: Avatar Ring
            MiWarpActivityAvatarRing(
                progress: state.progress,
                ringPhase: ringPhase,
                mascotState: .from(syncPhase: state.phase),
                size: 48,
                lineWidth: 3.5
            )

            // Middle: Info
            VStack(alignment: .leading, spacing: 2) {
                Text("Syncing Sessions")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(.white)

                if let desktop = state.desktopName {
                    Text(desktop)
                        .font(.system(size: 11))
                        .foregroundColor(.white.opacity(0.6))
                }

                if let item = state.currentItemTitle, !item.isEmpty {
                    Text(item)
                        .font(.system(size: 11))
                        .foregroundColor(.white.opacity(0.5))
                        .lineLimit(1)
                }
            }

            Spacer()

            // Right: Progress
            VStack(alignment: .trailing, spacing: 2) {
                if state.totalCount > 0 {
                    Text("\(state.currentCount) of \(state.totalCount)")
                        .font(.system(size: 14, weight: .semibold).monospacedDigit())
                        .foregroundColor(.white)
                } else {
                    Text(state.phase.displayTitle)
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(.white.opacity(0.8))
                }

                if let error = state.errorMessage {
                    Text(error)
                        .font(.system(size: 10))
                        .foregroundColor(Color(hex: 0xFF5A72))
                        .lineLimit(1)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
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
        HStack(spacing: 12) {
            // Left: Avatar Ring
            MiWarpActivityAvatarRing(
                progress: state.progress,
                ringPhase: ringPhase,
                mascotState: .from(agentPhase: state.phase),
                size: 48,
                lineWidth: 3.5
            )

            // Middle: Info
            VStack(alignment: .leading, spacing: 2) {
                Text(attributes.title)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(.white)
                    .lineLimit(1)

                if let workspace = state.workspaceName {
                    Text(workspace)
                        .font(.system(size: 11))
                        .foregroundColor(.white.opacity(0.6))
                        .lineLimit(1)
                }

                Text(state.stepTitle)
                    .font(.system(size: 11))
                    .foregroundColor(.white.opacity(0.5))
                    .lineLimit(1)
            }

            Spacer()

            // Right: Progress
            VStack(alignment: .trailing, spacing: 2) {
                if state.totalSteps > 0 {
                    Text("Step \(state.currentStep) of \(state.totalSteps)")
                        .font(.system(size: 14, weight: .semibold).monospacedDigit())
                        .foregroundColor(.white)
                } else {
                    Text(state.phase.displayTitle)
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(.white.opacity(0.8))
                }

                if let error = state.errorMessage {
                    Text(error)
                        .font(.system(size: 10))
                        .foregroundColor(Color(hex: 0xFF5A72))
                        .lineLimit(1)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
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
