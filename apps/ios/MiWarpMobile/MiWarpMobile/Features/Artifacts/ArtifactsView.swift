import SwiftUI

struct ArtifactsView: View {
    let runId: String
    @EnvironmentObject private var store: MiWarpConnectionStore
    @State private var artifacts: RunArtifacts?
    @State private var isLoading = false
    @State private var error: String?

    var body: some View {
        Group {
            if isLoading {
                ContentUnavailableView {
                    Label("Loading Artifacts", systemImage: "arrow.clockwise")
                }
            } else if let error {
                ContentUnavailableView {
                    Label("Cannot Load Artifacts", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(error)
                } actions: {
                    Button("Retry") {
                        Task { await loadArtifacts() }
                    }
                    .buttonStyle(.bordered)
                }
            } else if let artifacts {
                List {
                    if !artifacts.filesChanged.isEmpty {
                        Section("Files Changed (\(artifacts.filesChanged.count))") {
                            ForEach(artifacts.filesChanged, id: \.self) { path in
                                Label {
                                    Text(path)
                                        .font(.caption.monospaced())
                                        .foregroundStyle(.secondary)
                                        .textSelection(.enabled)
                                } icon: {
                                    Image(systemName: pathIcon(path))
                                        .foregroundStyle(MWColors.accentPrimary)
                                }
                            }
                        }
                    }

                    if !artifacts.commands.isEmpty {
                        Section("Commands (\(artifacts.commands.count))") {
                            ForEach(artifacts.commands, id: \.self) { command in
                                Label(command, systemImage: "terminal")
                                    .font(.caption.monospaced())
                                    .foregroundStyle(.secondary)
                                    .textSelection(.enabled)
                            }
                        }
                    }

                    if !artifacts.diffSummary.isEmpty {
                        Section("Diff Summary") {
                            DiffPreviewView(diff: artifacts.diffSummary)
                        }
                    }

                    if let cost = artifacts.costEstimate {
                        Section("Cost") {
                            LabeledContent("Estimated cost") {
                                Text(String(format: "$%.4f", cost))
                                    .font(.body.monospaced())
                                    .foregroundStyle(MWColors.statusWarning)
                            }
                        }
                    }
                }
                .listStyle(.insetGrouped)
                .scrollContentBackground(.hidden)
                .background(MWPatternedBackdrop())
            } else {
                ContentUnavailableView {
                    Label("No Artifacts", systemImage: "archivebox")
                } description: {
                    Text("This session has no artifacts yet")
                }
            }
        }
        .navigationTitle("Artifacts")
        .task {
            await loadArtifacts()
        }
    }

    private func pathIcon(_ path: String) -> String {
        let ext = (path as NSString).pathExtension.lowercased()
        switch ext {
        case "swift": return "swift"
        case "rs": return "rust"
        case "py": return "text.justify.left"
        case "js", "ts": return "text.justify.left"
        case "json": return "curlybraces"
        case "md": return "doc.text"
        case "toml", "yaml", "yml": return "doc.plaintext"
        case "html", "css": return "globe"
        case "sh", "bash", "zsh": return "terminal"
        default: return "doc"
        }
    }

    private func loadArtifacts() async {
        guard let rpc = store.rpc else {
            error = "Not connected"
            return
        }

        isLoading = true
        error = nil

        do {
            artifacts = try await rpc.getRunArtifacts(id: runId)
        } catch {
            self.error = error.localizedDescription
        }

        isLoading = false
    }
}
