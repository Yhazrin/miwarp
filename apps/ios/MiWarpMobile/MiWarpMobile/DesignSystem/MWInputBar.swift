import SwiftUI

// MARK: - Input Bar

struct MWInputBar: View {
    @EnvironmentObject private var theme: MWTheme
    @Binding var text: String
    var isRunning: Bool = false
    var canSend: Bool = true
    var onSend: (() -> Void)?
    var onStop: (() -> Void)?
    var onFork: (() -> Void)?

    @FocusState private var isFocused: Bool

    var body: some View {
        HStack(alignment: .bottom, spacing: MWSpacing.sm) {
            // Text field with glass background
            TextField(String(localized: "chat.typeMessage"), text: $text, axis: .vertical)
                .textFieldStyle(.plain)
                .font(MWTypography.body())
                .lineLimit(1...6)
                .focused($isFocused)
                .padding(.horizontal, MWSpacing.md)
                .padding(.vertical, MWSpacing.sm)
                .background(
                    RoundedRectangle(cornerRadius: MWRadius.xl)
                        .fill(theme.inputBg)
                        .overlay(
                            RoundedRectangle(cornerRadius: MWRadius.xl)
                                .strokeBorder(
                                    isFocused ? theme.accentCyan.opacity(0.3) : theme.divider,
                                    lineWidth: 1
                                )
                        )
                )

            if isRunning {
                // Stop button
                Button {
                    onStop?()
                } label: {
                    Image(systemName: "stop.circle.fill")
                        .font(.system(size: 30))
                        .foregroundColor(theme.statusError)
                }

                // Fork button
                Button {
                    onFork?()
                } label: {
                    Image(systemName: "arrow.branch")
                        .font(.system(size: 20))
                        .foregroundColor(theme.accentCyan)
                        .frame(width: 30, height: 30)
                }
            } else {
                // Send button
                Button {
                    onSend?()
                } label: {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.system(size: 30))
                        .foregroundColor(
                            (!canSend || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                                ? theme.cardTextTertiary
                                : theme.accentPrimary
                        )
                }
                .disabled(!canSend || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(.horizontal, MWSpacing.lg)
        .padding(.vertical, MWSpacing.md)
        .background(
            Rectangle()
                .fill(.ultraThinMaterial)
                .background(theme.glassBg)
                .overlay(
                    Rectangle()
                        .strokeBorder(theme.divider, lineWidth: 0.5)
                        .padding(.top, 0.5)
                )
        )
    }
}
