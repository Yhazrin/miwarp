import SwiftUI

struct ToolCallCardView: View {
    let toolCall: DisplayToolCall

    var body: some View {
        ToolCallDisclosureView(toolCall: toolCall)
    }
}
