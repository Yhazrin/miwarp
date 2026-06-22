import Foundation
import SwiftUI

@MainActor
final class ChatViewModel: ObservableObject {
    let runId: String
    let reducer = MiWarpEventReducer()

    @Published var inputText = ""
    @Published var isLoading = true
    @Published var error: String?
    @Published var complexityMode: ComplexityMode = .developer
    @Published var showRawEvents = false
    @Published var showArtifacts = false
    @Published var rawEvents: [BusEvent] = []
    @Published private(set) var queuedMessageCount = 0

    private let maxRawEvents = 1000
    private var queuedMessages: [String] = []
    private var isFlushingQueue = false

    private weak var store: MiWarpConnectionStore?

    init(runId: String) {
        self.runId = runId
    }

    func attach(store: MiWarpConnectionStore) {
        self.store = store
    }

    // MARK: - Load History

    func loadHistory() async {
        guard store?.isConnected == true, let rpc = store?.rpc else {
            error = String(localized: "error.notConnected")
            isLoading = false
            return
        }

        isLoading = true
        error = nil

        do {
            let events = try await rpc.getBusEvents(runId: runId)
            rawEvents = events
            reducer.loadHistory(events)
            reducer.clearProtocolRecoveryNotice()
        } catch {
            self.error = error.localizedDescription
        }

        isLoading = false
    }

    // MARK: - Subscribe

    func subscribeToEvents() async {
        guard let rpc = store?.rpc else { return }

        do {
            try await rpc.subscribe(runId: runId, lastSeq: reducer.lastSeq)
            await flushQueuedMessages()
        } catch {
            MiWarpLogger.shared.error("Subscribe failed: \(error.localizedDescription)")
        }

        while !Task.isCancelled {
            guard let wsClient = store?.wsClient else {
                try? await Task.sleep(nanoseconds: 500_000_000)
                continue
            }
            for await event in wsClient.eventStream {
                if Task.isCancelled { return }
                guard event.runId == runId else { continue }
                rawEvents.append(event)
                if rawEvents.count > maxRawEvents {
                    rawEvents.removeFirst(rawEvents.count - maxRawEvents)
                }
                reducer.processEvent(event)
            }
            if Task.isCancelled { break }
            try? await Task.sleep(nanoseconds: 500_000_000)
            guard !Task.isCancelled, store?.isConnected == true, let rpc = store?.rpc else { continue }
            do {
                try await rpc.subscribe(runId: runId, lastSeq: reducer.lastSeq)
                await flushQueuedMessages()
            } catch {
                MiWarpLogger.shared.error("Re-subscribe failed: \(error.localizedDescription)")
            }
        }
    }

    // MARK: - Send Message

    func sendMessage() async {
        guard let rpc = store?.rpc, !inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return
        }

        let message = inputText
        inputText = ""

        guard store?.isConnected == true else {
            enqueueMessage(message)
            return
        }

        do {
            try await rpc.sendMessage(runId: runId, message: message)
        } catch {
            if store?.isConnected == true {
                inputText = message
                self.error = String(format: String(localized: "error.failedToSend"), error.localizedDescription)
            } else {
                enqueueMessage(message)
            }
        }
    }

    private func enqueueMessage(_ message: String) {
        queuedMessages.append(message)
        queuedMessageCount = queuedMessages.count
        error = nil
        MiWarpLogger.shared.info("Queued mobile message for run \(runId)")
    }

    private func flushQueuedMessages() async {
        guard !isFlushingQueue, store?.isConnected == true, let rpc = store?.rpc else { return }
        isFlushingQueue = true
        defer { isFlushingQueue = false }

        while !queuedMessages.isEmpty {
            let message = queuedMessages[0]
            do {
                try await rpc.sendMessage(runId: runId, message: message)
                queuedMessages.removeFirst()
                queuedMessageCount = queuedMessages.count
            } catch {
                if store?.isConnected != true {
                    return
                }
                self.error = String(format: String(localized: "error.failedToSend"), error.localizedDescription)
                return
            }
        }
    }

    // MARK: - Stop / Fork

    func stopSession() async {
        guard let rpc = store?.rpc else { return }
        do {
            try await rpc.stopSession(runId: runId)
        } catch {
            self.error = String(format: String(localized: "error.failedToStop"), error.localizedDescription)
        }
    }

    func forkSession() async {
        guard let rpc = store?.rpc else { return }
        do {
            let newRunId = try await rpc.forkSession(runId: runId)
            MiWarpLogger.shared.info("Forked session: \(newRunId)")
        } catch {
            self.error = String(format: String(localized: "error.failedToFork"), error.localizedDescription)
        }
    }

    // MARK: - Permissions

    func handlePermission(requestId: String, approved: Bool) async {
        guard let rpc = store?.rpc else { return }
        do {
            try await rpc.respondPermission(
                runId: runId,
                requestId: requestId,
                behavior: approved ? "allow" : "deny",
                denyMessage: approved ? nil : "Denied from mobile"
            )
            reducer.removePermission(requestId: requestId)
        } catch {
            self.error = String(format: String(localized: "error.permissionResponseFailed"), error.localizedDescription)
        }
    }

    // MARK: - Formatting

    func formatTokens(_ count: Int) -> String {
        if count >= 1_000_000 {
            return String(format: "%.1fM", Double(count) / 1_000_000)
        } else if count >= 1_000 {
            return String(format: "%.1fK", Double(count) / 1_000)
        }
        return "\(count)"
    }
}
