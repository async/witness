#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const supportRoot = path.dirname(fileURLToPath(import.meta.url));
const buildRoot = path.join(supportRoot, '.build');
const derivedDataPath = path.join(buildRoot, 'xcode-derived');
const productsRoot = path.join(derivedDataPath, 'Build', 'Products');
const productDir = path.join(productsRoot, 'Debug');
const testBundle = path.join(productDir, 'WitnessMacOSXCTestBridgeTests.xctest');
const runnerApp = path.join(productDir, 'WitnessMacOSXCTestBridgeTests-Runner.app');
const runnerPlugin = path.join(
	runnerApp,
	'Contents',
	'PlugIns',
	'WitnessMacOSXCTestBridgeTests.xctest',
);
const xctestrunPath = path.join(productsRoot, 'WitnessMacOSXCTestBridge.xctestrun');
const xcodeRunner =
	'/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/Library/Xcode/Agents/XCTRunner.app';
const marker = 'WITNESS_BRIDGE_JSON:';

const [operation, rawPayload] = process.argv.slice(2);
if (operation === undefined || rawPayload === undefined) {
	throw new Error('Usage: bridge.mjs <operation> <payload-json>');
}

const payload = JSON.parse(rawPayload);
await ensureBuilt();
await prepareRunner();
await writeXCTestRun({ operation, payload });
const output = await runXCTest(operation);
const line = output.split(/\r?\n/).find((entry) => entry.trim().startsWith(marker));
if (line === undefined) {
	throw new Error(`macOS XCUITest bridge did not emit JSON.\n${tail(output)}`);
}
process.stdout.write(`${line.trim().slice(marker.length)}\n`);

async function ensureBuilt() {
	await execFileAsync(
		'xcodebuild',
		[
			'build-for-testing',
			'-scheme',
			'WitnessMacOSXCTestBridge',
			'-destination',
			'platform=macOS,arch=arm64',
			'-derivedDataPath',
			derivedDataPath,
		],
		{ cwd: supportRoot, timeout: 120_000, maxBuffer: 20 * 1024 * 1024 },
	);
}

async function prepareRunner() {
	await fs.rm(runnerApp, { recursive: true, force: true });
	await fs.mkdir(path.join(runnerApp, 'Contents', 'PlugIns'), { recursive: true });
	await execFileAsync('ditto', [xcodeRunner, runnerApp]);
	await execFileAsync('ditto', [testBundle, runnerPlugin]);
	await execFileAsync('lipo', [
		path.join(runnerApp, 'Contents', 'MacOS', 'XCTRunner'),
		'-remove',
		'arm64e',
		'-output',
		path.join(runnerApp, 'Contents', 'MacOS', 'XCTRunner'),
	]);
	await execFileAsync('plutil', [
		'-replace',
		'CFBundleExecutable',
		'-string',
		'XCTRunner',
		path.join(runnerApp, 'Contents', 'Info.plist'),
	]);
	await execFileAsync('plutil', [
		'-replace',
		'CFBundleIdentifier',
		'-string',
		'dev.witness.macos-xctest-bridge.runner',
		path.join(runnerApp, 'Contents', 'Info.plist'),
	]);
	await execFileAsync('plutil', [
		'-replace',
		'CFBundleName',
		'-string',
		'WitnessMacOSXCTestBridgeRunner',
		path.join(runnerApp, 'Contents', 'Info.plist'),
	]);
	await execFileAsync('codesign', ['--force', '--sign', '-', runnerPlugin]);
	await execFileAsync('codesign', ['--force', '--sign', '-', runnerApp]);
}

