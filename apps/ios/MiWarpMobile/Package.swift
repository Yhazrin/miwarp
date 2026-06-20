// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "MiWarpMobile",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        .library(
            name: "MiWarpMobile",
            targets: ["MiWarpMobile"]
        ),
    ],
    targets: [
        // SwiftPM is a lightweight, cross-platform harness for the protocol/reducer
        // unit tests. The full iOS application is built by the Xcode project.
        .target(
            name: "MiWarpMobile",
            path: "MiWarpMobile/Core",
            exclude: [
                "MiWarpConnectionStore.swift",
                "MiWarpKeychain.swift",
                "MiWarpLogger.swift",
                "MiWarpRPC.swift",
                "MiWarpWebSocketClient.swift",
                "SpotlightIndexer.swift",
            ],
            sources: [
                "AnyCodable.swift",
                "ArtifactsTypes.swift",
                "BusEvent.swift",
                "BusEventPayload.swift",
                "ConnectionTypes.swift",
                "RunTypes.swift",
                "WebSocketMessages.swift",
                "WSDecoder.swift",
                "MiWarpEventReducer.swift",
            ]
        ),
        .testTarget(
            name: "MiWarpMobileTests",
            dependencies: ["MiWarpMobile"],
            path: "MiWarpMobileTests",
            exclude: ["Info.plist"]
        ),
    ]
)
