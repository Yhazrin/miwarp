import Foundation

// MARK: - Artifacts & Git

struct RunArtifacts: Codable {
    let taskId: String
    let filesChanged: [String]
    let diffSummary: String
    let commands: [String]
    let costEstimate: Double?
    let updatedAt: String

    enum CodingKeys: String, CodingKey {
        case taskId = "task_id"
        case filesChanged = "files_changed"
        case diffSummary = "diff_summary"
        case commands
        case costEstimate = "cost_estimate"
        case updatedAt = "updated_at"
    }
}

struct GitStatus: Codable {
    let branch: String?
    let ahead: Int?
    let behind: Int?
    let dirty: Bool?
    let files: [GitFileStatus]?
}

struct GitFileStatus: Identifiable, Codable {
    let path: String
    let status: String

    var id: String { path }
}

struct GitDiff: Codable {
    let diff: String?
    let files: [String]?
}
