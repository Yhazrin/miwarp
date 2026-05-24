import SwiftUI

struct ToolCallCardView: View {
    let toolCall: DisplayToolCall
    @State private var isExpanded: Bool

    init(toolCall: DisplayToolCall) {
        self.toolCall = toolCall
        _isExpanded = State(initialValue: toolCall.isExpanded)
    }

    var body: some View {
        MWToolCallCard(
            toolName: toolCall.toolName,
            inputPreview: toolCall.inputPreview,
            output: toolCall.output,
            isExpanded: isExpanded
        ) {
            isExpanded.toggle()
        }
    }
}
