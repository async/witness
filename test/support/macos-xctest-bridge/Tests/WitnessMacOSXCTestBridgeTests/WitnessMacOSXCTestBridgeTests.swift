import Foundation
import XCTest

final class WitnessMacOSXCTestBridgeTests: XCTestCase {
	func testBridgeOperation() throws {
		let environment = ProcessInfo.processInfo.environment
		let operation = try require(environment["WITNESS_BRIDGE_OPERATION"], "operation")
		let payload = try decodePayload(try require(environment["WITNESS_BRIDGE_PAYLOAD"], "payload"))
		let bundleId = try require(payload["bundleId"] as? String, "bundleId")
		let app = XCUIApplication(bundleIdentifier: bundleId)

		app.activate()
		_ = app.wait(for: .runningForeground, timeout: 5)

		switch operation {
		case "accessibility":
			try emit(accessibilityTree(app))
		case "action":
			let action = try require(payload["action"] as? [String: Any], "action")
			try perform(action, in: app)
			try emit(["status": "passed"])
		case "screenshot":
			let label = payload["label"] as? String ?? "screenshot"
			let path = try require(payload["path"] as? String, "path")
			try screenshot(label: label, path: path)
		default:
			throw BridgeError.missing("unsupported operation \(operation)")
		}
	}

	private func accessibilityTree(_ app: XCUIApplication) -> [String: Any] {
		let children = app.descendants(matching: .any).allElementsBoundByIndex
			.prefix(200)
			.map(node)
		return [
			"role": "application",
			"name": app.label,
			"children": children,
		]
	}

	private func node(_ element: XCUIElement) -> [String: Any] {
		var output: [String: Any] = [
			"role": roleName(element.elementType),
			"state": [
				"enabled": element.isEnabled,
				"selected": element.isSelected,
			],
			"frame": [
				"x": element.frame.origin.x,
				"y": element.frame.origin.y,
				"width": element.frame.size.width,
				"height": element.frame.size.height,
			],
		]
		if !element.label.isEmpty {
			output["name"] = element.label
		}
		if !element.identifier.isEmpty {
			output["identifier"] = element.identifier
		}
		if let value = element.value {
			output["value"] = String(describing: value)
		}
		return output
	}

	private func perform(_ action: [String: Any], in app: XCUIApplication) throws {
		let name = try require(action["name"] as? String, "action.name")
		let element = app.descendants(matching: .any)
			.matching(NSPredicate(format: "label == %@", name))
			.firstMatch

		guard element.waitForExistence(timeout: 5) else {
			throw BridgeError.missing("No matching accessibility element named \(name)")
		}
		element.tap()
	}

	private func screenshot(label: String, path: String) throws {
		let data = XCUIScreen.main.screenshot().pngRepresentation
		try data.write(to: URL(fileURLWithPath: path))
		try emit(["label": label, "path": path])
	}

	private func roleName(_ type: XCUIElement.ElementType) -> String {
		switch type {
		case .application:
			return "application"
		case .button:
			return "button"
		case .staticText:
			return "text"
		case .window:
			return "window"
		case .textField:
			return "textbox"
		case .image:
			return "image"
		case .switch:
			return "switch"
		default:
			return String(describing: type)
		}
	}

	private func decodePayload(_ payload: String) throws -> [String: Any] {
		let data = Data(payload.utf8)
		guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
			throw BridgeError.missing("payload object")
		}
		return object
	}

	private func require<T>(_ value: T?, _ label: String) throws -> T {
		guard let value else {
			throw BridgeError.missing(label)
		}
		return value
	}

	private func emit(_ value: Any) throws {
		let data = try JSONSerialization.data(withJSONObject: value)
		let json = String(decoding: data, as: UTF8.self)
		print("WITNESS_BRIDGE_JSON:\(json)")
	}
}

private enum BridgeError: Error {
	case missing(String)
}