async function writeXCTestRun({ operation, payload }) {
	const payloadJson = JSON.stringify(payload);
	const runnerRef = '__TESTROOT__/Debug/WitnessMacOSXCTestBridgeTests-Runner.app';
	const pluginRef = `${runnerRef}/Contents/PlugIns/WitnessMacOSXCTestBridgeTests.xctest`;
	const environment = `
\t\t\t\t\t\t<key>WITNESS_BRIDGE_OPERATION</key>
\t\t\t\t\t\t<string>${escapeXml(operation)}</string>
\t\t\t\t\t\t<key>WITNESS_BRIDGE_PAYLOAD</key>
\t\t\t\t\t\t<string>${escapeXml(payloadJson)}</string>`;
	await fs.writeFile(
		xctestrunPath,
		`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>__xctestrun_metadata__</key>
\t<dict><key>FormatVersion</key><integer>2</integer></dict>
\t<key>TestConfigurations</key>
\t<array>
\t\t<dict>
\t\t\t<key>IsEnabled</key><true/>
\t\t\t<key>Name</key><string>Witness macOS Bridge</string>
\t\t\t<key>TestTargets</key>
\t\t\t<array>
\t\t\t\t<dict>
\t\t\t\t\t<key>BlueprintName</key><string>WitnessMacOSXCTestBridgeTests</string>
\t\t\t\t\t<key>DependentProductPaths</key>
\t\t\t\t\t<array>
\t\t\t\t\t\t<string>${runnerRef}</string>
\t\t\t\t\t\t<string>${pluginRef}</string>
\t\t\t\t\t\t<string>${escapeXml(payload.appPath ?? '')}</string>
\t\t\t\t\t</array>
\t\t\t\t\t<key>EnvironmentVariables</key>
\t\t\t\t\t<dict>${environment}
\t\t\t\t\t</dict>
\t\t\t\t\t<key>IsAppHostedTestBundle</key><false/>
\t\t\t\t\t<key>IsUITestBundle</key><true/>
\t\t\t\t\t<key>IsXCTRunnerHostedTestBundle</key><true/>
\t\t\t\t\t<key>OnlyTestIdentifiers</key>
\t\t\t\t\t<array><string>WitnessMacOSXCTestBridgeTests/testBridgeOperation</string></array>
\t\t\t\t\t<key>ProductModuleName</key><string>WitnessMacOSXCTestBridgeTests</string>
\t\t\t\t\t<key>TestBundlePath</key><string>${pluginRef}</string>
\t\t\t\t\t<key>TestHostBundleIdentifier</key><string>dev.witness.macos-xctest-bridge.runner</string>
\t\t\t\t\t<key>TestHostPath</key><string>${runnerRef}</string>
\t\t\t\t\t<key>TestingEnvironmentVariables</key>
\t\t\t\t\t<dict>
\t\t\t\t\t\t<key>DYLD_FRAMEWORK_PATH</key>
\t\t\t\t\t\t<string>/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/Library/Frameworks:/Applications/Xcode.app/Contents/Developer/Library/Frameworks</string>
\t\t\t\t\t\t<key>DYLD_LIBRARY_PATH</key>
\t\t\t\t\t\t<string>/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/usr/lib:/Applications/Xcode.app/Contents/Developer/usr/lib</string>
\t\t\t\t\t</dict>
\t\t\t\t\t<key>UITargetAppPath</key><string>${escapeXml(payload.appPath ?? '')}</string>
\t\t\t\t</dict>
\t\t\t</array>
\t\t</dict>
\t</array>
\t<key>TestPlan</key>
\t<dict><key>IsDefault</key><true/><key>Name</key><string>Witness macOS Bridge</string></dict>
</dict>
</plist>
`,
	);
}

async function runXCTest(operation) {
	const resultBundle = path.join(buildRoot, `bridge-${operation}.xcresult`);
	await fs.rm(resultBundle, { recursive: true, force: true });
	const { stdout, stderr } = await execFileAsync(
		'xcodebuild',
		[
			'test-without-building',
			'-xctestrun',
			xctestrunPath,
			'-destination',
			'platform=macOS,arch=arm64',
			'-resultBundlePath',
			resultBundle,
		],
		{ cwd: productsRoot, timeout: 120_000, maxBuffer: 20 * 1024 * 1024 },
	);
	return `${stdout}\n${stderr}`;
}

function escapeXml(value) {
	return String(value)
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;');
}

function tail(output) {
	return output.split(/\r?\n/).slice(-80).join('\n');
}
