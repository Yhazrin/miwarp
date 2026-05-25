import SwiftUI

struct MessageListView: View {
    let messages: [DisplayMessage]
    let complexityMode: ComplexityMode
    var inputBarHeight: CGFloat = 60
    var onApprove: ((String, Bool) -> Void)?

    @State private var scrollProxy: ScrollViewProxy?

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 10) {
                    ForEach(messages) { message in
                        messageContent(message)
                            .id(message.id)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .padding(.bottom, inputBarHeight + 16)
            }
            .onChange(of: messages.count) { _, _ in
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
            userBubble(message.content)
        case .assistant:
            assistantContent(message)
        case .system:
            systemMessage(message.content)
        }
    }

    // MARK: - User Bubble

    private func userBubble(_ content: String) -> some View {
        HStack {
            Spacer(minLength: 48)
            Text(content)
                .font(.body)
                .foregroundStyle(.white)
                .textSelection(.enabled)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(.tint, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
    }

    // MARK: - Assistant Content

    @ViewBuilder
    private func assistantContent(_ message: DisplayMessage) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            // Thinking (developer/raw mode only)
            if complexityMode == .developer || complexityMode == .raw {
                if let thinking = message.thinking, !thinking.isEmpty {
                    DisclosureGroup {
                        Text(thinking)
                            .font(.caption.monospaced())
                            .foregroundStyle(.tertiary)
                            .textSelection(.enabled)
                    } label: {
                        Label("Thinking", systemImage: "brain")
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                    }
                    .padding(10)
                    .background(.quaternary, in: RoundedRectangle(cornerRadius: 8))
                }
            }

            // Message content
            if !message.content.isEmpty {
                assistantBubble(message.content, isStreaming: message.isStreaming)
            }

            // Tool calls
            ForEach(message.toolCalls) { toolCall in
                toolCallInline(toolCall)
            }
        }
    }

    private func assistantBubble(_ content: String, isStreaming: Bool) -> some View {
        HStack(spacing: 8) {
            Text(content)
                .font(.body)
                .foregroundStyle(.primary)
                .textSelection(.enabled)

            if isStreaming {
                ProgressView()
                    .scaleEffect(0.7)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    // MARK: - Tool Call

    @ViewBuilder
    private func toolCallInline(_ toolCall: DisplayToolCall) -> some View {
        switch complexityMode {
        case .simple:
            if toolCall.isComplete && toolCall.isError {
                Label(toolCall.toolName, systemImage: "exclamationmark.triangle")
                    .font(.caption)
                    .foregroundStyle(.red)
            }

        case .focus:
            Label {
                Text(toolCall.toolName)
                    .font(.caption.monospaced())
            } icon: {
                Image(systemName: toolCall.isError ? "xmark.circle.fill" : (toolCall.isComplete ? "checkmark.circle.fill" : "arrow.triangle.2.circlepath"))
                    .foregroundStyle(toolCall.isError ? .red : (toolCall.isComplete ? .green : .blue))
            }
            .font(.caption)
            .foregroundStyle(.secondary)

        case .developer, .raw:
            ToolCallDisclosureView(toolCall: toolCall)
        }
    }

    // MARK: - System Message

    private func systemMessage(_ content: String) -> some View {
        HStack {
            Spacer()
            Text(content)
                .font(.caption)
                .foregroundStyle(.tertiary)
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

    var body: some View {
        DisclosureGroup(isExpanded: $isExpanded) {
            VStack(alignment: .leading, spacing: 8) {
                if let input = toolCall.inputPreview, !input.isEmpty {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Input")
                            .font(.caption2.weight(.medium))
                            .foregroundStyle(.tertiary)
                        Text(input)
                            .font(.caption.monospaced())
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                    }
                }

                if let output = toolCall.output, !output.isEmpty {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Output")
                            .font(.caption2.weight(.medium))
                            .foregroundStyle(.tertiary)
                        Text(output)
                            .font(.caption.monospaced())
                            .foregroundStyle(toolCall.isError ? .red : .secondary)
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
                    .foregroundStyle(toolCall.isError ? .red : (toolCall.isComplete ? .green : .blue))

                Text(toolCall.toolName)
                    .font(.caption.monospaced())
                    .foregroundStyle(.blue)

                if !toolCall.isComplete && !toolCall.isError {
                    ProgressView()
                        .scaleEffect(0.6)
                }
            }
        }
        .padding(10)
        .background(Color(.tertiarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 8))
    }
}
