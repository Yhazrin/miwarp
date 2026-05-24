import SwiftUI

struct SessionCardView: View {
    let run: MiWarpRun
    var onTap: (() -> Void)?

    var body: some View {
        Button {
            onTap?()
        } label: {
            VStack(alignment: .leading, spacing: MWSpacing.sm) {
                HStack {
                    VStack(alignment: .leading, spacing: MWSpacing.xs) {
                        Text(run.displayTitle)
                            .font(MWTypography.bodyMedium())
                            .foregroundColor(MWColors.textPrimary)
                            .lineLimit(2)

                        HStack(spacing: MWSpacing.sm) {
                            Label(run.agent, systemImage: "cpu")
                            Label(run.model, systemImage: "cube")
                        }
                        .font(MWTypography.caption())
                        .foregroundColor(MWColors.textSecondary)
                    }

                    Spacer()

                    MWStatusPill(status: run.status)
                }

                HStack {
                    Label(run.shortCwd, systemImage: "folder")
                        .font(MWTypography.monoSmall())
                        .foregroundColor(MWColors.textTertiary)

                    Spacer()

                    Label("\(run.messageCount)", systemImage: "message")
                        .font(MWTypography.caption())
                        .foregroundColor(MWColors.textTertiary)

                    if let lastActivity = run.lastActivity {
                        Text(lastActivity.formatted(.relative(presentation: .named)))
                            .font(MWTypography.caption2())
                            .foregroundColor(MWColors.textTertiary)
                    }
                }

                // Source badge
                if run.source != .unknown {
                    HStack(spacing: MWSpacing.xs) {
                        Image(systemName: sourceIcon(run.source))
                            .font(MWTypography.caption2())
                        Text(run.source.rawValue.capitalized)
                            .font(MWTypography.caption2())
                    }
                    .foregroundColor(MWColors.accentCyan)
                    .padding(.horizontal, MWSpacing.sm)
                    .padding(.vertical, 2)
                    .background(
                        Capsule()
                            .fill(MWColors.accentCyan.opacity(0.1))
                    )
                }

                // Indicators
                HStack(spacing: MWSpacing.sm) {
                    if run.hasApprovalPending {
                        Label("Approval needed", systemImage: "exclamationmark.shield.fill")
                            .font(MWTypography.caption2())
                            .foregroundColor(MWColors.statusWarning)
                    }
                    if run.hasFilesChanged {
                        Label("Files changed", systemImage: "doc.badge.arrow.up")
                            .font(MWTypography.caption2())
                            .foregroundColor(MWColors.accentCyan)
                    }
                    if run.hasArtifacts {
                        Label("Artifacts", systemImage: "archivebox")
                            .font(MWTypography.caption2())
                            .foregroundColor(MWColors.accentPrimary)
                    }
                }
            }
            .padding(MWSpacing.lg)
            .background(
                RoundedRectangle(cornerRadius: MWRadius.lg)
                    .fill(MWColors.bgElevated)
                    .overlay(
                        RoundedRectangle(cornerRadius: MWRadius.lg)
                            .strokeBorder(MWColors.glassBorder, lineWidth: 0.5)
                    )
            )
        }
        .buttonStyle(.plain)
    }

    private func sourceIcon(_ source: RunSource) -> String {
        switch source {
        case .cli: return "terminal"
        case .web: return "globe"
        case .mobile: return "iphone"
        case .api: return "point.3.connected.trianglepath.dotted"
        case .unknown: return "questionmark.circle"
        }
    }
}
