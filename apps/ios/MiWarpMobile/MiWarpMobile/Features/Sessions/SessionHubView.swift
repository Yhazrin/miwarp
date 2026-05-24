import SwiftUI

struct SessionHubView: View {
    @EnvironmentObject private var store: MiWarpConnectionStore
    @EnvironmentObject private var theme: MWTheme
    @StateObject private var viewModel = SessionHubViewModel()

    var body: some View {
        NavigationStack {
            Group {
                if !store.isConnected && viewModel.runs.isEmpty {
                    notConnectedView
                } else if viewModel.isLoading && viewModel.runs.isEmpty {
                    MWLoadingState(message: "Loading sessions...")
                } else if let error = viewModel.error, viewModel.runs.isEmpty {
                    MWErrorState(message: error, onAction: {
                        Task { await viewModel.loadRuns() }
                    })
                } else {
                    sessionList
                }
            }
            .background(theme.bgDeepest)
            .navigationTitle("Sessions")
            .searchable(text: $viewModel.searchText, prompt: "Search sessions...")
            .toolbar {
                ToolbarItemGroup(placement: .primaryAction) {
                    if store.isConnected {
                        Button {
                            viewModel.showFilters = true
                        } label: {
                            Image(systemName: viewModel.filters.isActive ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
                                .foregroundColor(viewModel.filters.isActive ? MWColors.accentCyan : MWColors.textSecondary)
                        }

                        Button {
                            Task { await viewModel.loadRuns() }
                        } label: {
                            Image(systemName: "arrow.clockwise")
                                .font(.system(size: 15, weight: .medium))
                                .foregroundColor(MWColors.textSecondary)
                        }
                    }
                }
            }
            .sheet(isPresented: $viewModel.showFilters) {
                SessionFiltersView(filters: $viewModel.filters, runs: viewModel.runs)
            }
            .task {
                viewModel.attach(store: store)
                if store.isConnected {
                    await viewModel.loadRuns()
                }
            }
            .refreshable {
                await viewModel.loadRuns()
            }
        }
    }

    // MARK: - Not Connected View

    private var notConnectedView: some View {
        VStack(spacing: MWSpacing.xxl) {
            Spacer()

            // Icon
            ZStack {
                Circle()
                    .fill(MWColors.accentPrimary.opacity(0.08))
                    .frame(width: 100, height: 100)

                Image(systemName: "point.3.filled.connected.trianglepath.dotted")
                    .font(MWTypography.iconLarge())
                    .foregroundStyle(MWColors.accentPrimary, MWColors.accentCyan)
            }

            VStack(spacing: MWSpacing.sm) {
                Text("Connect to MiWarp Desktop")
                    .font(MWTypography.title())
                    .foregroundColor(MWColors.textPrimary)

                Text("Your phone connects to a running MiWarp Desktop instance over the local network.")
                    .font(MWTypography.callout())
                    .foregroundColor(MWColors.textSecondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }

            // Steps
            VStack(alignment: .leading, spacing: MWSpacing.md) {
                stepRow(number: 1, text: "Enable Web Server in Desktop Settings")
                stepRow(number: 2, text: "Set bind to 0.0.0.0 (LAN access)")
                stepRow(number: 3, text: "Scan QR or add connection manually")
            }
            .padding(.horizontal, MWSpacing.xl)
            .padding(.vertical, MWSpacing.lg)
            .background(
                RoundedRectangle(cornerRadius: MWRadius.lg)
                    .fill(MWColors.glassBg)
                    .overlay(MWGeometricPattern(opacityOverride: min(theme.textureOpacity, 0.10)))
                    .overlay(
                        RoundedRectangle(cornerRadius: MWRadius.lg)
                            .strokeBorder(MWColors.glassBorder, lineWidth: 0.5)
                    )
            )
            .padding(.horizontal, MWSpacing.xl)

            VStack(spacing: MWSpacing.md) {
                // Primary action
                NavigationLink {
                    PairingView()
                } label: {
                    Label("Connect Desktop", systemImage: "plus.circle.fill")
                        .font(MWTypography.bodyMedium())
                        .foregroundColor(MWColors.accentOnAccent)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, MWSpacing.md)
                        .background(
                            Capsule()
                                .fill(MWColors.accentPrimary)
                        )
                }
                .padding(.horizontal, MWSpacing.xxxl)

                // Secondary hint
                Text("Make sure Desktop Web Server is enabled")
                    .font(MWTypography.caption())
                    .foregroundColor(MWColors.textTertiary)
            }

            Spacer()
        }
    }

    private func stepRow(number: Int, text: String) -> some View {
        HStack(spacing: MWSpacing.md) {
            Text("\(number)")
                .font(MWTypography.caption2())
                .foregroundColor(MWColors.accentOnAccent)
                .frame(width: 22, height: 22)
                .background(
                    Circle()
                        .fill(MWColors.accentCyan.opacity(0.6))
                )

            Text(text)
                .font(MWTypography.callout())
                .foregroundColor(MWColors.textSecondary)
        }
        .background(MWPatternedBackdrop())
    }

    // MARK: - Session List

    private var sessionList: some View {
        VStack(spacing: 0) {
            // Connection status header — compact one-liner
            connectionStatusHeader

            // Filter chips
            if !viewModel.runs.isEmpty {
                filterChipsRow
            }

            // Content
            if viewModel.filteredRuns.isEmpty && !viewModel.searchText.isEmpty {
                MWEmptyState(
                    icon: "magnifyingglass",
                    title: "No Results",
                    message: "No sessions match \"\(viewModel.searchText)\""
                )
            } else if viewModel.filteredRuns.isEmpty {
                MWEmptyState(
                    icon: "checkmark.circle",
                    title: "All Clear",
                    message: "No sessions match the current filters"
                )
            } else {
                List {
                    ForEach(viewModel.filteredRuns) { run in
                        NavigationLink(value: run) {
                            SessionCardView(run: run)
                        }
                        .listRowInsets(EdgeInsets(
                            top: 3,
                            leading: MWSpacing.md,
                            bottom: 3,
                            trailing: MWSpacing.md
                        ))
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                    }
                }
                .listStyle(.plain)
                .background(theme.bgDeepest)
                .padding(.bottom, 80) // Safe area for dock
                .navigationDestination(for: MiWarpRun.self) { run in
                    ChatView(runId: run.id, runTitle: run.displayTitle)
                }
            }
        }
    }

    private var connectionStatusHeader: some View {
        HStack(spacing: MWSpacing.sm) {
            Circle()
                .fill(store.isConnected ? MWColors.statusSuccessLowSat : MWColors.statusError)
                .frame(width: 5, height: 5)

            Text(store.isConnected ? "Connected" : "Disconnected")
                .font(MWTypography.caption())
                .foregroundColor(MWColors.textTertiary)

            if let conn = store.activeConnection {
                Text("·")
                    .foregroundColor(MWColors.textTertiary)
                Text(conn.host)
                    .font(MWTypography.monoCaption())
                    .foregroundColor(MWColors.textTertiary)
            }

            Spacer()

            Text("\(viewModel.filteredRuns.count) sessions")
                .font(MWTypography.caption())
                .foregroundColor(MWColors.textTertiary)
        }
        .padding(.horizontal, MWSpacing.md)
        .padding(.vertical, MWSpacing.xs)
        .background(MWColors.bgDeepest)
    }

    private var filterChipsRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: MWSpacing.sm) {
                filterChip(title: "All", isActive: viewModel.filters.status == nil) {
                    viewModel.filters.status = nil
                }
                filterChip(title: "Active", isActive: viewModel.filters.status == .running) {
                    viewModel.filters.status = viewModel.filters.status == .running ? nil : .running
                }
                filterChip(title: "Idle", isActive: viewModel.filters.status == .idle) {
                    viewModel.filters.status = viewModel.filters.status == .idle ? nil : .idle
                }
                filterChip(title: "Completed", isActive: viewModel.filters.status == .completed) {
                    viewModel.filters.status = viewModel.filters.status == .completed ? nil : .completed
                }
                filterChip(title: "Failed", isActive: viewModel.filters.status == .failed) {
                    viewModel.filters.status = viewModel.filters.status == .failed ? nil : .failed
                }
            }
            .padding(.horizontal, MWSpacing.md)
            .padding(.vertical, MWSpacing.xs)
        }
        .background(MWColors.bgDeepest)
    }

    private func filterChip(title: String, isActive: Bool, onTap: @escaping () -> Void) -> some View {
        Button(action: onTap) {
            Text(title)
                .font(MWTypography.caption())
                .foregroundColor(isActive ? MWColors.tabActive : MWColors.textTertiary)
                .padding(.horizontal, MWSpacing.md)
                .padding(.vertical, MWSpacing.xs)
                .background(
                    Capsule()
                        .fill(isActive ? MWColors.tabActive.opacity(0.10) : Color.clear)
                )
        }
        .buttonStyle(.plain)
    }
}
