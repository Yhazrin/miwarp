import SwiftUI

struct HomeDashboardView: View {
    let runs: [MiWarpRun]
    let connectionState: ConnectionState
    let activeConnection: MiWarpConnection?
    let toastPresenter: MiToastPresenter

    @EnvironmentObject private var theme: MWTheme

    var body: some View {
        VStack(spacing: MWSpacing.lg) {
            connectionCard
            if !runs.isEmpty {
                recentRunsSection
            }
        }
    }

    // MARK: - Connection Card

    private var connectionCard: some View {
        HStack(spacing: MWSpacing.md) {
            Circle()
                .fill(statusColor)
                .frame(width: 10, height: 10)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: MWSpacing.xxs) {
                Text(connectionState.displayLabel)
                    .font(MWTypography.subheadlineMedium())
                    .foregroundColor(theme.textPrimary)

                if let conn = activeConnection {
                    Text(conn.host)
                        .font(MWTypography.caption())
                        .foregroundColor(theme.textTertiary)
                }
            }
            .accessibilityElement(children: .combine)

            Spacer()

            if connectionState == .disconnected {
                Button {
                    toastPresenter.show(
                        String(localized: "connection.reconnecting"),
                        kind: .info
                    )
                } label: {
                    Text(String(localized: "connection.connect"))
                        .font(MWTypography.caption().weight(.medium))
                        .foregroundColor(MWColors.accentPrimary)
                }
                .accessibilityLabel(String(localized: "connection.connect"))
            }
        }
        .padding(MWSpacing.lg)
        .background(
            RoundedRectangle(cornerRadius: MWRadius.card)
                .fill(theme.cardBg)
                .overlay(
                    RoundedRectangle(cornerRadius: MWRadius.card)
                        .strokeBorder(theme.divider, lineWidth: 0.5)
                )
        )
    }

    private var statusColor: Color {
        switch connectionState {
        case .connected:
            return MWColors.statusSuccess
        case .connecting, .authenticating, .reconnecting:
            return MWColors.statusWarning
        case .authFailed, .serverUnavailable:
            return MWColors.statusError
        case .disconnected:
            return theme.textTertiary
        }
    }

    // MARK: - Recent Runs

    private var recentRunsSection: some View {
        VStack(alignment: .leading, spacing: MWSpacing.sm) {
            Text(String(localized: "dashboard.recentActivity"))
                .font(MWTypography.footnote().weight(.semibold))
                .foregroundColor(theme.textSecondary)
                .textCase(.uppercase)
                .accessibilityAddTraits(.isHeader)

            ForEach(runs.prefix(3)) { run in
                recentRunRow(run)
            }
        }
    }

    private func recentRunRow(_ run: MiWarpRun) -> some View {
        HStack(spacing: MWSpacing.sm) {
            Image(systemName: run.status == .completed ? "checkmark.circle.fill" : "clock.fill")
                .font(MWTypography.callout())
                .foregroundColor(run.status == .completed ? MWColors.statusSuccess : MWColors.statusWarning)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: MWSpacing.xxs) {
                Text(run.name ?? String(localized: "dashboard.run"))
                    .font(MWTypography.subheadline())
                    .foregroundColor(theme.textPrimary)
                    .lineLimit(1)

                if let date = run.createdAt {
                    Text(date, style: .relative)
                        .font(MWTypography.caption2())
                        .foregroundColor(theme.textTertiary)
                }
            }

            Spacer()
        }
        .padding(MWSpacing.sm)
        .accessibilityElement(children: .combine)
        .background(
            RoundedRectangle(cornerRadius: MWRadius.md)
                .fill(theme.cardBg.opacity(0.5))
        )
    }
}

// MARK: - Preview

#Preview("Disconnected") {
    HomeDashboardView(
        runs: [],
        connectionState: .disconnected,
        activeConnection: nil,
        toastPresenter: MiToastPresenter()
    )
    .environmentObject(MWTheme())
    .padding()
}

#Preview("Connected with runs") {
    HomeDashboardView(
        runs: [
            MiWarpRun(id: "1", name: "Fix login bug", cwd: "/project", agent: "claude", status: .completed, startedAt: "2026-05-27T10:00:00Z"),
            MiWarpRun(id: "2", name: "Add dark mode", cwd: "/project", agent: "claude", status: .running, startedAt: "2026-05-27T11:00:00Z"),
        ],
        connectionState: .connected,
        activeConnection: MiWarpConnection(name: "Desktop", host: "192.168.1.100", port: 9222),
        toastPresenter: MiToastPresenter()
    )
    .environmentObject(MWTheme())
    .padding()
}
