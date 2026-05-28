import SwiftUI

// MARK: - Toast Kind

enum MiToastKind {
    case info
    case success
    case warning
    case error

    var icon: String {
        switch self {
        case .info: return "info.circle.fill"
        case .success: return "checkmark.circle.fill"
        case .warning: return "exclamationmark.triangle.fill"
        case .error: return "xmark.circle.fill"
        }
    }

    var color: Color {
        switch self {
        case .info: return MWColors.accentPrimary
        case .success: return MWColors.statusSuccess
        case .warning: return MWColors.statusWarning
        case .error: return MWColors.statusError
        }
    }
}

// MARK: - Toast Item

struct MiToastItem: Identifiable {
    let id = UUID()
    let title: String
    let message: String?
    let kind: MiToastKind
}

// MARK: - Toast Presenter

@MainActor
final class MiToastPresenter: ObservableObject {
    @Published var currentToast: MiToastItem?

    private var dismissTask: Task<Void, Never>?

    func show(_ title: String, message: String? = nil, kind: MiToastKind = .info) {
        dismissTask?.cancel()
        withAnimation(MWMotion.springBouncy) {
            currentToast = MiToastItem(title: title, message: message, kind: kind)
        }
        dismissTask = Task {
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            guard !Task.isCancelled else { return }
            await dismiss()
        }
    }

    func error(_ title: String, message: String? = nil) {
        show(title, message: message, kind: .error)
    }

    func success(_ title: String, message: String? = nil) {
        show(title, message: message, kind: .success)
    }

    func dismiss() {
        dismissTask?.cancel()
        withAnimation(MWMotion.springQuick) {
            currentToast = nil
        }
    }
}

// MARK: - Toast View

struct MiToastView: View {
    let toast: MiToastItem
    var onDismiss: (() -> Void)?

    var body: some View {
        HStack(spacing: MWSpacing.relaxed) {
            Image(systemName: toast.kind.icon)
                .font(MWTypography.title3())
                .foregroundColor(toast.kind.color)

            VStack(alignment: .leading, spacing: MWSpacing.xxs) {
                Text(toast.title)
                    .font(MWTypography.subheadlineMedium())
                    .foregroundColor(MWColors.textPrimary)
                if let message = toast.message {
                    Text(message)
                        .font(MWTypography.caption())
                        .foregroundColor(MWColors.textSecondary)
                        .lineLimit(2)
                }
            }

            Spacer()

            Button {
                onDismiss?()
            } label: {
                Image(systemName: "xmark")
                    .font(MWTypography.footnoteMedium())
                    .foregroundColor(MWColors.textTertiary)
                    .padding(MWSpacing.compact)
            }
        }
        .padding(.horizontal, MWSpacing.comfortable)
        .padding(.vertical, MWSpacing.relaxed)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: MWRadius.card))
        .overlay(
            RoundedRectangle(cornerRadius: MWRadius.card)
                .strokeBorder(toast.kind.color.opacity(0.2), lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.08), radius: 8, x: 0, y: 4)
    }
}

// MARK: - Toast Presenter Modifier

private struct MiToastPresenterModifier: ViewModifier {
    @ObservedObject var presenter: MiToastPresenter

    func body(content: Content) -> some View {
        content
            .overlay(alignment: .top) {
                if let toast = presenter.currentToast {
                    MiToastView(toast: toast) {
                        presenter.dismiss()
                    }
                    .padding(.horizontal, MWSpacing.lg)
                    .padding(.top, MWSpacing.sm)
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .zIndex(1000)
                }
            }
    }
}

extension View {
    func miToastPresenter(_ presenter: MiToastPresenter) -> some View {
        modifier(MiToastPresenterModifier(presenter: presenter))
    }
}

#Preview("Toast Variants") {
    VStack(spacing: MWSpacing.md) {
        MiToastView(toast: MiToastItem(title: "Info", message: "This is an info message", kind: .info))
        MiToastView(toast: MiToastItem(title: "Success", message: "Operation completed", kind: .success))
        MiToastView(toast: MiToastItem(title: "Warning", message: "Please check your input", kind: .warning))
        MiToastView(toast: MiToastItem(title: "Error", message: "Something went wrong", kind: .error))
    }
    .padding()
}
