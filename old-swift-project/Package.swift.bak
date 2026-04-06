// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "ProducerPlayer",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(name: "ProducerPlayer", targets: ["ProducerPlayer"])
    ],
    targets: [
        .executableTarget(
            name: "ProducerPlayer",
            linkerSettings: [
                .linkedFramework("AVFoundation"),
                .linkedFramework("AppKit"),
                .linkedFramework("UserNotifications"),
                .linkedLibrary("sqlite3")
            ]
        )
    ]
)
