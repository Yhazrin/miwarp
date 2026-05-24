import SwiftUI

struct SessionListView: View {
    let runs: [MiWarpRun]
    var onSelected: (MiWarpRun) -> Void

    var body: some View {
        ForEach(runs) { run in
            SessionCardView(run: run) {
                onSelected(run)
            }
        }
    }
}
