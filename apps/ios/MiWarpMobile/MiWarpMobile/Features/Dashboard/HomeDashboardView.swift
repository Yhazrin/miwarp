import SwiftUI

struct HomeDashboardView: View {
    let runs: [MiWarpRun]
    let connectionState: ConnectionState
    let activeConnection: MiWarpConnection?
    let toastPresenter: MiToastPresenter

    @EnvironmentObject private var theme: MWTheme

    var body: some View {
        VStack(spacing: 16) {
            connectionCard
            if !runs.isEmpty {
                recentRunsSection
            }
        }
    }

    // MARK: - Connection Card

    private var connectionCard: some View {
        HStack(spacing: 12) {
            Circle()
                .fill(statusColor)
                .frame(width: 10, height: 10)

            VStack(alignment: .leading, spacing: 2) {
                Text(connectionState.displayLabel)
                    .font(.subheadline.weight(.medium))
                    .foregroundColor(theme.textPrimary)

                if let conn = activeConnection {
                    Text(conn.host)
                        .font(.caption)
                        .foregroundColor(theme.textTertiary)
                }
            }

            Spacer()

            if connectionState == .disconnected {
                Button {
                    toastPresenter.show(
                        String(localized: "connection.reconnecting"),
                        kind: .info
                    )
                } label: {
                    Text(String(localized: "connection.connect"))
                        .font(.caption.weight(.medium))
                        .foregroundColor(MWColors.accentPrimary)
                }
            }
        }
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(theme.cardBg)
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
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
        VStack(alignment: .leading, spacing: 8) {
            Text(String(localized: "dashboard.recentActivity"))
                .font(.footnote.weight(.semibold))
                .foregroundColor(theme.textSecondary)
                .textCase(.uppercase)

            ForEach(runs.prefix(3)) { run in
                recentRunRow(run)
            }
        }
    }

    private func recentRunRow(_ run: MiWarpRun) -> some View {
        HStack(spacing: 10) {
            Image(systemName: run.status == .completed ? "checkmark.circle.fill" : "clock.fill")
                .font(.system(size: 14))
                .foregroundColor(run.status == .completed ? MWColors.statusSuccess : MWColors.statusWarning)

            VStack(alignment: .leading, spacing: 2) {
                Text(run.name ?? String(localized: "dashboard.run"))
                    .font(.subheadline)
                    .foregroundColor(theme.textPrimary)
                    .lineLimit(1)

                if let date = run.createdAt {
                    Text(date, style: .relative)
                        .font(.caption2)
                        .foregroundColor(theme.textTertiary)
                }
            }

            Spacer()
        }
        .padding(10)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(theme.cardBg.opacity(0.5))
        )
    }
}
