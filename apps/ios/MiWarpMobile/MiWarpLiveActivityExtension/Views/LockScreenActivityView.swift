import SwiftUI

// MARK: - Sync Lock Screen

struct SyncLockScreenView: View {
    let attributes: SessionSyncAttributes
    let state: SessionSyncAttributes.ContentState
    @Environment(\.isLuminanceReduced) var isLuminanceReduced

    var body: some View {
        HStack(spacing: 14) {
            // Avatar ring — larger on lock screen
            MiWarpActivityAvatarRing(
                progress: state.progress,
                ringPhase: ringPhase,
                mascotState: .from(syncPhase: state.phase),
                size: isLuminanceReduced ? 36 : 52,
                lineWidth: isLuminanceReduced ? 2.5 : 4
            )
            .opacity(isLuminanceReduced ? 0.6 : 1.0)

            VStack(alignment: .leading, spacing: 3) {
                Text(String(localized: "liveActivity.syncing"))
                    .font(.system(size: isLuminanceReduced ? 13 : 15, weight: .semibold))
                    .foregroundColor(.white)

                if let desktop = state.desktopName {
                    Text(desktop)
                        .font(.system(size: 11))
                        .foregroundColor(.white.opacity(0.6))
                }

                // Progress or status
                if let item = state.currentItemTitle, !item.isEmpty, state.phase.isActive {
                    Text(item)
                        .font(.system(size: 11))
                        .foregroundColor(.white.opacity(0.5))
                        .lineLimit(1)
                }

                if let error = state.errorMessage {
                    Text(error)
                        .font(.system(size: 11))
                        .foregroundColor(Color(hex: 0xFF5A72))
                        .lineLimit(1)
                }
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 3) {
                if state.totalCount > 0 {
                    Text(String(format: String(localized: "liveActivity.countOf"), state.currentCount, state.totalCount))
                        .font(.system(size: isLuminanceReduced ? 13 : 16, weight: .semibold).monospacedDigit())
                        .foregroundColor(.white)
                } else {
                    Text(state.phase.displayTitle)
                        .font(.system(size: isLuminanceReduced ? 13 : 15, weight: .medium))
                        .foregroundColor(.white.opacity(0.8))
                }

                if !state.phase.isActive {
                    Text(state.phase == .completed ? String(localized: "liveActivity.allSynced") : String(localized: "liveActivity.tapToView"))
                        .font(.system(size: 10))
                        .foregroundColor(.white.opacity(0.45))
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
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

// MARK: - Agent Lock Screen

struct AgentLockScreenView: View {
    let attributes: AgentTaskAttributes
    let state: AgentTaskAttributes.ContentState
    @Environment(\.isLuminanceReduced) var isLuminanceReduced

    var body: some View {
        HStack(spacing: 14) {
            MiWarpActivityAvatarRing(
                progress: state.progress,
                ringPhase: ringPhase,
                mascotState: .from(agentPhase: state.phase),
                size: isLuminanceReduced ? 36 : 52,
                lineWidth: isLuminanceReduced ? 2.5 : 4
            )
            .opacity(isLuminanceReduced ? 0.6 : 1.0)

            VStack(alignment: .leading, spacing: 3) {
                Text(attributes.title)
                    .font(.system(size: isLuminanceReduced ? 13 : 15, weight: .semibold))
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

                if let error = state.errorMessage {
                    Text(error)
                        .font(.system(size: 11))
                        .foregroundColor(Color(hex: 0xFF5A72))
                        .lineLimit(1)
                }
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 3) {
                if state.totalSteps > 0 {
                    Text(String(format: String(localized: "liveActivity.stepOf"), state.currentStep, state.totalSteps))
                        .font(.system(size: isLuminanceReduced ? 13 : 16, weight: .semibold).monospacedDigit())
                        .foregroundColor(.white)
                } else {
                    Text(state.phase.displayTitle)
                        .font(.system(size: isLuminanceReduced ? 13 : 15, weight: .medium))
                        .foregroundColor(.white.opacity(0.8))
                }

                if !state.phase.isActive {
                    Text(state.phase == .completed ? String(localized: "liveActivity.done") : String(localized: "liveActivity.tapToView"))
                        .font(.system(size: 10))
                        .foregroundColor(.white.opacity(0.45))
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
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
