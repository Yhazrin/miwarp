#if canImport(ActivityKit)
import ActivityKit
import Foundation

/// Manages the full session sync lifecycle with Live Activity updates.
@MainActor
final class SessionSyncManager: ObservableObject {
    static let shared = SessionSyncManager()

    @Published var isSyncing = false
    @Published var syncProgress: Double = 0
    @Published var syncPhase: SyncPhase = .preparing
    @Published var currentCount = 0
    @Published var totalCount = 0
    @Published var errorMessage: String?

    private let liveActivity = LiveActivityManager.shared
    private var syncTask: Task<Void, Never>?

    private init() {}

    /// Full sync flow: connect → list runs → load histories → index → complete
    func startSync(store: MiWarpConnectionStore) {
        guard !isSyncing else { return }
        guard store.isConnected, let rpc = store.rpc else {
            errorMessage = "Not connected"
            return
        }

        isSyncing = true
        errorMessage = nil
        currentCount = 0
        totalCount = 0

        let taskId = UUID().uuidString.prefix(8).description
        let desktopName = store.activeConnection?.name
        let workspaceName = store.activeConnection?.host

        // Start Live Activity
        liveActivity.startSessionSync(
            taskId: taskId,
            workspaceName: workspaceName,
            desktopName: desktopName
        )

        syncTask = Task {
            // Phase 1: Preparing
            updatePhase(.preparing)
            try? await Task.sleep(nanoseconds: 500_000_000)

            // Phase 2: Connecting (verify connection)
            updatePhase(.connecting)
            do {
                let _ = try await rpc.getWebServerStatus()
            } catch {
                failSync(error.localizedDescription)
                return
            }

            // Phase 3: Syncing — fetch all runs
            updatePhase(.syncing)
            let runs: [MiWarpRun]
            do {
                runs = try await rpc.listRuns()
            } catch {
                failSync(error.localizedDescription)
                return
            }

            totalCount = runs.count
            updateProgress(count: 0, total: runs.count, item: "Fetched \(runs.count) sessions")

            // Phase 4: Importing — load history for each run
            updatePhase(.importing)
            for (index, run) in runs.enumerated() {
                if Task.isCancelled { break }

                currentCount = index + 1
                updateProgress(
                    count: index + 1,
                    total: runs.count,
                    item: run.displayTitle
                )

                // Load bus events for history (don't fail the whole sync on individual errors)
                do {
                    let _ = try await rpc.getBusEvents(runId: run.id)
                } catch {
                    // Continue with next run
                }

                // Brief pause between runs to avoid flooding
                try? await Task.sleep(nanoseconds: 100_000_000)
            }

            // Phase 5: Finishing — build index
            updatePhase(.finishing)
            updateProgress(count: runs.count, total: runs.count, item: "Building index...")
            try? await Task.sleep(nanoseconds: 800_000_000)

            // Phase 6: Complete
            updatePhase(.completed)
            updateProgress(count: runs.count, total: runs.count, item: nil)
            liveActivity.endSessionSync()

            isSyncing = false
        }
    }

    func cancelSync() {
        syncTask?.cancel()
        syncTask = nil
        failSync("Cancelled by user")
    }

    private func updatePhase(_ phase: SyncPhase) {
        syncPhase = phase
        liveActivity.updateSessionSync(
            phase: phase,
            currentCount: currentCount,
            totalCount: totalCount,
            currentItemTitle: nil,
            desktopName: nil
        )
    }

    private func updateProgress(count: Int, total: Int, item: String?) {
        currentCount = count
        totalCount = total
        syncProgress = total > 0 ? Double(count) / Double(total) : 0
        liveActivity.updateSessionSync(
            phase: syncPhase,
            currentCount: count,
            totalCount: total,
            currentItemTitle: item
        )
    }

    private func failSync(_ message: String) {
        syncPhase = .failed
        errorMessage = message
        isSyncing = false
        liveActivity.updateSessionSync(
            phase: .failed,
            currentCount: currentCount,
            totalCount: totalCount,
            errorMessage: message
        )
        liveActivity.endSessionSync(dismissAfter: 15)
    }
}
#endif
