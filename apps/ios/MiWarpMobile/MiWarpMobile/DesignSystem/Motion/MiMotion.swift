import SwiftUI

enum MiMotion {
    static let quickDuration: Double = 0.16
    static let standardDuration: Double = 0.24
    static let springDuration: Double = 0.36
    static let pageDuration: Double = 0.42

    static func quick(reduceMotion: Bool) -> Animation {
        reduceMotion ? opacityOnly(duration: quickDuration) : .easeOut(duration: quickDuration)
    }

    static func standard(reduceMotion: Bool) -> Animation {
        reduceMotion ? opacityOnly(duration: standardDuration) : .easeInOut(duration: standardDuration)
    }

    static func spring(reduceMotion: Bool) -> Animation {
        reduceMotion ? opacityOnly(duration: standardDuration) : .spring(duration: springDuration, bounce: 0.16)
    }

    static func page(reduceMotion: Bool) -> Animation {
        reduceMotion ? opacityOnly(duration: standardDuration) : .smooth(duration: pageDuration)
    }

    static func opacityOnly(duration: Double) -> Animation {
        .easeInOut(duration: duration)
    }

    static func cardTransition(reduceMotion: Bool) -> AnyTransition {
        if reduceMotion {
            return .opacity
        }
        return .asymmetric(
            insertion: .opacity.combined(with: .move(edge: .bottom)),
            removal: .opacity
        )
    }

    static func timelineTransition(reduceMotion: Bool) -> AnyTransition {
        if reduceMotion {
            return .opacity
        }
        return .opacity.combined(with: .move(edge: .bottom))
    }
}

struct MiPressScaleStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.97 : 1)
            .opacity(configuration.isPressed ? 0.82 : 1)
            .animation(MiMotion.quick(reduceMotion: reduceMotion), value: configuration.isPressed)
    }
}

extension View {
    func miAnimated<Value: Equatable>(_ animation: Animation, value: Value) -> some View {
        self.animation(animation, value: value)
    }
}

#Preview("MiMotion") {
    MiMotionPreview()
        .environmentObject(MWTheme.shared)
}

private struct MiMotionPreview: View {
    @State private var expanded = false

    var body: some View {
        VStack(spacing: 16) {
            Button("Toggle") {
                expanded.toggle()
            }
            .buttonStyle(MiPressScaleStyle())

            if expanded {
                RoundedRectangle(cornerRadius: MWRadius.lg, style: .continuous)
                    .fill(MWColors.accentPrimary)
                    .frame(height: 96)
                    .transition(MiMotion.cardTransition(reduceMotion: false))
            }
        }
        .padding()
    }
}
