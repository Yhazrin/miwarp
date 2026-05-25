import SwiftUI

// MARK: - App Router

struct AppRouter: View {
    @EnvironmentObject private var store: MiWarpConnectionStore
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
        .tabViewStyle(.automatic)
        .toolbarBackground(.ultraThinMaterial, for: .tabBar)
        .toolbarBackground(.visible, for: .tabBar)
    }
}
