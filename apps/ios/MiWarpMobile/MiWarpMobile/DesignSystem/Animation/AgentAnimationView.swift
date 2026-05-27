import SwiftUI

struct AgentAnimationView: View {
    let isActive: Bool
    var size: CGFloat = 24

    @State private var rotation: Double = 0

    var body: some View {
        Image(systemName: "brain.head.profile")
            .font(.system(size: size * 0.6))
            .foregroundColor(isActive ? MWColors.accentPrimary : MWColors.textTertiary)
            .rotationEffect(.degrees(rotation))
            .onChange(of: isActive) { _, active in
                if active {
                    withAnimation(.linear(duration: 2).repeatForever(autoreverses: false)) {
                        rotation = 360
                    }
                } else {
                    withAnimation(MWMotion.springQuick) {
                        rotation = 0
                    }
                }
            }
    }
}

#Preview {
    HStack(spacing: 20) {
        AgentAnimationView(isActive: false)
        AgentAnimationView(isActive: true)
    }
    .padding()
}
