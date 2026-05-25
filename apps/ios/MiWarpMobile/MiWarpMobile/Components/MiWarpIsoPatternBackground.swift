import SwiftUI

// MARK: - Tile CGImage Renderer
/// Renders a single isometric tile into a CGImage via Core Graphics.
/// All path computation happens once at render time; the resulting CGImage
/// is cached and drawn via Canvas with zero per-frame path overhead.

private func renderTileCGImage(
    style: MiWarpIsoPatternBackground.Style,
    tileWidth: CGFloat,
    tileHeight: CGFloat,
    scale: CGFloat
) -> CGImage? {
    let width = Int(tileWidth * scale)
    let height = Int(tileHeight * scale)
    guard width > 0, height > 0 else { return nil }

    guard let context = CGContext(
        data: nil,
        width: width,
        height: height,
        bitsPerComponent: 8,
        bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else { return nil }

    context.scaleBy(x: scale, y: scale)

    let (darkStroke, lightStroke): (Color, Color)
    switch style {
    case .light:
        darkStroke = Color.black.opacity(0.08)
        lightStroke = Color.white.opacity(0.55)
    case .blue:
        darkStroke = Color.black.opacity(0.22)
        lightStroke = Color.white.opacity(0.08)
    }

    // Build all paths once
    let allPaths = buildIsoTilePaths(width: tileWidth, height: tileHeight)

    // Shadow pass — offset +1,+1
    context.saveGState()
    context.translateBy(x: 1, y: 1)
    for path in allPaths {
        context.addPath(path.cgPath)
    }
    context.setStrokeColor(darkStroke.cgColor!)
    context.setLineWidth(1)
    context.strokePath()
    context.restoreGState()

    // Highlight pass — offset -1,-1
    context.saveGState()
    context.translateBy(x: -1, y: -1)
    for path in allPaths {
        context.addPath(path.cgPath)
    }
    context.setStrokeColor(lightStroke.cgColor!)
    context.setLineWidth(1)
    context.strokePath()
    context.restoreGState()

    // Main hairline
    for path in allPaths {
        context.addPath(path.cgPath)
    }
    context.setStrokeColor(darkStroke.opacity(0.7).cgColor!)
    context.setLineWidth(0.7)
    context.strokePath()

    return context.makeImage()
}

private func buildIsoTilePaths(width: CGFloat, height: CGFloat) -> [Path] {
    let x: CGFloat = 0
    let y: CGFloat = 0
    func p(_ dx: CGFloat, _ dy: CGFloat) -> CGPoint {
        CGPoint(x: x + dx, y: y + dy)
    }

    // 4 concentric hexagon rings
    let rings: [[CGPoint]] = [
        [p(90, 0), p(180, 52), p(180, 156), p(90, 104), p(0, 156), p(0, 52), p(90, 0)],
        [p(90, 18), p(164, 61), p(164, 138), p(90, 95), p(16, 138), p(16, 61), p(90, 18)],
        [p(90, 36), p(148, 70), p(148, 120), p(90, 86), p(32, 120), p(32, 70), p(90, 36)],
        [p(90, 54), p(132, 79), p(132, 102), p(90, 77), p(48, 102), p(48, 79), p(90, 54)]
    ]

    let ringPaths = rings.map { points -> Path in
        var path = Path()
        guard let first = points.first else { return path }
        path.move(to: first)
        for pt in points.dropFirst() { path.addLine(to: pt) }
        return path
    }

    // 6 connector lines
    let connectors: [(CGPoint, CGPoint)] = [
        (p(90, 0), p(90, 54)),
        (p(0, 52), p(48, 79)),
        (p(180, 52), p(132, 79)),
        (p(0, 156), p(48, 102)),
        (p(180, 156), p(132, 102)),
        (p(90, 104), p(90, 77))
    ]

    let connectorPaths = connectors.map { (from, to) -> Path in
        var path = Path()
        path.move(to: from)
        path.addLine(to: to)
        return path
    }

    return ringPaths + connectorPaths
}

// MARK: - Main View

struct MiWarpIsoPatternBackground: View {
    enum Style {
        case light
        case blue
    }

    var style: Style = .light
    var opacity: Double = 1.0
    var tileWidth: CGFloat = 180
    var tileHeight: CGFloat = 156

    @State private var tileImage: CGImage?

    private var backgroundColor: Color {
        switch style {
        case .light: return Color(red: 0.97, green: 0.95, blue: 0.91)
        case .blue:  return Color(red: 0.05, green: 0.16, blue: 0.55)
        }
    }

    var body: some View {
        GeometryReader { geometry in
            let cols = Int(ceil(geometry.size.width / tileWidth)) + 1
            let rows = Int(ceil(geometry.size.height / tileHeight)) + 1

            Canvas { context, _ in
                guard let image = tileImage else { return }
                let swiftUIImage = Image(decorative: image, scale: 2, orientation: .up)
                for row in 0..<rows {
                    for col in 0..<cols {
                        let origin = CGPoint(
                            x: CGFloat(col) * tileWidth,
                            y: CGFloat(row) * tileHeight
                        )
                        context.draw(swiftUIImage, at: origin, anchor: .topLeading)
                    }
                }
            }
            .background(backgroundColor)
        }
        .opacity(opacity)
        .ignoresSafeArea()
        .onAppear { renderTileIfNeeded() }
        .onChange(of: style) { _, _ in renderTileIfNeeded() }
    }

    private func renderTileIfNeeded() {
        tileImage = renderTileCGImage(
            style: style,
            tileWidth: tileWidth,
            tileHeight: tileHeight,
            scale: 2.0
        )
    }
}
