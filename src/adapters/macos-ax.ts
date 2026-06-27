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

export type MacOSAXAdapterOptions = {
	targetApp?: string;
	app?: string;
	appName?: string;
	appPath?: string;
	bundleId?: string;
	xctestBridgeCommand?: string;
	maxDepth?: number;
	runner?: AdapterCommandRunner;
};

const SNAPSHOT_SCRIPT = `
function text(value) { try { return value() == null ? undefined : String(value()); } catch (_) { return undefined; } }
function childrenOf(element) { try { return element.uiElements(); } catch (_) { return []; } }
function node(element, depth, maxDepth) {
  var out = { role: text(element.role) || 'unknown' };
  var name = text(element.name);
  if (name) out.name = name;
  var value = text(element.value);
  if (value) out.value = value;
  if (depth < maxDepth) out.children = childrenOf(element).map(function (child) { return node(child, depth + 1, maxDepth); });
  return out;
}
function run(argv) {
  var appName = argv[0];
  var maxDepth = Number(argv[1] || '4');
  var app = Application('System Events').processes.byName(appName);
  return JSON.stringify(node(app, 0, maxDepth));
}
`;

const ACTION_SCRIPT = `
function text(value) { try { return value() == null ? undefined : String(value()); } catch (_) { return undefined; } }
function childrenOf(element) { try { return element.uiElements(); } catch (_) { return []; } }
function matches(element, action) {
  if (action.role && text(element.role) !== action.role) return false;
  if (action.name && text(element.name) !== action.name) return false;
  return Boolean(action.role || action.name);
}
function find(element, action) {
  if (matches(element, action)) return element;
  var children = childrenOf(element);
  for (var i = 0; i < children.length; i++) {
    var found = find(children[i], action);
    if (found) return found;
  }
  return null;
}
function run(argv) {
  var appName = argv[0];
  var action = JSON.parse(argv[1]);
  var app = Application('System Events').processes.byName(appName);
  var element = find(app, action);
  if (!element) throw new Error('No matching accessibility element');
  if (action.kind === 'activate' || action.kind === 'click') element.click();
  return JSON.stringify({ status: 'passed' });
}
`;

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

function appNameFromPath(appPath: string): string {
	return path.basename(appPath).replace(/\.app$/i, '');
}

function bridgePayload(
	target: PipelineOpenTarget,
	context: { sessionId: string },
	extra = {},
): string {
	return JSON.stringify({ target, sessionId: context.sessionId, ...extra });
}

const QUIT_SCRIPT = `
function run(argv) {
  try { Application(argv[0]).quit(); } catch (_) {}
  return JSON.stringify({ status: 'closed' });
}
`;

export function macosAXAdapter(options: MacOSAXAdapterOptions = {}): PipelineOpenAdapter {
	const runner = options.runner ?? createNodeCommandRunner();
	const bridge = options.xctestBridgeCommand;
	return {
		name: 'macos-ax',
		platform: 'desktop',
		supports: (target) =>
			options.targetApp === undefined ||
			target.app === undefined ||
			target.app === options.targetApp,
		open: async (target, context): Promise<PipelineDriverSession> => {
			const app = options.app ?? stringValue(target, 'app');
			const appPath = stringValue(target, 'appPath', options.appPath);
			const appName = stringValue(target, 'appName', options.appName);
			const bundleId = stringValue(target, 'bundleId', options.bundleId);
			const processName =
				appName ?? app ?? (appPath === undefined ? bundleId : appNameFromPath(appPath));
			if (appPath !== undefined) {
				await runner({ command: 'open', args: [appPath] });
			} else if (bundleId !== undefined) {
				await runner({ command: 'open', args: ['-b', bundleId] });
			} else if (app !== undefined) {
				await runner({ command: 'open', args: ['-a', app] });
			} else {
				throw new Error(
					'macosAXAdapter needs target.app, target.appPath, or target.bundleId.',
				);
			}
			if (processName === undefined) {
				throw new Error('macosAXAdapter needs an app name for accessibility lookup.');
			}
			return {
				accessibilityTree: async (): Promise<PipelineAccessibilityNode> =>
					parseJsonCommandOutput(
						await runner({
							command: 'osascript',
							args: [
								'-l',
								'JavaScript',
								'-e',
								SNAPSHOT_SCRIPT,
								processName,
								String(options.maxDepth ?? 4),
							],
						}),
						'macos-ax accessibility snapshot',
					),
				action: async (action: PipelineAction) =>
					parseJsonCommandOutput(
						await runner({
							command: 'osascript',
							args: [
								'-l',
								'JavaScript',
								'-e',
								ACTION_SCRIPT,
								processName,
								JSON.stringify(action),
							],
						}),
						'macos-ax action',
					),
				screenshot: async (label: string) => {
					const file = screenshotPath(context.runDir, context.sessionId, label);
					try {
						await runner({ command: 'screencapture', args: ['-x', file] });
					} catch (error) {
						if (bridge === undefined) {
							throw error;
						}
						return parseJsonCommandOutput(
							await runner({
								command: bridge,
								args: [
									'screenshot',
									bridgePayload(target, context, {
										bundleId,
										appPath,
										label,
										path: file,
									}),
								],
							}),
							'macos-xctest screenshot',
						);
					}
					return { label, path: file };
				},
				logs: async () => [],
				crash: async () => null,
				close: async () => {
					await runner({
						command: 'osascript',
						args: ['-l', 'JavaScript', '-e', QUIT_SCRIPT, processName],
					}).catch(() => undefined);
				},
			};
		},
	};
}
