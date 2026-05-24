import SwiftUI

struct MessageBubbleView: View {
    let message: DisplayMessage

    var body: some View {
        MWChatBubble(
            role: message.role == .user ? "user" : "assistant",
            content: message.content,
            isStreaming: message.isStreaming
        )
    }
}
