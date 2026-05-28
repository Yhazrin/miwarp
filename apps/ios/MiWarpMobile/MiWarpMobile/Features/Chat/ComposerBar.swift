import SwiftUI

struct ComposerBar: View {
    @Binding var text: String
    var isRunning: Bool = false
    var canSend: Bool = true
    var provider: String = "MiWarp"
    var model: String = "Model pending"
    var runtimeStatus: ConnectionState = .disconnected
    var toastPresenter: MiToastPresenter?
    var onSend: (() -> Void)?
    var onStop: (() -> Void)?
    var onAttach: (() -> Void)?

    @EnvironmentObject private var theme: MWTheme
    @FocusState private var isFocused: Bool

    private var canSubmit: Bool {
        canSend && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        VStack(spacing: 0) {
            Divider()
                .opacity(0.3)

            HStack(alignment: .bottom, spacing: 10) {
                // Attach button
                Button {
                    onAttach?()
                } label: {
                    Image(systemName: "plus.circle.fill")
                        .font(MWTypography.title())
                        .foregroundColor(theme.textTertiary)
                }
                .accessibilityLabel(String(localized: "action.attach"))

                // Input capsule
                HStack(spacing: 6) {
                    TextField(String(localized: "chat.typeMessage"), text: $text, axis: .vertical)
                        .textFieldStyle(.plain)
                        .font(.body)
                        .lineLimit(1...6)
                        .focused($isFocused)
                        .submitLabel(.send)
                        .onSubmit {
                            if canSubmit { onSend?() }
                        }

                    if isRunning {
                        stopButton
                    } else {
                        sendButton
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(
                    Capsule()
                        .fill(theme.cardBg)
                        .overlay(
                            Capsule()
                                .strokeBorder(theme.divider, lineWidth: 0.5)
                        )
                )
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(.ultraThinMaterial)
        }
    }

    private var sendButton: some View {
        Button {
            onSend?()
        } label: {
            Image(systemName: "arrow.up.circle.fill")
                .font(.system(size: 24))
                .foregroundColor(canSubmit ? MWColors.accentPrimary : theme.textTertiary)
        }
        .disabled(!canSubmit)
        .accessibilityLabel(String(localized: "action.send"))
    }

    private var stopButton: some View {
        Button {
            onStop?()
        } label: {
            Image(systemName: "stop.fill")
                .font(MWTypography.callout().bold())
                .foregroundColor(MWColors.accentOnAccent)
                .frame(width: 28, height: 28)
                .background(MWColors.statusError, in: Circle())
        }
        .accessibilityLabel(String(localized: "action.stop"))
    }
}
