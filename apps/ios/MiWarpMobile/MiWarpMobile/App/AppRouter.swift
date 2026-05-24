import SwiftUI

// MARK: - Tab

enum AppTab: String, CaseIterable {
    case sessions
    case pairing
    case settings

    var title: String {
        switch self {
        case .sessions: return "Sessions"
        case .pairing: return "Connect"
        case .settings: return "Settings"
        }
    }

    var systemImage: String {
        switch self {
        case .sessions: return "bubble.left.and.bubble.right"
        case .pairing: return "point.3.filled.connected.trianglepath.dotted"
        case .settings: return "gear"
        }
    }

    var activeImage: String {
        switch self {
        case .sessions: return "bubble.left.and.bubble.right.fill"
        case .pairing: return "point.3.filled.connected.trianglepath.dotted"
        case .settings: return "gearshape.fill"
        }
    }
}

// MARK: - App Router

struct AppRouter: View {
    @EnvironmentObject private var store: MiWarpConnectionStore
    @State private var selectedTab: AppTab = .sessions

    var body: some View {
        ZStack(alignment: .bottom) {
            // Content
            Group {
                switch selectedTab {
                case .sessions:
                    SessionHubView()
                case .pairing:
                    PairingView()
                case .settings:
                    MobileSettingsView()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            // Floating Glass Dock
            MWControlDock(selectedTab: $selectedTab)
                .padding(.bottom, MWSpacing.sm)
        }
    }
}

// MARK: - Control Dock

struct MWControlDock: View {
    @Binding var selectedTab: AppTab
    @Namespace private var dockAnimation

    var body: some View {
        HStack(spacing: 0) {
            ForEach(AppTab.allCases, id: \.self) { tab in
                dockButton(for: tab)
            }
        }
        .padding(.horizontal, MWSpacing.md)
        .padding(.vertical, MWSpacing.sm)
        .background(
            Capsule()
                .fill(MWColors.glassBg)
                .overlay(
                    Capsule()
                        .strokeBorder(MWColors.glassBorder, lineWidth: 1)
                )
                .shadow(color: .black.opacity(0.25), radius: 20, x: 0, y: 8)
        )
        .padding(.horizontal, MWSpacing.xxxl)
    }

    private func dockButton(for tab: AppTab) -> some View {
        let isSelected = selectedTab == tab

        return Button {
            withAnimation(.spring(response: 0.25, dampingFraction: 0.7)) {
                selectedTab = tab
            }
        } label: {
            VStack(spacing: MWSpacing.xs) {
                ZStack {
                    if isSelected {
                        Circle()
                            .fill(MWColors.accentCyan.opacity(0.15))
                            .frame(width: 36, height: 36)
                            .matchedGeometryEffect(id: "dockHighlight", in: dockAnimation)
                    }

                    Image(systemName: isSelected ? tab.activeImage : tab.systemImage)
                        .font(.system(size: 16, weight: isSelected ? .semibold : .regular))
                        .foregroundColor(isSelected ? MWColors.accentCyan : MWColors.textTertiary)
                }
                .frame(width: 36, height: 36)

                Text(tab.title)
                    .font(MWTypography.caption2())
                    .foregroundColor(isSelected ? MWColors.accentCyan : MWColors.textTertiary)
            }
            .frame(maxWidth: .infinity)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
