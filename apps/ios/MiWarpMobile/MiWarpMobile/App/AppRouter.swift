import SwiftUI

// MARK: - App Router

struct AppRouter: View {
    @EnvironmentObject private var store: MiWarpConnectionStore
    @EnvironmentObject private var theme: MWTheme
    @State private var selectedTab = 0

    var body: some View {
        ZStack {
            MWPatternedBackdrop()

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
        }
        .tint(MWColors.tabActive)
        .onReceive(NotificationCenter.default.publisher(for: .liveActivityDeepLink)) { notification in
            if let deepLink = notification.object as? LiveActivityDeepLink.ParsedDeepLink {
                handleLiveActivityDeepLink(deepLink)
            }
        }
    }

    private func handleLiveActivityDeepLink(_ deepLink: LiveActivityDeepLink.ParsedDeepLink) {
        switch deepLink {
        case .sync, .sessions:
            selectedTab = 0 // Sessions tab
        case .agent:
            selectedTab = 0 // Sessions tab — agent details shown inline
        }
    }
}
