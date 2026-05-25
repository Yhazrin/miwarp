import Foundation

enum LiveActivityDeepLink {
    static let scheme = "miwarp"

    /// Deep link to open a sync task's details
    static func sync(taskId: String) -> URL? {
        URL(string: "\(scheme)://live-activity/sync?taskId=\(taskId)")
    }

    /// Deep link to open an agent task's details
    static func agent(taskId: String) -> URL? {
        URL(string: "\(scheme)://live-activity/agent?taskId=\(taskId)")
    }

    /// Deep link to open sessions list
    static func sessions: URL? {
        URL(string: "\(scheme)://sessions")
    }

    /// Parse incoming deep link from Live Activity
    static func parse(_ url: URL) -> ParsedDeepLink? {
        guard url.scheme == scheme else { return nil }
        let host = url.host() ?? ""
        let path = url.path()
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let queryItems = components?.queryItems ?? []

        switch host {
        case "live-activity":
            if path.hasPrefix("/sync"), let taskId = queryItems.first(where: { $0.name == "taskId" })?.value {
                return .sync(taskId: taskId)
            }
            if path.hasPrefix("/agent"), let taskId = queryItems.first(where: { $0.name == "taskId" })?.value {
                return .agent(taskId: taskId)
            }
            return nil
        case "sessions":
            return .sessions
        default:
            return nil
        }
    }

    enum ParsedDeepLink: Equatable {
        case sync(taskId: String)
        case agent(taskId: String)
        case sessions
    }
}
