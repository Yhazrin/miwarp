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
                LazyVStack(spacing: MWSpacing.sm) {
                    ForEach(messages) { message in
                        messageContent(message, layout: layout)
                            .id(message.id)
                    }
                }
                .padding(.horizontal, MWSpacing.lg)
                .padding(.vertical, MWSpacing.md)
                .padding(.bottom, inputBarHeight + MWSpacing.lg)
                .frame(maxWidth: layout.chatContentMaxWidth)
                .frame(maxWidth: .infinity)
            }
            .background(MWPatternedBackdrop())
            .onChange(of: messages.last?.id) { _, _ in
                scrollToBottom(proxy: proxy)
            }
            .onChange(of: messages.last?.isStreaming ?? false) { _, streaming in
                if streaming {
                    scrollToBottom(proxy: proxy)
                }
            }
        }
    }

    private func scrollToBottom(proxy: ScrollViewProxy) {
        guard let lastId = messages.last?.id else { return }
        withAnimation(MWMotion.springStandard) {
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
                .font(MWTypography.body())
                .foregroundStyle(MWColors.accentOnAccent)
                .textSelection(.enabled)
                .frame(maxWidth: layout.chatUserBubbleMaxWidth, alignment: .leading)
                .padding(.horizontal, MWSpacing.comfortable)
                .padding(.vertical, MWSpacing.relaxed)
                .background(.tint, in: RoundedRectangle(cornerRadius: MWRadius.bubble, style: .continuous))
        }
    }

    // MARK: - Assistant Content

    @ViewBuilder
    private func assistantContent(_ message: DisplayMessage, layout: MWAdaptiveLayout) -> some View {
        VStack(alignment: .leading, spacing: MWSpacing.sm) {
            // Thinking (developer/raw mode only)
            if complexityMode == .developer || complexityMode == .raw {
                if let thinking = message.thinking, !thinking.isEmpty {
                    DisclosureGroup {
                        Text(thinking)
                            .font(MWTypography.monoCaption())
                            .foregroundStyle(theme.cardTextTertiary)
                            .textSelection(.enabled)
                    } label: {
                        Label(String(localized: "chat.thinking"), systemImage: "brain")
                            .font(MWTypography.caption())
                            .foregroundStyle(theme.cardTextTertiary)
                    }
                    .padding(MWSpacing.sm)
                    .frame(maxWidth: layout.chatAssistantBubbleMaxWidth, alignment: .leading)
                    .background(.quaternary, in: RoundedRectangle(cornerRadius: MWRadius.md))
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
        HStack(spacing: MWSpacing.sm) {
            Text(content)
                .font(MWTypography.body())
                .foregroundStyle(theme.cardTextPrimary)
                .textSelection(.enabled)
                .frame(maxWidth: layout.chatAssistantBubbleMaxWidth, alignment: .leading)

            if isStreaming {
                ProgressView()
                    .scaleEffect(0.7)
            }
        }
        .padding(.horizontal, MWSpacing.comfortable)
        .padding(.vertical, MWSpacing.relaxed)
        .background(theme.cardBg, in: RoundedRectangle(cornerRadius: MWRadius.bubble, style: .continuous))
    }

    // MARK: - Tool Call

    @ViewBuilder
    private func toolCallInline(_ toolCall: DisplayToolCall, layout: MWAdaptiveLayout) -> some View {
        switch complexityMode {
        case .simple:
            if toolCall.isComplete && toolCall.isError {
                Label(toolCall.toolName, systemImage: "exclamationmark.triangle")
                    .font(MWTypography.caption())
                    .foregroundStyle(MWColors.statusError)
            }

        case .focus:
            Label {
                Text(toolCall.toolName)
                    .font(MWTypography.monoCaption())
            } icon: {
                Image(systemName: toolCall.isError ? "xmark.circle.fill" : (toolCall.isComplete ? "checkmark.circle.fill" : "arrow.triangle.2.circlepath"))
                    .foregroundStyle(toolCall.isError ? MWColors.statusError : (toolCall.isComplete ? MWColors.statusSuccess : MWColors.accentPrimary))
            }
            .font(MWTypography.caption())
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
                .font(MWTypography.caption())
                .foregroundStyle(theme.cardTextTertiary)
                .padding(.horizontal, MWSpacing.md)
                .padding(.vertical, MWSpacing.xs)
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
            VStack(alignment: .leading, spacing: MWSpacing.sm) {
                if let input = toolCall.inputPreview, !input.isEmpty {
                    VStack(alignment: .leading, spacing: MWSpacing.xxs) {
                        Text(String(localized: "chat.toolInput"))
                            .font(MWTypography.caption2().weight(.medium))
                            .foregroundStyle(theme.cardTextTertiary)
                        Text(input)
                            .font(MWTypography.monoCaption())
                            .foregroundStyle(theme.cardTextSecondary)
                            .textSelection(.enabled)
                    }
                }

                if let output = toolCall.output, !output.isEmpty {
                    VStack(alignment: .leading, spacing: MWSpacing.xxs) {
                        Text(String(localized: "chat.toolOutput"))
                            .font(MWTypography.caption2().weight(.medium))
                            .foregroundStyle(theme.cardTextTertiary)
                        Text(output)
                            .font(MWTypography.monoCaption())
                            .foregroundStyle(toolCall.isError ? MWColors.statusError : theme.cardTextSecondary)
                            .lineLimit(15)
                            .textSelection(.enabled)
                    }
                }
            }
            .padding(.top, MWSpacing.xs)
        } label: {
            HStack(spacing: MWSpacing.xs) {
                Image(systemName: toolCall.isError ? "xmark.circle.fill" : (toolCall.isComplete ? "checkmark.circle.fill" : "arrow.triangle.2.circlepath"))
                    .font(MWTypography.footnote())
                    .foregroundStyle(toolCall.isError ? MWColors.statusError : (toolCall.isComplete ? MWColors.statusSuccess : MWColors.accentPrimary))

                Text(toolCall.toolName)
                    .font(MWTypography.monoCaption())
                    .foregroundStyle(MWColors.accentPrimary)

                if !toolCall.isComplete && !toolCall.isError {
                    ProgressView()
                        .scaleEffect(0.6)
                }
            }
        }
        .padding(MWSpacing.sm)
        .background(MWColors.bgElevated, in: RoundedRectangle(cornerRadius: MWRadius.md))
    }
}
