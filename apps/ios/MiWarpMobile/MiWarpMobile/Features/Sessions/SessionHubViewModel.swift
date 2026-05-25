import Foundation
import SwiftUI

@MainActor
final class SessionHubViewModel: ObservableObject {
    @Published var runs: [MiWarpRun] = []
    @Published var isLoading = false
    @Published var error: String?
    @Published var searchText = ""
    @Published var showFilters = false

    private weak var store: MiWarpConnectionStore?

    var filteredRuns: [MiWarpRun] {
        runs.filter { run in
            if !searchText.isEmpty {
                let query = searchText.lowercased()
                let matchesSearch = (run.displayTitle.lowercased().contains(query)) ||
                    (run.cwd.lowercased().contains(query)) ||
                    (run.model?.lowercased().contains(query) ?? false)
                if !matchesSearch { return false }
            }
            return true
        }
    }

    func attach(store: MiWarpConnectionStore) {
        self.store = store
    }

    func loadRuns() async {
        guard store?.isConnected == true, let rpc = store?.rpc else {
            if runs.isEmpty {
                error = "Not connected"
            }
            return
        }

        isLoading = true
        error = nil

        do {
            runs = try await rpc.listRuns()
        } catch {
            self.error = error.localizedDescription
        }

        isLoading = false
    }
}
