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
                        Section("Files Changed") {
                            ForEach(artifacts.filesChanged, id: \.self) { path in
                                Label(path, systemImage: "doc")
                                    .font(.caption.monospaced())
                                    .foregroundStyle(.secondary)
                                    .textSelection(.enabled)
                            }
                        }
                    }

                    if !artifacts.commands.isEmpty {
                        Section("Commands") {
                            ForEach(artifacts.commands, id: \.self) { command in
                                Text(command)
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
                                    .foregroundStyle(.orange)
                            }
                        }
                    }
                }
                .listStyle(.insetGrouped)
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
