import SwiftUI

@main
struct MiWarpMobileApp: App {
    @StateObject private var connectionStore = MiWarpConnectionStore.shared
    @StateObject private var theme = MWTheme.shared

    var body: some Scene {
        WindowGroup {
            RootView(theme: theme, connectionStore: connectionStore)
                .environmentObject(connectionStore)
                .environmentObject(theme)
                .preferredColorScheme(theme.preferredColorScheme)
                .onOpenURL { url in
                    handleDeepLink(url)
                }
                .onAppear {
                    connectionStore.connectToDefault()
                }
        }
    }

    private func handleDeepLink(_ url: URL) {
        guard url.scheme == "miwarp",
              url.host == "connect",
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return
        }

        let queryItems = components.queryItems ?? []
        guard let host = queryItems.first(where: { $0.name == "host" })?.value,
              let portStr = queryItems.first(where: { $0.name == "port" })?.value,
              let port = Int(portStr),
              let token = queryItems.first(where: { $0.name == "token" })?.value else {
            return
        }

        let connection = MiWarpConnection(
            name: host,
            host: host,
            port: port,
            isDefault: connectionStore.connections.isEmpty
        )

        do {
            try connectionStore.addConnection(connection, token: token)
            connectionStore.connect(to: connection)
        } catch {
            MiWarpLogger.shared.error("Deep link connection failed: \(error.localizedDescription)")
        }
    }
}

struct RootView: View {
    @ObservedObject var theme: MWTheme
    @ObservedObject var connectionStore: MiWarpConnectionStore
    @Environment(\.colorScheme) private var systemColorScheme

    var body: some View {
        AppRouter()
            .preferredColorScheme(theme.preferredColorScheme)
            .onAppear {
                theme.updateSystemColorScheme(systemColorScheme)
            }
            .onChange(of: systemColorScheme) { _, newValue in
                theme.updateSystemColorScheme(newValue)
            }
    }
}
