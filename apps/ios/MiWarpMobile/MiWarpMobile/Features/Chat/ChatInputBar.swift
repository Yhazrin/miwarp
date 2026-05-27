import SwiftUI

struct ChatInputBar: View {
    @Binding var text: String
    var isRunning: Bool = false
    var canSend: Bool = true
    var onSend: (() -> Void)?
    var onStop: (() -> Void)?
    var onFork: (() -> Void)?

    @FocusState private var isFocused: Bool
    @EnvironmentObject private var theme: MWTheme
    @State private var sendScale: CGFloat = 1.0

    private var canSubmit: Bool {
        canSend && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        HStack(alignment: .bottom, spacing: 10) {
            // Input capsule
            HStack(spacing: 6) {
                TextField(String(localized: "chat.inputPlaceholder"), text: $text, axis: .vertical)
                    .textFieldStyle(.plain)
                    .font(.body)
                    .lineLimit(1...6)
                    .focused($isFocused)

                if isRunning {
                    Button {
                        onStop?()
                    } label: {
                        Image(systemName: "stop.fill")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(width: 28, height: 28)
                            .background(.red, in: Circle())
                    }
                    .accessibilityLabel(String(localized: "action.stop"))
                    .sensoryFeedback(.impact(flexibility: .solid, intensity: 0.7), trigger: isRunning)

                    Button {
                        onFork?()
                    } label: {
                        Image(systemName: "arrow.branch")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(.secondary)
                            .frame(width: 28, height: 28)
                    }
                    .accessibilityLabel(String(localized: "action.fork"))
                } else {
                    Button {
                        withAnimation(MWMotion.springQuick) {
                            sendScale = 0.85
                        }
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
                            withAnimation(MWMotion.springBouncy) {
                                sendScale = 1.0
                            }
                        }
                        onSend?()
                    } label: {
                        Image(systemName: "arrow.up")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(canSubmit ? Color.white : Color.gray.opacity(0.4))
                            .frame(width: 28, height: 28)
                            .background(canSubmit ? theme.accentPrimary : Color(.systemFill), in: Circle())
                            .scaleEffect(sendScale)
                    }
                    .disabled(!canSubmit)
                    .accessibilityLabel(String(localized: "action.send"))
                    .sensoryFeedback(.impact(flexibility: .soft, intensity: 0.6), trigger: canSubmit)
                    .animation(MWMotion.springQuick, value: canSubmit)
                }
            }
            .padding(.leading, 14)
            .padding(.trailing, 6)
            .padding(.vertical, 6)
            .background(.ultraThinMaterial, in: Capsule())
            .overlay(
                Capsule()
                    .strokeBorder(
                        isFocused ? theme.accentPrimary.opacity(0.3) : Color(.separator).opacity(0.3),
                        lineWidth: isFocused ? 1 : 0.5
                    )
                    .animation(MWMotion.springQuick, value: isFocused)
            )
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }
}
