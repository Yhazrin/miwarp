import SwiftUI

struct ConnectionListView: View {
    @EnvironmentObject private var store: MiWarpConnectionStore
    @State private var editMode: EditMode = .inactive

    var body: some View {
        Section("Saved Connections") {
            ForEach(store.connections) { connection in
                HStack {
                    VStack(alignment: .leading, spacing: MWSpacing.xs) {
                        HStack {
                            Text(connection.name)
                                .font(MWTypography.bodyMedium())
                                .foregroundColor(MWColors.textPrimary)
                            if connection.isDefault {
                                Image(systemName: "star.fill")
                                    .font(MWTypography.caption2())
                                    .foregroundColor(MWColors.statusPending)
                            }
                        }
                        Text("\(connection.host):\(connection.port)")
                            .font(MWTypography.monoCaption())
                            .foregroundColor(MWColors.textSecondary)
                    }

                    Spacer()

                    if store.activeConnection?.id == connection.id {
                        MWStatusIndicator(state: store.connectionState)
                    }

                    if editMode == .inactive {
                        Button {
                            store.connect(to: connection)
                        } label: {
                            Text("Connect")
                                .font(MWTypography.subheadlineMedium())
                                .foregroundColor(MWColors.accentPrimary)
                        }
                        .buttonStyle(.borderless)
                    }
                }
            }
            .onDelete { indexSet in
                for index in indexSet {
                    store.removeConnection(store.connections[index])
                }
            }
        }
        .environment(\.editMode, $editMode)
    }
}

// MARK: - Status Indicator

struct MWStatusIndicator: View {
    let state: ConnectionState

    var color: Color {
        switch state {
        case .connected: return MWColors.statusSuccess
        case .connecting, .reconnecting: return MWColors.statusPending
        case .authFailed, .serverUnavailable: return MWColors.statusError
        default: return MWColors.textTertiary
        }
    }

    var body: some View {
        HStack(spacing: MWSpacing.xs) {
            Circle()
                .fill(color)
                .frame(width: 8, height: 8)
            if state != .disconnected {
                Text(state.displayLabel)
                    .font(MWTypography.caption())
                    .foregroundColor(MWColors.textSecondary)
            }
        }
    }
}
