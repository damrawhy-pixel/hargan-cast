// swift-tools-version: 5.9
// PlayStation core for the iOS app. HarganPsCoreC.xcframework is built from
// native/ps-core/mobile by ios/build-core.sh before the app is built.
import PackageDescription

let package = Package(
    name: "HarganPsCore",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "HarganPsCore",
            targets: ["PsCorePlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .binaryTarget(
            name: "HarganPsCoreC",
            path: "ios/HarganPsCoreC.xcframework"),
        .target(
            name: "PsCorePlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                "HarganPsCoreC"
            ],
            path: "ios/Sources/PsCorePlugin",
            linkerSettings: [
                .linkedFramework("Security"),
                .linkedFramework("CoreFoundation"),
                .linkedFramework("CoreServices"),
                .linkedFramework("SystemConfiguration")
            ])
    ]
)
