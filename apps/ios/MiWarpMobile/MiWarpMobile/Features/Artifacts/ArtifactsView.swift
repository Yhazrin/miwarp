import SwiftUI

struct ArtifactsView: View {
    let runId: String
    @EnvironmentObject private var store: MiWarpConnectionStore
    @EnvironmentObject private var theme: MWTheme
    @State private var artifacts: RunArtifacts?
    @State private var isLoading = false
    @State private var error: String?

    var body: some View {
        Group {
            if isLoading {
                ContentUnavailableView {
                    Label(String(localized: "artifacts.loading"), systemImage: "arrow.clockwise")
                }
            } else if let error {
                ContentUnavailableView {
                    Label(String(localized: "artifacts.cannotLoad"), systemImage: "exclamationmark.triangle")
                } description: {
                    Text(error)
                } actions: {
                    Button(String(localized: "action.retry")) {
                        Task { await loadArtifacts() }
                    }
                    .buttonStyle(.bordered)
                }
            } else if let artifacts {
                List {
                    if !artifacts.filesChanged.isEmpty {
                        Section(String(format: String(localized: "artifacts.filesChanged"), artifacts.filesChanged.count)) {
                            ForEach(artifacts.filesChanged, id: \.self) { path in
                                Label {
                                    Text(path)
                                        .font(MWTypography.monoCaption())
                                        .foregroundStyle(theme.cardTextSecondary)
                                        .textSelection(.enabled)
                                } icon: {
                                    Image(systemName: pathIcon(path))
                                        .foregroundStyle(MWColors.accentPrimary)
                                }
                                .swipeActions(edge: .trailing) {
                                    Button {
                                        MiHaptics.lightImpact()
                                        UIPasteboard.general.string = path
                                    } label: {
                                        Label(String(localized: "action.copyPath"), systemImage: "doc.on.doc")
                                    }
                                    .tint(MWColors.accentPrimary)

                                    ShareLink(item: path) {
                                        Label(String(localized: "action.share"), systemImage: "square.and.arrow.up")
                                    }
                                    .tint(MWColors.statusSuccess)
                                }
                            }
                        }
                    }

                    if !artifacts.commands.isEmpty {
                        Section(String(format: String(localized: "artifacts.commands"), artifacts.commands.count)) {
                            ForEach(artifacts.commands, id: \.self) { command in
                                Label(command, systemImage: "terminal")
                                    .font(MWTypography.monoCaption())
                                    .foregroundStyle(theme.cardTextSecondary)
                                    .textSelection(.enabled)
                                    .swipeActions(edge: .trailing) {
                                        Button {
                                            MiHaptics.lightImpact()
                                            UIPasteboard.general.string = command
                                        } label: {
                                            Label(String(localized: "action.copyPath"), systemImage: "doc.on.doc")
                                        }
                                        .tint(MWColors.accentPrimary)
                                    }
                            }
                        }
                    }

                    if !artifacts.diffSummary.isEmpty {
                        Section(String(localized: "artifacts.diffSummary")) {
                            DiffPreviewView(diff: artifacts.diffSummary)
                        }
                    }

                    if let cost = artifacts.costEstimate {
                        Section(String(localized: "artifacts.cost")) {
                            LabeledContent(String(localized: "artifacts.estimatedCost")) {
                                Text(String(format: "$%.4f", cost))
                                    .font(MWTypography.monoBody())
                                    .foregroundStyle(MWColors.statusWarning)
                            }
                        }
                    }
                }
                .listStyle(.insetGrouped)
                .scrollContentBackground(.hidden)
                .background(MWPatternedBackdrop())
                .refreshable {
                    await loadArtifacts()
                }
            } else {
                ContentUnavailableView {
                    Label(String(localized: "artifacts.noArtifacts"), systemImage: "archivebox")
                } description: {
                    Text(String(localized: "artifacts.empty"))
                }
            }
        }
        .navigationTitle(String(localized: "artifacts.title"))
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
            error = String(localized: "error.notConnected")
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
