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
                MWLoadingState(message: "Loading artifacts...")
            } else if let error {
                MWErrorState(message: error) {
                    Task { await loadArtifacts() }
                }
            } else if let artifacts {
                List {
                    if let files = artifacts.filesChanged, !files.isEmpty {
                        Section("Files Changed") {
                            ForEach(files) { file in
                                MWDiffFileRow(
                                    path: file.path,
                                    status: file.status,
                                    additions: file.additions,
                                    deletions: file.deletions
                                )
                            }
                        }
                    }

                    if let commands = artifacts.commands, !commands.isEmpty {
                        Section("Commands") {
                            ForEach(commands, id: \.self) { command in
                                Text(command)
                                    .font(MWTypography.monoCaption())
                                    .foregroundColor(MWColors.textSecondary)
                                    .textSelection(.enabled)
                            }
                        }
                    }

                    if let diff = artifacts.diffSummary, !diff.isEmpty {
                        Section("Diff Summary") {
                            DiffPreviewView(diff: diff)
                        }
                    }

                    if let cost = artifacts.costEstimate {
                        Section("Cost") {
                            HStack {
                                Text("Estimated cost")
                                    .foregroundColor(MWColors.textSecondary)
                                Spacer()
                                Text(String(format: "$%.4f", cost))
                                    .font(MWTypography.monoBody())
                                    .foregroundColor(MWColors.statusWarning)
                            }
                        }
                    }
                }
            } else {
                MWEmptyState(
                    icon: "archivebox",
                    title: "No Artifacts",
                    message: "This session has no artifacts yet"
                )
            }
        }
        .background(MWColors.bgDeepest)
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
