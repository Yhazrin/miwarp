import Foundation
#if canImport(CoreSpotlight)
import CoreSpotlight
import UniformTypeIdentifiers
#endif

// MARK: - Spotlight Notification

extension Notification.Name {
    /// Posted when user taps a Spotlight search result to open a specific session.
    static let spotlightSessionOpen = Notification.Name("com.miwarp.spotlightSessionOpen")
}

// MARK: - Spotlight Indexer

#if canImport(CoreSpotlight)
/// Indexes recent MiWarp sessions into CoreSpotlight so users can find them from iOS Spotlight search.
enum SpotlightIndexer {
    private static let domainIdentifier = "com.yhazrin.miwarp.sessions"
    private static let maxSessionsToIndex = 50

    // MARK: - Public API

    /// Index the given sessions into CoreSpotlight. Only the most recent 50 are indexed.
    /// Call this after successfully loading/fetching sessions.
    static func indexSessions(_ sessions: [MiWarpRun]) {
        let recent = sessions
            .sorted { ($0.lastActivity ?? .distantPast) > ($1.lastActivity ?? .distantPast) }
            .prefix(maxSessionsToIndex)

        let items = recent.compactMap { makeSearchableItem(for: $0) }

        guard !items.isEmpty else { return }

        CSSearchableIndex.default().indexSearchableItems(items) { error in
            if let error {
                MiWarpLogger.shared.error("[Spotlight] Failed to index \(items.count) sessions: \(error.localizedDescription)")
            } else {
                MiWarpLogger.shared.info("[Spotlight] Indexed \(items.count) sessions")
            }
        }
    }

    /// Handle an NSUserActivity from CoreSpotlight. Returns true if the activity was handled.
    @discardableResult
    static func handleUserActivity(_ activity: NSUserActivity) -> Bool {
        guard activity.activityType == CSSearchableItemActionType,
              let identifier = activity.userInfo?[CSSearchableItemActivityIdentifier] as? String
        else {
            return false
        }

        // Extract the session ID from our domain-prefixed identifier
        let sessionId = identifier.hasPrefix(domainIdentifier + ".")
            ? String(identifier.dropFirst(domainIdentifier.count + 1))
            : identifier

        guard !sessionId.isEmpty else { return false }

        MiWarpLogger.shared.info("[Spotlight] Opening session from Spotlight: \(sessionId)")
        NotificationCenter.default.post(name: .spotlightSessionOpen, object: sessionId)
        return true
    }

    /// Remove all MiWarp session entries from the Spotlight index.
    static func clearIndex() {
        CSSearchableIndex.default().deleteSearchableItems(withDomainIdentifiers: [domainIdentifier]) { error in
            if let error {
                MiWarpLogger.shared.error("[Spotlight] Failed to clear index: \(error.localizedDescription)")
            } else {
                MiWarpLogger.shared.info("[Spotlight] Index cleared")
            }
        }
    }

    /// Remove a single session from the Spotlight index (e.g. when a session is deleted).
    static func removeSession(id: String) {
        CSSearchableIndex.default().deleteSearchableItems(withIdentifiers: [itemIdentifier(for: id)]) { error in
            if let error {
                MiWarpLogger.shared.error("[Spotlight] Failed to remove session \(id): \(error.localizedDescription)")
            }
        }
    }

    // MARK: - Private Helpers

    private static func itemIdentifier(for sessionId: String) -> String {
        "\(domainIdentifier).\(sessionId)"
    }

    private static func makeSearchableItem(for run: MiWarpRun) -> CSSearchableItem? {
        let attributeSet = CSSearchableItemAttributeSet(itemContentType: UTType.text.identifier)

        // Title: session name or truncated prompt
        attributeSet.title = run.displayTitle

        // Content description: cwd + agent/model + message count
        var descriptionParts: [String] = []
        if !run.cwd.isEmpty {
            descriptionParts.append(run.cwd)
        }
        if !run.agent.isEmpty {
            descriptionParts.append(run.displayAgentModel)
        }
        if let count = run.displayMessageCount {
            descriptionParts.append(count)
        }
        attributeSet.contentDescription = descriptionParts.joined(separator: " · ")

        // Keywords for better search matching
        var keywords: [String] = ["MiWarp", "session"]
        if let name = run.name, !name.isEmpty {
            keywords.append(name)
        }
        if !run.agent.isEmpty {
            keywords.append(run.agent)
        }
        if let model = run.model, !model.isEmpty {
            keywords.append(model)
        }
        if !run.cwd.isEmpty {
            // Add last path components for searchability
            let pathParts = run.cwd.split(separator: "/")
            for part in pathParts.suffix(3) {
                keywords.append(String(part))
            }
        }
        attributeSet.keywords = keywords

        // Metadata
        attributeSet.contentURL = URL(string: "miwarp://session/\(run.id)")
        if let date = run.lastActivity {
            attributeSet.contentModificationDate = date
        }
        if let date = run.createdAt {
            attributeSet.contentCreationDate = date
        }

        let item = CSSearchableItem(
            uniqueIdentifier: itemIdentifier(for: run.id),
            domainIdentifier: domainIdentifier,
            attributeSet: attributeSet
        )
        // Expire after 30 days of no update
        item.expirationDate = Calendar.current.date(byAdding: .day, value: 30, to: Date())
        return item
    }
}
#endif
