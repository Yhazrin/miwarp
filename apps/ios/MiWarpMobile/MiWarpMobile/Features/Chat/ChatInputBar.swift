import SwiftUI

struct ChatInputBar: View {
    @Binding var text: String
    var isRunning: Bool = false
    var canSend: Bool = true
    var onSend: (() -> Void)?
    var onStop: (() -> Void)?
    var onFork: (() -> Void)?

    var body: some View {
        MWInputBar(
            text: $text,
            isRunning: isRunning,
            canSend: canSend,
            onSend: onSend,
            onStop: onStop,
            onFork: onFork
        )
    }
}
