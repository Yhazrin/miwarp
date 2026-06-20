import SwiftUI

// MARK: - Glass Surface

private struct MWFallbackGlassSurface: ViewModifier {
    @EnvironmentObject private var theme: MWTheme
    let cornerRadius: CGFloat
    let borderColor: Color?
    let fillColor: Color?

    func body(content: Content) -> some View {
        content
            .background(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(.ultraThinMaterial)
                    .background(
                        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                            .fill(fillColor ?? theme.glassBg)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                            .strokeBorder(borderColor ?? theme.glassBorder, lineWidth: 1)
                    )
            )
    }
}

#if compiler(>=6.2)
@available(iOS 26.0, *)
private struct MWNativeLiquidGlassSurface: ViewModifier {
    @EnvironmentObject private var theme: MWTheme
    let cornerRadius: CGFloat
    let borderColor: Color?
    let fillColor: Color?

    func body(content: Content) -> some View {
        content
            .glassEffect(.regular, in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .background(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(fillColor ?? theme.glassBg)
                    .opacity(0.42)
            )
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .strokeBorder(borderColor ?? theme.glassBorder, lineWidth: 1)
            )
    }
}
#endif

extension View {
    @ViewBuilder
    func mwGlassSurface(
        cornerRadius: CGFloat = MWRadius.lg,
        borderColor: Color? = nil,
        fillColor: Color? = nil
    ) -> some View {
        #if compiler(>=6.2)
        if #available(iOS 26.0, *) {
            modifier(MWNativeLiquidGlassSurface(cornerRadius: cornerRadius, borderColor: borderColor, fillColor: fillColor))
        } else {
            modifier(MWFallbackGlassSurface(cornerRadius: cornerRadius, borderColor: borderColor, fillColor: fillColor))
        }
        #else
        modifier(MWFallbackGlassSurface(cornerRadius: cornerRadius, borderColor: borderColor, fillColor: fillColor))
        #endif
    }
}

// MARK: - Geometric Texture

struct MWGeometricPattern: View {
    @EnvironmentObject private var theme: MWTheme
    var opacityOverride: Double?

    private var opacity: Double {
        opacityOverride ?? theme.textureOpacity
    }

    /// Pre-rendered tile image — path computation happens once, not every frame.
    @State private var cachedImage: CGImage?
    @State private var cachedScheme: ColorScheme?
    @State private var cachedTheme: MWAccentTheme?
    @State private var cachedOpacity: Double?

    private let tileSize: CGFloat = 512  // Covers any iOS screen when tiled

