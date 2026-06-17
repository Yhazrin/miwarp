import SwiftUI

// MARK: - App Router

struct AppRouter: View {
    @EnvironmentObject private var store: MiWarpConnectionStore
    @EnvironmentObject private var theme: MWTheme
    @State private var selectedTab = 0
    @State private var selectedSection: AppRouterSection = .sessions
    @State private var selectedPadSession: MiWarpRun?
    // v1.0.6 / 2.2 (C6): let the user fold / unfold the middle column
    // on iPad. The chosen visibility is persisted to UserDefaults so it
    // survives an app relaunch.
    @AppStorage("miwarp.columnVisibility") private var columnVisibilityRaw = "all"
    private var columnVisibility: Binding<NavigationSplitViewVisibility> {
        Binding(
            get: {
                switch columnVisibilityRaw {
                case "detailOnly": return .detailOnly
                case "doubleColumn": return .doubleColumn
                default: return .all
                }
            },
            set: { newValue in
                switch newValue {
                case .detailOnly:
                    columnVisibilityRaw = "detailOnly"
                case .doubleColumn:
                    columnVisibilityRaw = "doubleColumn"
                default:
                    columnVisibilityRaw = "all"
                }
            }
        )
    }

    var body: some View {
        MWAdaptiveReader { layout in
            ZStack {
                MWPatternedBackdrop()

                if layout.shouldUseSplitView {
                    sidebarLayout(layout: layout)
                } else {
                    tabLayout
                }
            }
        }
        .tint(MWColors.tabActive)
        .sensoryFeedback(.selection, trigger: selectedTab)
        .onAppear {
            configureTabBarAppearance()
        }
        .onChange(of: theme.accentTheme) { _, _ in
            configureTabBarAppearance()
        }
        .onChange(of: theme.effectiveColorScheme) { _, _ in
            configureTabBarAppearance()
        }
        .onReceive(NotificationCenter.default.publisher(for: .liveActivityDeepLink)) { notification in
            if let deepLink = notification.object as? LiveActivityDeepLink.ParsedDeepLink {
                handleLiveActivityDeepLink(deepLink)
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .spotlightSessionOpen)) { _ in
            selectedTab = 0
            selectedSection = .sessions
        }
    }

    private var tabLayout: some View {
        TabView(selection: $selectedTab) {
            SessionHubView()
                .tabItem {
                    Label(String(localized: "tab.sessions"), systemImage: "bubble.left.and.bubble.right")
                }
                .tag(0)

            PairingView()
                .tabItem {
                    Label(String(localized: "tab.connect"), systemImage: "point.3.filled.connected.trianglepath.dotted")
                }
                .tag(1)

            MobileSettingsView()
                .tabItem {
                    Label(String(localized: "tab.settings"), systemImage: "gear")
                }
                .tag(2)
        }
    }

    private func sidebarLayout(layout: MWAdaptiveLayout) -> some View {
        NavigationSplitView(columnVisibility: columnVisibility) {
            List {
                ForEach(AppRouterSection.allCases) { section in
                    Button {
                        selectedSection = section
                    } label: {
                        Label(section.title, systemImage: section.systemImage)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .buttonStyle(.plain)
                    .listRowBackground(
                        selectedSection == section ? theme.accentPrimary.opacity(0.14) : Color.clear
                    )
                }
            }
            .navigationTitle("MiWarp")
            .navigationSplitViewColumnWidth(min: 220, ideal: 260, max: 300)
            .scrollContentBackground(.hidden)
            .background(MWPatternedBackdrop())
        } detail: {
            rootDetail(for: selectedSection, layout: layout)
                .background(MWPatternedBackdrop())
        }
    }

    @ViewBuilder
    private func rootDetail(for section: AppRouterSection, layout: MWAdaptiveLayout) -> some View {
        switch section {
        case .sessions:
            SessionHubView(usesInlineChat: layout.shouldUseSplitView, selectedRun: $selectedPadSession)
        case .connect:
            PairingView()
        case .settings:
            MobileSettingsView()
        }
    }

    private func handleLiveActivityDeepLink(_ deepLink: LiveActivityDeepLink.ParsedDeepLink) {
        switch deepLink {
        case .sync, .sessions:
            selectedTab = 0
            selectedSection = .sessions
        case .agent:
            selectedTab = 0
            selectedSection = .sessions
        }
    }

    private func configureTabBarAppearance() {
        let appearance = UITabBarAppearance()
        appearance.configureWithDefaultBackground()

        appearance.stackedLayoutAppearance.normal.iconColor = .secondaryLabel
        appearance.stackedLayoutAppearance.normal.titleTextAttributes = [
            .foregroundColor: UIColor.secondaryLabel,
            .font: UIFont.systemFont(ofSize: 10, weight: .medium),
        ]

        appearance.stackedLayoutAppearance.selected.iconColor = UIColor(theme.accentPrimary)
        appearance.stackedLayoutAppearance.selected.titleTextAttributes = [
            .foregroundColor: UIColor(theme.accentPrimary),
            .font: UIFont.systemFont(ofSize: 10, weight: .semibold),
        ]

        UITabBar.appearance().standardAppearance = appearance
        UITabBar.appearance().scrollEdgeAppearance = appearance
    }
}

private enum AppRouterSection: String, CaseIterable, Identifiable, Hashable {
    case sessions
    case connect
    case settings

    var id: String { rawValue }

    var title: String {
        switch self {
        case .sessions: return String(localized: "tab.sessions")
        case .connect: return String(localized: "tab.connect")
        case .settings: return String(localized: "tab.settings")
        }
    }

    var systemImage: String {
        switch self {
        case .sessions: return "bubble.left.and.bubble.right"
        case .connect: return "point.3.filled.connected.trianglepath.dotted"
        case .settings: return "gear"
        }
    }
}
