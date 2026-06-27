import path from 'pathe';
import type {
	PipelineAccessibilityNode,
	PipelineAction,
	PipelineDriverSession,
	PipelineOpenAdapter,
	PipelineOpenTarget,
} from '../pipeline-open.ts';
import {
	createNodeCommandRunner,
	parseJsonCommandOutput,
	type AdapterCommandRunner,
} from './command.ts';

export type IOSXCTestAdapterOptions = {
	targetApp?: string;
	bundleId?: string;
	device?: string;
	xctestBridgeCommand?: string;
	runner?: AdapterCommandRunner;
};

function stringValue(
	target: PipelineOpenTarget,
	key: string,
	fallback?: string,
): string | undefined {
	const value = target[key];
	return typeof value === 'string' ? value : fallback;
}

function screenshotPath(runDir: string, sessionId: string, label: string): string {
	const safeLabel =
		label.replaceAll(/[^a-z0-9._-]+/gi, '-').replace(/^-|-$/g, '') || 'screenshot';
	return path.join(runDir, `${sessionId}-${safeLabel}.png`);
}

function bridgePayload(
	target: PipelineOpenTarget,
	context: { sessionId: string },
	extra = {},
): string {
	return JSON.stringify({ target, sessionId: context.sessionId, ...extra });
}

export function iosXCTestAdapter(options: IOSXCTestAdapterOptions = {}): PipelineOpenAdapter {
	const runner = options.runner ?? createNodeCommandRunner();
	const device = options.device ?? 'booted';
	const bridge = options.xctestBridgeCommand;
	const runBridge = async <T>(
		operation: string,
		target: PipelineOpenTarget,
		context: { sessionId: string },
		extra = {},
	): Promise<T> => {
		if (bridge === undefined) {
			throw new Error(
				'iosXCTestAdapter needs xctestBridgeCommand for accessibility and actions.',
			);
		}
		return parseJsonCommandOutput(
			await runner({
				command: bridge,
				args: [operation, bridgePayload(target, context, extra)],
			}),
			`ios-xctest ${operation}`,
		);
	};
	return {
		name: 'ios-xctest',
		platform: 'mobile',
		supports: (target) =>
			options.targetApp === undefined ||
			target.app === undefined ||
			target.app === options.targetApp,
		open: async (target, context): Promise<PipelineDriverSession> => {
			const bundleId = stringValue(target, 'bundleId', options.bundleId);
			if (bundleId === undefined) {
				throw new Error('iosXCTestAdapter needs target.bundleId or options.bundleId.');
			}
			await runner({ command: 'xcrun', args: ['simctl', 'launch', device, bundleId] });
			return {
				accessibilityTree: async (): Promise<PipelineAccessibilityNode> =>
					runBridge('accessibility', target, context),
				action: async (action: PipelineAction) =>
					runBridge('action', target, context, { action }),
				screenshot: async (label: string) => {
					const file = screenshotPath(context.runDir, context.sessionId, label);
					await runner({
						command: 'xcrun',
						args: ['simctl', 'io', device, 'screenshot', file],
					});
					return { label, path: file };
				},
				logs: async () => (bridge === undefined ? [] : runBridge('logs', target, context)),
				crash: async () =>
					bridge === undefined ? null : runBridge('crash', target, context),
			};
		},
	};
}
