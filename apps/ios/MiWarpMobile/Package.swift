// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "MiWarpMobile",
    platforms: [
        .iOS(.v16),
    ],
    products: [
        .library(
            name: "MiWarpMobile",
            targets: ["MiWarpMobile"]
        ),
    ],
    targets: [
        .target(
            name: "MiWarpMobile",
            path: "MiWarpMobile",
            exclude: ["Resources"],
            sources: [
                "App",
                "Core",
                "DesignSystem",
                "Features",
            ]
        ),
        .testTarget(
            name: "MiWarpMobileTests",
            dependencies: ["MiWarpMobile"],
            path: "Tests"
        ),
    ]
)
