import SwiftUI

struct MiMotion {
    static let springResponse: Double = 0.3
    static let springDampingFraction: Double = 0.7

    static func springAnimation(duration: Double = 0.3, bounce: Double = 0.3) -> Animation {
        .spring(duration: duration, bounce: bounce)
    }
}