    var body: some View {
        Canvas { context, size in
            guard let cgImage = cachedImage else { return }
            let tile = Image(decorative: cgImage, scale: 1, orientation: .up)
            let cols = Int(ceil(size.width / tileSize)) + 1
            let rows = Int(ceil(size.height / tileSize)) + 1
            for row in 0..<rows {
                for col in 0..<cols {
                    let origin = CGPoint(x: CGFloat(col) * tileSize, y: CGFloat(row) * tileSize)
                    context.draw(tile, at: origin, anchor: .topLeading)
                }
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .onAppear { renderIfNeeded() }
        .onChange(of: theme.accentTheme) { _, _ in invalidateCache() }
        .onChange(of: theme.effectiveColorScheme) { _, _ in invalidateCache() }
        .onChange(of: opacity) { _, _ in invalidateCache() }
    }

    private func invalidateCache() {
        cachedImage = nil
        cachedScheme = nil
        cachedTheme = nil
        cachedOpacity = nil
    }

    private func renderIfNeeded() {
        guard cachedImage == nil
            || cachedScheme != theme.effectiveColorScheme
            || cachedTheme != theme.accentTheme
            || cachedOpacity != opacity
        else { return }

        cachedScheme = theme.effectiveColorScheme
        cachedTheme = theme.accentTheme
        cachedOpacity = opacity

        cachedImage = renderTile(
            primaryColor: (theme.effectiveColorScheme == .dark ? theme.accentSecondary : theme.accentPrimary).opacity(opacity),
            secondaryColor: theme.textPrimary.opacity(opacity * 0.34)
        )
    }

    private func renderTile(primaryColor: Color, secondaryColor: Color) -> CGImage? {
        let w = Int(tileSize)
        let h = Int(tileSize)
        guard let ctx = CGContext(data: nil, width: w, height: h,
            bitsPerComponent: 8, bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }

        let gridStep: CGFloat = 28
        let angleOffset = gridStep * 0.58
        let hFloat = CGFloat(h)
        let wFloat = CGFloat(w)

        // Diagonal grid lines
        var gridPath = Path()
        var x: CGFloat = -hFloat
        while x < wFloat + hFloat {
            gridPath.move(to: CGPoint(x: x, y: 0))
            gridPath.addLine(to: CGPoint(x: x + hFloat * 0.58, y: hFloat))
            x += gridStep
        }
        x = -hFloat
        while x < wFloat + hFloat {
            gridPath.move(to: CGPoint(x: x + angleOffset, y: 0))
            gridPath.addLine(to: CGPoint(x: x - hFloat * 0.58 + angleOffset, y: hFloat))
            x += gridStep
        }

        // Horizontal lines
        var horizPath = Path()
        var y: CGFloat = gridStep
        while y < hFloat {
            horizPath.move(to: CGPoint(x: 0, y: y))
            horizPath.addLine(to: CGPoint(x: wFloat, y: y))
            y += gridStep * 1.72
        }

        // Maze pattern
        var mazePath = Path()
        let cell = gridStep * 1.5
        var row: CGFloat = 0
        while row < hFloat + cell {
            var col: CGFloat = 0
            while col < wFloat + cell {
                mazePath.move(to: CGPoint(x: col, y: row))
                mazePath.addLine(to: CGPoint(x: col + cell * 0.62, y: row))
                mazePath.addLine(to: CGPoint(x: col + cell * 0.62, y: row + cell * 0.38))
                if Int((col + row) / cell).isMultiple(of: 2) {
                    mazePath.addLine(to: CGPoint(x: col + cell, y: row + cell * 0.38))
                } else {
                    mazePath.move(to: CGPoint(x: col + cell * 0.18, y: row + cell * 0.72))
                    mazePath.addLine(to: CGPoint(x: col + cell * 0.78, y: row + cell * 0.72))
                }
                col += cell
            }
            row += cell
        }

        // Three separate stroke passes via CGContext (batched per color)
        ctx.setStrokeColor(secondaryColor.cgColor ?? CGColor(gray: 0.5, alpha: 1))
        ctx.setLineWidth(0.45)
        ctx.addPath(gridPath.cgPath)
        ctx.strokePath()

        ctx.setLineWidth(0.35)
        ctx.addPath(horizPath.cgPath)
        ctx.strokePath()

        ctx.setStrokeColor(primaryColor.cgColor ?? CGColor(gray: 0.3, alpha: 1))
        ctx.setLineWidth(1.0)
        ctx.addPath(mazePath.cgPath)
        ctx.strokePath()

        return ctx.makeImage()
    }
}

struct MWPatternedBackdrop: View {
    @EnvironmentObject private var theme: MWTheme
    var baseColor: Color?
    var patternOpacity: Double?

    var body: some View {
        ZStack {
            baseColor ?? theme.bgDeepest
            if (patternOpacity ?? theme.textureOpacity) > 0 {
                MWGeometricPattern(opacityOverride: patternOpacity)
                    .blendMode(theme.effectiveColorScheme == .dark ? .screen : .multiply)
            }
        }
        .ignoresSafeArea()
    }
}

// MARK: - Glass Card

struct MWGlassCard<Content: View>: View {
    let content: Content
    var cornerRadius: CGFloat = MWRadius.lg
    var borderColor: Color?

    init(cornerRadius: CGFloat = MWRadius.lg, borderColor: Color? = nil, @ViewBuilder content: () -> Content) {
        self.cornerRadius = cornerRadius
        self.borderColor = borderColor
        self.content = content()
    }

    var body: some View {
        content
            .padding(MWSpacing.lg)
            .mwGlassSurface(cornerRadius: cornerRadius, borderColor: borderColor)
    }
}

// MARK: - Glass Glow Modifier

struct MWGlassGlow: ViewModifier {
    let color: Color
    var radius: CGFloat = 12
    var isActive: Bool = true

    func body(content: Content) -> some View {
        content
            .shadow(color: isActive ? color : .clear, radius: radius, x: 0, y: 0)
    }
}

extension View {
    func mwGlassGlow(_ color: Color, radius: CGFloat = 12, isActive: Bool = true) -> some View {
        modifier(MWGlassGlow(color: color, radius: radius, isActive: isActive))
    }
}
