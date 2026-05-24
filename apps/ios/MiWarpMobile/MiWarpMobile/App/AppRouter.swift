import SwiftUI

// MARK: - Tab

enum AppTab: String, CaseIterable {
    case sessions
    case pairing
    case settings

    var title: String {
        switch self {
        case .sessions: return "Sessions"
        case .pairing: return "Connections"
        case .settings: return "Settings"
        }
    }

    var systemImage: String {
        switch self {
        case .sessions: return "bubble.left.and.bubble.right"
        case .pairing: return "point.3.filled.connected.trianglepath.dotted"
        case .settings: return "gear"
        }
    }
}

// MARK: - App Router

struct AppRouter: View {
    @Environment(MiWarpConnectionStore.self) private var store
    @State private var selectedTab: AppTab = .sessions

    var body: some View {
        TabView(selection: $selectedTab) {
            SessionHubView()
                .tabItem {
                    Label(AppTab.sessions.title, systemImage: AppTab.sessions.systemImage)
                }
                .tag(AppTab.sessions)

            PairingView()
                .tabItem {
                    Label(AppTab.pairing.title, systemImage: AppTab.pairing.systemImage)
                }
                .tag(AppTab.pairing)

            MobileSettingsView()
                .tabItem {
                    Label(AppTab.settings.title, systemImage: AppTab.settings.systemImage)
                }
                .tag(AppTab.settings)
        }
        .tint(MWColors.accentPrimary)
    }
}
