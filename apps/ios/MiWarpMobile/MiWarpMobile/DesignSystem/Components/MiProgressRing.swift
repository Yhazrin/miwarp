import SwiftUI

struct MiProgressRing: View {
    let progress: Double
    var size: CGFloat = 40
    var lineWidth: CGFloat = 4
    var color: Color = MWColors.accentPrimary

    var body: some View {
        ZStack {
            Circle()
                .stroke(color.opacity(0.2), lineWidth: lineWidth)

            Circle()
                .trim(from: 0, to: progress)
                .stroke(color, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .animation(MWMotion.springQuick, value: progress)
        }
        .frame(width: size, height: size)
        .accessibilityLabel(String(localized: "component.progress"))
        .accessibilityValue("\(Int(progress * 100))%")
    }
}

#Preview {
    HStack(spacing: MWSpacing.xl) {
        MiProgressRing(progress: 0.3)
        MiProgressRing(progress: 0.7, color: .green)
        MiProgressRing(progress: 1.0, color: .orange, lineWidth: 6)
    }
    .padding()
}
