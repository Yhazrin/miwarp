import SwiftUI

struct MessageListView: View {
    let messages: [DisplayMessage]
    let complexityMode: ComplexityMode
    var inputBarHeight: CGFloat = 60
    var onApprove: ((String, Bool) -> Void)?

    @EnvironmentObject private var theme: MWTheme

    var body: some View {
        MWAdaptiveReader { layout in
            content(layout: layout)
        }
    }

    private func content(layout: MWAdaptiveLayout) -> some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 10) {
                    ForEach(messages) { message in
                        messageContent(message, layout: layout)
                            .id(message.id)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .padding(.bottom, inputBarHeight + 16)
                .frame(maxWidth: layout.chatContentMaxWidth)
                .frame(maxWidth: .infinity)
            }
            .background(MWPatternedBackdrop())
            .onChange(of: messages.count) { _, _ in
                scrollToBottom(proxy: proxy)
            }
            .onChange(of: messages.last?.content) { _, _ in
                scrollToBottom(proxy: proxy)
            }
            .onChange(of: messages.last?.isStreaming) { _, _ in
                scrollToBottom(proxy: proxy)
            }
        }
    }

    private func scrollToBottom(proxy: ScrollViewProxy) {
        guard let lastId = messages.last?.id else { return }
        withAnimation(.spring(duration: 0.4, bounce: 0.2)) {
            proxy.scrollTo(lastId, anchor: .bottom)
        }
    }

    @ViewBuilder
    private func messageContent(_ message: DisplayMessage, layout: MWAdaptiveLayout) -> some View {
        switch message.role {
        case .user:
            userBubble(message.content, layout: layout)
        case .assistant:
            assistantContent(message, layout: layout)
        case .system:
            systemMessage(message.content)
        }
    }

    // MARK: - User Bubble

    private func userBubble(_ content: String, layout: MWAdaptiveLayout) -> some View {
        HStack {
            Spacer(minLength: 48)
            Text(content)
                .font(.body)
                .foregroundStyle(.white)
                .textSelection(.enabled)
                .frame(maxWidth: layout.chatUserBubbleMaxWidth, alignment: .leading)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(.tint, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
    }

    // MARK: - Assistant Content

    @ViewBuilder
    private func assistantContent(_ message: DisplayMessage, layout: MWAdaptiveLayout) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            // Thinking (developer/raw mode only)
            if complexityMode == .developer || complexityMode == .raw {
                if let thinking = message.thinking, !thinking.isEmpty {
                    DisclosureGroup {
                        Text(thinking)
                            .font(.caption.monospaced())
                            .foregroundStyle(theme.cardTextTertiary)
                            .textSelection(.enabled)
                    } label: {
                        Label(String(localized: "chat.thinking"), systemImage: "brain")
                            .font(.caption)
                            .foregroundStyle(theme.cardTextTertiary)
                    }
                    .padding(10)
                    .frame(maxWidth: layout.chatAssistantBubbleMaxWidth, alignment: .leading)
                    .background(.quaternary, in: RoundedRectangle(cornerRadius: 8))
                }
            }

            // Message content
            if !message.content.isEmpty {
                assistantBubble(message.content, isStreaming: message.isStreaming, layout: layout)
            }

            // Tool calls
            ForEach(message.toolCalls) { toolCall in
                toolCallInline(toolCall, layout: layout)
            }
        }
        .frame(maxWidth: layout.chatAssistantBubbleMaxWidth, alignment: .leading)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func assistantBubble(_ content: String, isStreaming: Bool, layout: MWAdaptiveLayout) -> some View {
        HStack(spacing: 8) {
            Text(content)
                .font(.body)
                .foregroundStyle(theme.cardTextPrimary)
                .textSelection(.enabled)
                .frame(maxWidth: layout.chatAssistantBubbleMaxWidth, alignment: .leading)

            if isStreaming {
                ProgressView()
                    .scaleEffect(0.7)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(theme.cardBg, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    // MARK: - Tool Call

    @ViewBuilder
    private func toolCallInline(_ toolCall: DisplayToolCall, layout: MWAdaptiveLayout) -> some View {
        switch complexityMode {
        case .simple:
            if toolCall.isComplete && toolCall.isError {
                Label(toolCall.toolName, systemImage: "exclamationmark.triangle")
                    .font(.caption)
                    .foregroundStyle(MWColors.statusError)
            }

        case .focus:
            Label {
                Text(toolCall.toolName)
                    .font(.caption.monospaced())
            } icon: {
                Image(systemName: toolCall.isError ? "xmark.circle.fill" : (toolCall.isComplete ? "checkmark.circle.fill" : "arrow.triangle.2.circlepath"))
                    .foregroundStyle(toolCall.isError ? MWColors.statusError : (toolCall.isComplete ? MWColors.statusSuccess : MWColors.accentPrimary))
            }
            .font(.caption)
            .foregroundStyle(theme.cardTextSecondary)

        case .developer, .raw:
            ToolCallDisclosureView(toolCall: toolCall)
                .frame(maxWidth: layout.chatAssistantBubbleMaxWidth, alignment: .leading)
        }
    }

    // MARK: - System Message

    private func systemMessage(_ content: String) -> some View {
        HStack {
            Spacer()
            Text(content)
                .font(.caption)
                .foregroundStyle(theme.cardTextTertiary)
                .padding(.horizontal, 12)
                .padding(.vertical, 4)
                .background(.quaternary, in: Capsule())
            Spacer()
        }
    }
}

// MARK: - Tool Call Disclosure (native)

struct ToolCallDisclosureView: View {
    let toolCall: DisplayToolCall
    @State private var isExpanded = false
    @EnvironmentObject private var theme: MWTheme

    var body: some View {
        DisclosureGroup(isExpanded: $isExpanded) {
            VStack(alignment: .leading, spacing: 8) {
                if let input = toolCall.inputPreview, !input.isEmpty {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(String(localized: "chat.toolInput"))
                            .font(.caption2.weight(.medium))
                            .foregroundStyle(theme.cardTextTertiary)
                        Text(input)
                            .font(.caption.monospaced())
                            .foregroundStyle(theme.cardTextSecondary)
                            .textSelection(.enabled)
                    }
                }

                if let output = toolCall.output, !output.isEmpty {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(String(localized: "chat.toolOutput"))
                            .font(.caption2.weight(.medium))
                            .foregroundStyle(theme.cardTextTertiary)
                        Text(output)
                            .font(.caption.monospaced())
                            .foregroundStyle(toolCall.isError ? MWColors.statusError : theme.cardTextSecondary)
                            .lineLimit(15)
                            .textSelection(.enabled)
                    }
                }
            }
            .padding(.top, 4)
        } label: {
            HStack(spacing: 6) {
                Image(systemName: toolCall.isError ? "xmark.circle.fill" : (toolCall.isComplete ? "checkmark.circle.fill" : "arrow.triangle.2.circlepath"))
                    .font(.system(size: 12))
                    .foregroundStyle(toolCall.isError ? MWColors.statusError : (toolCall.isComplete ? MWColors.statusSuccess : MWColors.accentPrimary))

                Text(toolCall.toolName)
                    .font(.caption.monospaced())
                    .foregroundStyle(MWColors.accentPrimary)

                if !toolCall.isComplete && !toolCall.isError {
                    ProgressView()
                        .scaleEffect(0.6)
                }
            }
        }
        .padding(10)
        .background(MWColors.bgElevated, in: RoundedRectangle(cornerRadius: 8))
    }
}
