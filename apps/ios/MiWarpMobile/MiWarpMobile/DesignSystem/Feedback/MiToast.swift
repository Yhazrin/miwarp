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
        withAnimation(.spring(duration: 0.3, bounce: 0.3)) {
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
        withAnimation(.spring(duration: 0.25, bounce: 0.2)) {
            currentToast = nil
        }
    }
}

// MARK: - Toast View

struct MiToastView: View {
    let toast: MiToastItem
    var onDismiss: (() -> Void)?

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: toast.kind.icon)
                .font(.system(size: 16, weight: .semibold))
                .foregroundColor(toast.kind.color)

            VStack(alignment: .leading, spacing: 2) {
                Text(toast.title)
                    .font(.subheadline.weight(.medium))
                    .foregroundColor(.primary)
                if let message = toast.message {
                    Text(message)
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .lineLimit(2)
                }
            }

            Spacer()

            Button {
                onDismiss?()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(.secondary)
                    .padding(6)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
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
                    .padding(.horizontal, 16)
                    .padding(.top, 8)
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
