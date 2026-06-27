// swift-tools-version: 6.0

import PackageDescription

let package = Package(
	name: "WitnessMacOSXCTestBridge",
	platforms: [
		.macOS(.v14),
	],
	products: [
		.library(name: "WitnessMacOSXCTestBridge", targets: ["WitnessMacOSXCTestBridge"]),
	],
	targets: [
		.target(name: "WitnessMacOSXCTestBridge"),
		.testTarget(
			name: "WitnessMacOSXCTestBridgeTests",
			dependencies: ["WitnessMacOSXCTestBridge"],
		),
	],
)
