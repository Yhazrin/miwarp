import SwiftUI

// MARK: - Skeleton Card

struct MiSkeletonCard: View {
    let lines: Int
    var height: CGFloat?
    var showsAvatar: Bool = false

    @EnvironmentObject private var theme: MWTheme
    @State private var shimmerPhase: CGFloat = -1

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if showsAvatar {
                HStack(spacing: 10) {
                    skeletonCircle(size: 32)
                    VStack(alignment: .leading, spacing: 6) {
                        skeletonLine(width: 0.4)
                        skeletonLine(width: 0.25)
                    }
                }
            }

            ForEach(0..<lines, id: \.self) { index in
                skeletonLine(width: index == lines - 1 ? 0.6 : 1.0)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity)
        .frame(height: height)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(theme.cardBg)
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .strokeBorder(theme.divider, lineWidth: 0.5)
                )
        )
        .overlay(shimmerOverlay)
        .onAppear {
            withAnimation(.linear(duration: 1.5).repeatForever(autoreverses: false)) {
                shimmerPhase = 1
            }
        }
    }

    private func skeletonLine(width: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: 4)
            .fill(theme.cardTextTertiary.opacity(0.15))
            .frame(width: width == 1.0 ? nil : width * 200, height: 12)
            .frame(maxWidth: width == 1.0 ? .infinity : nil, alignment: .leading)
    }

    private func skeletonCircle(size: CGFloat) -> some View {
        Circle()
            .fill(theme.cardTextTertiary.opacity(0.15))
            .frame(width: size, height: size)
    }

    private var shimmerOverlay: some View {
        GeometryReader { geo in
            LinearGradient(
                colors: [
                    .clear,
                    theme.cardTextTertiary.opacity(0.06),
                    .clear
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .frame(width: geo.size.width * 2)
            .offset(x: shimmerPhase * geo.size.width)
        }
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .allowsHitTesting(false)
    }
}
