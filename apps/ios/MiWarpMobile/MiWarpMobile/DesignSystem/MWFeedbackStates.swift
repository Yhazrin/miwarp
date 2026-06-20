import SwiftUI

// MARK: - Empty State

struct MWEmptyState: View {
    let icon: String
    let title: String
    let message: String
    var actionTitle: String?
    var actionIcon: String?
    var onAction: (() -> Void)?

    init(icon: String, title: String, message: String, actionTitle: String? = nil, actionIcon: String? = nil, onAction: (() -> Void)? = nil) {
        self.icon = icon
        self.title = title
        self.message = message
        self.actionTitle = actionTitle
        self.actionIcon = actionIcon
        self.onAction = onAction
    }

    var body: some View {
        VStack(spacing: MWSpacing.xl) {
            Image(systemName: icon)
                .font(MWTypography.iconXXL())
                .foregroundStyle(MWColors.accentPrimary, MWColors.accentCyan)
                .padding(.bottom, MWSpacing.sm)

            VStack(spacing: MWSpacing.sm) {
                Text(title)
                    .font(MWTypography.title3())
                    .foregroundColor(MWColors.textPrimary)
                Text(message)
                    .font(MWTypography.callout())
                    .foregroundColor(MWColors.textSecondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let actionTitle, let onAction {
                Button {
                    onAction()
                } label: {
                    Label(actionTitle, systemImage: actionIcon ?? "arrow.right")
                        .font(MWTypography.bodyMedium())
                        .foregroundColor(MWColors.accentOnAccent)
                        .padding(.horizontal, MWSpacing.xl)
                        .padding(.vertical, MWSpacing.md)
                        .background(
                            Capsule()
                                .fill(MWColors.accentPrimary)
                        )
                }
                .padding(.top, MWSpacing.sm)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.horizontal, MWSpacing.xxxl)
        .background(MWPatternedBackdrop())
    }
}

// MARK: - Error State

struct MWErrorState: View {
    let title: String
    let message: String
    var actionTitle: String?
    var secondaryTitle: String?
    var onAction: (() -> Void)?
    var onSecondary: (() -> Void)?

    init(message: String, title: String = String(localized: "error.somethingWentWrong"), actionTitle: String? = String(localized: "action.retry"), secondaryTitle: String? = nil, onAction: (() -> Void)? = nil, onSecondary: (() -> Void)? = nil) {
        self.title = title
        self.message = message
        self.actionTitle = actionTitle
        self.secondaryTitle = secondaryTitle
        self.onAction = onAction
        self.onSecondary = onSecondary
    }

    var body: some View {
        VStack(spacing: MWSpacing.xl) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(MWTypography.iconXL())
                .foregroundColor(MWColors.statusError)

            VStack(spacing: MWSpacing.sm) {
                Text(title)
                    .font(MWTypography.title3())
                    .foregroundColor(MWColors.textPrimary)
                Text(message)
                    .font(MWTypography.callout())
                    .foregroundColor(MWColors.textSecondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack(spacing: MWSpacing.md) {
                if let actionTitle, let onAction {
                    Button {
                        onAction()
                    } label: {
                        Label(actionTitle, systemImage: "arrow.clockwise")
                            .font(MWTypography.bodyMedium())
                            .foregroundColor(MWColors.accentOnAccent)
                            .padding(.horizontal, MWSpacing.xl)
                            .padding(.vertical, MWSpacing.md)
                            .background(
                                Capsule()
                                    .fill(MWColors.accentPrimary)
                            )
                    }
                }

                if let secondaryTitle, let onSecondary {
                    Button {
                        onSecondary()
                    } label: {
                        Text(secondaryTitle)
                            .font(MWTypography.bodyMedium())
                            .foregroundColor(MWColors.textSecondary)
                            .padding(.horizontal, MWSpacing.lg)
                            .padding(.vertical, MWSpacing.md)
                            .background(
                                Capsule()
                                    .strokeBorder(MWColors.divider, lineWidth: 1)
                            )
                    }
                }
            }
            .padding(.top, MWSpacing.sm)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.horizontal, MWSpacing.xxxl)
        .background(MWPatternedBackdrop())
    }
}

// MARK: - Loading State

struct MWLoadingState: View {
    var message: String = String(localized: "loading.default")

    var body: some View {
        VStack(spacing: MWSpacing.lg) {
            ProgressView()
                .scaleEffect(1.2)
                .tint(MWColors.accentCyan)
            Text(message)
                .font(MWTypography.callout())
                .foregroundColor(MWColors.textTertiary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Reconnect Banner

struct MWReconnectBanner: View {
    let attempt: Int
    var onCancel: (() -> Void)?
    @EnvironmentObject private var theme: MWTheme

    var body: some View {
        HStack(spacing: MWSpacing.sm) {
            ProgressView()
                .scaleEffect(0.75)
                .tint(MWColors.statusWarning)

            VStack(alignment: .leading, spacing: MWSpacing.xxs) {
                Text(String(localized: "chat.reconnecting"))
                    .font(MWTypography.subheadlineMedium())
                    .foregroundColor(MWColors.statusWarning)
                Text(String(format: String(localized: "chat.attempt"), attempt))
                    .font(MWTypography.caption2())
                    .foregroundColor(MWColors.textTertiary)
            }

            Spacer()

            Button(String(localized: "action.cancel")) {
                onCancel?()
            }
            .font(MWTypography.subheadline())
            .foregroundColor(MWColors.textSecondary)
        }
        .padding(.horizontal, MWSpacing.lg)
        .padding(.vertical, MWSpacing.sm)
        .background(
            Rectangle()
                .fill(MWColors.statusWarning.opacity(0.08))
                .overlay(
                    Rectangle()
                        .fill(MWColors.statusWarning.opacity(0.04))
                        .blur(radius: 8)
                )
                .overlay(
                    MWGeometricPattern(opacityOverride: min(theme.textureOpacity, 0.10))
                        .blendMode(.screen)
                )
        )
    }
}
