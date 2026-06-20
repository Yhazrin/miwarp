import Foundation

// MARK: - Run Status

enum RunStatus: String, Codable, CaseIterable {
    case pending
    case running
    case idle
    case waitingApproval = "waiting_approval" // client-only, set by permission_prompt events
    case completed
    case failed
    case stopped

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let raw = try container.decode(String.self)
        self = RunStatus(rawValue: raw) ?? .pending
    }

    var displayLabel: String {
        switch self {
        case .pending: return String(localized: "runStatus.pending")
        case .running: return String(localized: "runStatus.running")
        case .idle: return String(localized: "runStatus.idle")
        case .waitingApproval: return String(localized: "runStatus.waitingApproval")
        case .completed: return String(localized: "runStatus.completed")
        case .failed: return String(localized: "runStatus.failed")
        case .stopped: return String(localized: "runStatus.stopped")
        }
    }

    var systemImage: String {
        switch self {
        case .pending: return "clock.circle.fill"
        case .running: return "play.circle.fill"
        case .idle: return "moon.circle.fill"
        case .waitingApproval: return "exclamationmark.shield.fill"
        case .completed: return "checkmark.circle.fill"
        case .failed: return "xmark.circle.fill"
        case .stopped: return "stop.circle.fill"
        }
    }
}

// MARK: - Run Source

enum RunSource: String, Codable {
    case native
    case cliImport = "cli_import"
    case unknown

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let raw = try container.decode(String.self)
        self = RunSource(rawValue: raw) ?? .unknown
    }
}

// MARK: - MiWarp Run

struct MiWarpRun: Identifiable, Codable, Hashable {
    let id: String
    var name: String?
    var prompt: String?
    var cwd: String
    var agent: String
    var model: String?
    var status: RunStatus
    var source: RunSource?
    var messageCount: Int?
    var lastActivityAt: String?
    var startedAt: String?

    private static let isoFormatterWithFractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private static let isoFormatterPlain: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    private static func parseDate(_ string: String) -> Date? {
        MiWarpRun.isoFormatterWithFractional.date(from: string)
            ?? MiWarpRun.isoFormatterPlain.date(from: string)
    }

    var lastActivity: Date? {
        lastActivityAt.flatMap { MiWarpRun.parseDate($0) }
    }
    var createdAt: Date? {
        startedAt.flatMap { MiWarpRun.parseDate($0) }
    }

    enum CodingKeys: String, CodingKey {
        case id, name, prompt, cwd, agent, model, status, source
        case messageCount = "message_count"
        case lastActivityAt = "last_activity_at"
        case startedAt = "started_at"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        id = try container.decode(String.self, forKey: .id)
        name = try container.decodeIfPresent(String.self, forKey: .name)
        prompt = try container.decodeIfPresent(String.self, forKey: .prompt)
        cwd = try container.decodeIfPresent(String.self, forKey: .cwd) ?? ""
        agent = try container.decodeIfPresent(String.self, forKey: .agent) ?? ""
        model = try container.decodeIfPresent(String.self, forKey: .model) ?? ""
        status = try container.decodeIfPresent(RunStatus.self, forKey: .status) ?? .pending
        source = try container.decodeIfPresent(RunSource.self, forKey: .source) ?? .unknown
        messageCount = try container.decodeIfPresent(Int.self, forKey: .messageCount) ?? 0
        lastActivityAt = try container.decodeIfPresent(String.self, forKey: .lastActivityAt)
        startedAt = try container.decodeIfPresent(String.self, forKey: .startedAt)
    }

    init(
        id: String,
        name: String? = nil,
        prompt: String? = nil,
        cwd: String = "",
        agent: String = "",
        model: String? = nil,
        status: RunStatus = .pending,
        source: RunSource? = nil,
        messageCount: Int? = nil,
        lastActivityAt: String? = nil,
        startedAt: String? = nil
    ) {
        self.id = id
        self.name = name
        self.prompt = prompt
        self.cwd = cwd
        self.agent = agent
        self.model = model
        self.status = status
        self.source = source
        self.messageCount = messageCount
        self.lastActivityAt = lastActivityAt
        self.startedAt = startedAt
    }

    var displayTitle: String {
        name ?? prompt?.prefix(80).description ?? "Untitled Session"
    }

    var shortCwd: String {
        let components = cwd.split(separator: "/")
        if components.count <= 2 { return cwd }
        return ".../" + components.suffix(2).joined(separator: "/")
    }

    // MARK: - Display Formatters

    /// Agent and model display string. Model is optional.
    /// e.g. "Claude · MiniMax-M2.7 Highspeed" or "Claude" if no model
    var displayAgentModel: String {
        if let model = model, !model.isEmpty {
            return "\(agent) · \(model)"
        }
        return agent
    }

    /// Short cwd for display in list rows.
    var displayCwd: String? {
        guard !cwd.isEmpty else { return nil }
        return shortCwd
    }

    /// Message count formatted for display.
    /// e.g. "60 messages" or hidden if count is 0/nil
    var displayMessageCount: String? {
        guard let count = messageCount, count > 0 else { return nil }
        if count == 1 { return "1 message" }
        return "\(count) messages"
    }

    private static let relativeFormatter: RelativeDateTimeFormatter = {
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .abbreviated
        return f
    }()

    /// Relative time string for display.
    /// e.g. "11h ago", "2d ago", "Just now"
    var displayRelativeTime: String? {
        guard let date = lastActivity else { return nil }
        return MiWarpRun.relativeFormatter.localizedString(for: date, relativeTo: Date())
    }

    /// Whether this run has any metadata to display in list rows.
    var hasMetadata: Bool {
        displayCwd != nil || displayMessageCount != nil
    }
}
