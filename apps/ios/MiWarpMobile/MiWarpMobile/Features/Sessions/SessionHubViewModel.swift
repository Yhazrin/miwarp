import Foundation
import SwiftUI

@MainActor
final class SessionHubViewModel: ObservableObject {
    @Published var runs: [MiWarpRun] = []
    @Published var isLoading = false
    @Published var error: String?
    @Published var searchText = ""
    @Published var showFilters = false
    @Published var filters = SessionFilters()

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
            if let agent = filters.agent, run.agent != agent { return false }
            if let status = filters.status, run.status != status { return false }
            if let source = filters.source, (run.source ?? .unknown) != source { return false }
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

struct SessionFilters {
    var agent: String?
    var status: RunStatus?
    var source: RunSource?

    var isActive: Bool {
        agent != nil || status != nil || source != nil
    }

    mutating func reset() {
        agent = nil
        status = nil
        source = nil
    }
}
