import SwiftUI

struct ChatInputBar: View {
    @Binding var text: String
    var isRunning: Bool = false
    var canSend: Bool = true
    var onSend: (() -> Void)?
    var onStop: (() -> Void)?
    var onFork: (() -> Void)?

    @FocusState private var isFocused: Bool

    var body: some View {
        HStack(alignment: .bottom, spacing: 10) {
            TextField("Message", text: $text, axis: .vertical)
                .textFieldStyle(.plain)
                .font(.body)
                .lineLimit(1...6)
                .focused($isFocused)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(Color(.tertiarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 20))

            if isRunning {
                Button {
                    onStop?()
                } label: {
                    Image(systemName: "stop.circle.fill")
                        .font(.system(size: 30))
                        .foregroundStyle(.red)
                }

                Button {
                    onFork?()
                } label: {
                    Image(systemName: "arrow.branch")
                        .font(.system(size: 18))
                        .foregroundStyle(.secondary)
                        .frame(width: 30, height: 30)
                }
            } else {
                Button {
                    onSend?()
                } label: {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.system(size: 30))
                        .foregroundStyle(
                            (!canSend || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                                ? AnyShapeStyle(.quaternary)
                                : AnyShapeStyle(Color.accentColor)
                        )
                }
                .disabled(!canSend || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(.bar)
        .overlay(alignment: .top) {
            Divider()
        }
    }
}
