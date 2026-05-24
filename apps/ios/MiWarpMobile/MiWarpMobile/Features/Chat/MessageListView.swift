import SwiftUI

struct MessageListView: View {
    let messages: [DisplayMessage]
    let complexityMode: ComplexityMode
    var onApprove: ((String, Bool) -> Void)?

    @State private var scrollProxy: ScrollViewProxy?

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: MWSpacing.sm) {
                    ForEach(messages) { message in
                        messageContent(message)
                            .id(message.id)
                    }
                }
                .padding(.horizontal, MWSpacing.lg)
                .padding(.vertical, MWSpacing.md)
            }
            .onChange(of: messages.count) {
                withAnimation {
                    if let lastId = messages.last?.id {
                        proxy.scrollTo(lastId, anchor: .bottom)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func messageContent(_ message: DisplayMessage) -> some View {
        switch message.role {
        case .user:
            MWChatBubble(role: "user", content: message.content)
        case .assistant:
            assistantContent(message)
        case .system:
            systemMessage(message)
        }
    }

    @ViewBuilder
    private func assistantContent(_ message: DisplayMessage) -> some View {
        VStack(alignment: .leading, spacing: MWSpacing.sm) {
            // Thinking (only in developer mode)
            if complexityMode == .developer || complexityMode == .raw {
                if let thinking = message.thinking, !thinking.isEmpty {
                    DisclosureGroup {
                        Text(thinking)
                            .font(MWTypography.monoSmall())
                            .foregroundColor(MWColors.textTertiary)
                            .textSelection(.enabled)
                    } label: {
                        Label("Thinking", systemImage: "brain")
                            .font(MWTypography.caption())
                            .foregroundColor(MWColors.textTertiary)
                    }
                    .padding(MWSpacing.sm)
                    .background(
                        RoundedRectangle(cornerRadius: MWRadius.sm)
                            .fill(MWColors.bgDeep)
                    )
                }
            }

            // Message content
            if !message.content.isEmpty {
                MWChatBubble(role: "assistant", content: message.content, isStreaming: message.isStreaming)
            }

            // Tool calls
            ForEach(message.toolCalls) { toolCall in
                switch complexityMode {
                case .simple:
                    if toolCall.isComplete && toolCall.isError {
                        Label(toolCall.toolName, systemImage: "exclamationmark.triangle")
                            .font(MWTypography.caption())
                            .foregroundColor(MWColors.statusError)
                    }
                case .focus:
                    if toolCall.isComplete {
                        Label(toolCall.toolName, systemImage: "checkmark.circle")
                            .font(MWTypography.caption())
                            .foregroundColor(MWColors.statusSuccess)
                    } else {
                        Label(toolCall.toolName, systemImage: "arrow.triangle.2.circlepath")
                            .font(MWTypography.caption())
                            .foregroundColor(MWColors.accentCyan)
                    }
                case .developer, .raw:
                    ToolCallCardView(toolCall: toolCall)
                }
            }
        }
    }

    private func systemMessage(_ message: DisplayMessage) -> some View {
        HStack {
            Spacer()
            Text(message.content)
                .font(MWTypography.caption())
                .foregroundColor(MWColors.textTertiary)
                .padding(.horizontal, MWSpacing.md)
                .padding(.vertical, MWSpacing.xs)
                .background(
                    Capsule()
                        .fill(MWColors.bgSurface)
                )
            Spacer()
        }
    }
}
