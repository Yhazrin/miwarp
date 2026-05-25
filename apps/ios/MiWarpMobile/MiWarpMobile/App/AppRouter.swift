import SwiftUI

// MARK: - App Router

struct AppRouter: View {
    @EnvironmentObject private var store: MiWarpConnectionStore
    @EnvironmentObject private var theme: MWTheme
    @State private var selectedTab = 0

    var body: some View {
        TabView(selection: $selectedTab) {
            SessionHubView()
                .tabItem {
                    Label("Sessions", systemImage: "bubble.left.and.bubble.right")
                }
                .tag(0)

            PairingView()
                .tabItem {
                    Label("Connect", systemImage: "point.3.filled.connected.trianglepath.dotted")
                }
                .tag(1)

            MobileSettingsView()
                .tabItem {
                    Label("Settings", systemImage: "gear")
                }
                .tag(2)
        }
        .tint(MWColors.tabActive)
        .onAppear {
            configureTabBarAppearance()
        }
    }

    private func configureTabBarAppearance() {
        let appearance = UITabBarAppearance()
        appearance.configureWithOpaqueBackground()
        appearance.backgroundColor = UIColor(MWColors.bgDeepest)

        // Normal state
        appearance.stackedLayoutAppearance.normal.iconColor = UIColor(MWColors.tabInactive)
        appearance.stackedLayoutAppearance.normal.titleTextAttributes = [
            .foregroundColor: UIColor(MWColors.tabInactive),
            .font: UIFont.systemFont(ofSize: 10, weight: .medium),
        ]

        // Selected state
        appearance.stackedLayoutAppearance.selected.iconColor = UIColor(MWColors.tabActive)
        appearance.stackedLayoutAppearance.selected.titleTextAttributes = [
            .foregroundColor: UIColor(MWColors.tabActive),
            .font: UIFont.systemFont(ofSize: 10, weight: .semibold),
        ]

        // Top separator
        appearance.shadowColor = UIColor(MWColors.divider)

        UITabBar.appearance().standardAppearance = appearance
        UITabBar.appearance().scrollEdgeAppearance = appearance
    }
}
