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

    private var canSubmit: Bool {
        canSend && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        HStack(alignment: .bottom, spacing: 10) {
            // Attach button
            Button {
                // TODO: attach media
            } label: {
                Image(systemName: "plus")
                    .font(.system(size: 18, weight: .medium))
                    .foregroundStyle(.secondary)
                    .frame(width: 36, height: 36)
                    .background(.ultraThinMaterial, in: Circle())
            }

            // Input capsule
            HStack(spacing: 6) {
                TextField("Message", text: $text, axis: .vertical)
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

                    Button {
                        onFork?()
                    } label: {
                        Image(systemName: "arrow.branch")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(.secondary)
                            .frame(width: 28, height: 28)
                    }
                } else {
                    Button {
                        onSend?()
                    } label: {
                        Image(systemName: "arrow.up")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(canSubmit ? Color.white : Color.gray.opacity(0.4))
                            .frame(width: 28, height: 28)
                            .background(canSubmit ? theme.accentPrimary : Color(.systemFill), in: Circle())
                    }
                    .disabled(!canSubmit)
                    .animation(.easeInOut(duration: 0.15), value: canSubmit)
                }
            }
            .padding(.leading, 14)
            .padding(.trailing, 6)
            .padding(.vertical, 6)
            .background(.ultraThinMaterial, in: Capsule())
            .overlay(
                Capsule()
                    .strokeBorder(
                        isFocused ? theme.accentPrimary.opacity(0.25) : Color(.separator).opacity(0.3),
                        lineWidth: 0.5
                    )
            )
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }
}
