import { describe, expect, test } from 'vitest';
import { iosXCTestAdapter, macosAXAdapter } from '../src/index.ts';
import type { AdapterCommand, AdapterCommandRunner } from '../src/index.ts';

function recordingRunner(outputs: Record<string, string> = {}): {
	commands: AdapterCommand[];
	runner: AdapterCommandRunner;
} {
	const commands: AdapterCommand[] = [];
	return {
		commands,
		runner: async (command) => {
			commands.push(command);
			const key = `${command.command} ${command.args?.[0] ?? ''}`;
			return { stdout: outputs[key] ?? '{}', stderr: '', exitCode: 0 };
		},
	};
}

describe('platform pipeline.open adapters', () => {
	test('macosAXAdapter opens an app and records AX-backed operations', async () => {
		const host = recordingRunner({
			'osascript -l': '{"role":"AXApplication","name":"Arcade Shell"}',
		});
		const adapter = macosAXAdapter({ app: 'Arcade', runner: host.runner });
		const app = await adapter.open(
			{ app: 'arcade-shell' },
			{ sessionId: 'app-1', runDir: '/tmp/witness', receiptPath: '/tmp/receipt.json' },
		);

		await app.accessibilityTree();
		await app.action?.({ kind: 'activate', role: 'AXButton', name: 'Run' });
		await app.screenshot?.('after run');

		expect(host.commands.map((command) => [command.command, command.args?.[0]])).toEqual([
			['open', '-a'],
			['osascript', '-l'],
			['osascript', '-l'],
			['screencapture', '-x'],
		]);
		expect(host.commands[0]!.args).toEqual(['-a', 'Arcade']);
		expect(host.commands[3]!.args?.[1]).toContain('/tmp/witness/app-1-after-run.png');
	});

	test('iosXCTestAdapter launches the simulator app and delegates UI facts to XCTest bridge', async () => {
		const host = recordingRunner({
			'witness-ios-bridge accessibility': '{"role":"application","name":"Arcade"}',
			'witness-ios-bridge action': '{"status":"passed"}',
			'witness-ios-bridge logs': '[{"level":"info","text":"ready"}]',
			'witness-ios-bridge crash': 'null',
		});
		const adapter = iosXCTestAdapter({
			targetApp: 'arcade-shell',
			bundleId: 'dev.arcade.shell',
			device: 'booted',
			xctestBridgeCommand: 'witness-ios-bridge',
			runner: host.runner,
		});
		const app = await adapter.open(
			{ app: 'arcade-shell' },
			{ sessionId: 'app-2', runDir: '/tmp/witness', receiptPath: '/tmp/receipt.json' },
		);

		await app.accessibilityTree();
		await app.action?.({ kind: 'activate', role: 'button', name: 'Run' });
		await app.screenshot?.('after run');
		await app.logs?.();
		await app.crash?.();

		expect(host.commands.map((command) => [command.command, command.args?.[0]])).toEqual([
			['xcrun', 'simctl'],
			['witness-ios-bridge', 'accessibility'],
			['witness-ios-bridge', 'action'],
			['xcrun', 'simctl'],
			['witness-ios-bridge', 'logs'],
			['witness-ios-bridge', 'crash'],
		]);
		expect(host.commands[0]!.args).toEqual(['simctl', 'launch', 'booted', 'dev.arcade.shell']);
		expect(host.commands[3]!.args).toEqual([
			'simctl',
			'io',
			'booted',
			'screenshot',
			'/tmp/witness/app-2-after-run.png',
		]);
	});
});
