import { execFile } from 'node:child_process';
import { copyFile, readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import path from 'pathe';
import { afterEach, describe, expect, test } from 'vitest';
import { fileURLToPath } from '../src/file-url.ts';
import { macosAXAdapter, runBoxes } from '../src/index.ts';
import type { DiscoveredBox, PipelineAccessibilityNode, PipelineAppHandle } from '../src/index.ts';
import { fileSystem } from './support/host-file-system.ts';

const execFileAsync = promisify(execFile);
const runLiveMacOS = process.env.WITNESS_NATIVE_MACOS === '1';
const openSourceRoot = fileURLToPath(new URL('../..', import.meta.url));
const arcadeRoot = process.env.ARCADE_REPO ?? path.join(openSourceRoot, 'arcade');
const demoScript = path.join(
	arcadeRoot,
	'poc/fixtures/proofs/macos-native-rendering-target/macos/Scripts/run-macos-demo.sh',
);
const demoProcessName = 'ArcadeDesktopProofDemo';
const demoBundleId = 'dev.arcade.desktopproof.demo';
const demoAppPath = path.join(
	arcadeRoot,
	'poc/fixtures/proofs/macos-native-rendering-target/macos/.build/interactive-demo',
	`${demoProcessName}.app`,
);
const defaultXCTestBridge = path.join(
	fileURLToPath(new URL('.', import.meta.url)),
	'support/macos-xctest-bridge/bridge.mjs',
);
const latestMacOSReceipt = path.join(
	fileURLToPath(new URL('.', import.meta.url)),
	'support/macos-xctest-bridge/.build/latest-witness-receipt.json',
);
const latestMacOSScreenshot = path.join(
	fileURLToPath(new URL('.', import.meta.url)),
	'support/macos-xctest-bridge/.build/latest-after-increment.png',
);
const TMP_ROOT = path.join(fileURLToPath(new URL('..', import.meta.url)), '.tmp');
const temporaryRoots: string[] = [];

async function createRoot(): Promise<string> {
	await fileSystem.mkdir(TMP_ROOT, { recursive: true });
	const root = await fileSystem.makeTempDirectory({
		dir: TMP_ROOT,
		prefix: 'witness-native-macos-',
	});
	temporaryRoots.push(root);
	return root;
}

function nodeText(node: PipelineAccessibilityNode): string {
	return [node.role, node.name, node.value]
		.filter((part): part is string => typeof part === 'string')
		.join(' ');
}

function hasAccessibleText(node: PipelineAccessibilityNode, text: string): boolean {
	if (nodeText(node).includes(text)) {
		return true;
	}
	return node.children?.some((child) => hasAccessibleText(child, text)) ?? false;
}

async function waitForAccessibleText(
	app: PipelineAppHandle,
	text: string,
	label: string,
): Promise<void> {
	const deadline = Date.now() + 3000;
	let lastTree: PipelineAccessibilityNode | null = null;
	while (Date.now() < deadline) {
		const capture = await app.accessibility.snapshot(label);
		lastTree = capture.tree as PipelineAccessibilityNode;
		if (hasAccessibleText(lastTree, text)) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error(
		`Timed out waiting for native accessibility text '${text}'. Last tree: ${JSON.stringify(lastTree)}`,
	);
}

async function assertSystemEventsCanReadDemoProcess(): Promise<void> {
	const script = `
function run(argv) {
  var process = Application('System Events').processes.byName(argv[0]);
  return JSON.stringify({ name: String(process.name()) });
}
`;
	try {
		await execFileAsync('osascript', ['-l', 'JavaScript', '-e', script, demoProcessName], {
			timeout: 3000,
		});
	} catch (error) {
		throw new Error(
			`macOS accessibility preflight failed. Grant Accessibility/Automation access to this terminal or Codex host so System Events can inspect ${demoProcessName}. ${error instanceof Error ? error.message : error}`,
		);
	}
}

afterEach(async () => {
	if (runLiveMacOS) {
		await execFileAsync('pkill', ['-x', demoProcessName]).catch(() => undefined);
	}
	await Promise.all(
		temporaryRoots
			.splice(0)
			.map((dir) => fileSystem.remove(dir, { recursive: true, force: true })),
	);
});

describe.skipIf(!runLiveMacOS)('macOS native pipeline.open proof', () => {
	test('observes a real AppKit count increment through accessibility receipts', async () => {
		const scriptSource = await readFile(demoScript, 'utf8');
		const appPath = scriptSource.includes('--build-only')
			? (await execFileAsync('bash', [demoScript, '--build-only'])).stdout
					.trim()
					.split(/\r?\n/)
					.at(-1)
			: demoAppPath;
		if (!scriptSource.includes('--build-only')) {
			expect(scriptSource).toContain('--verify-launch');
			await execFileAsync('bash', [demoScript, '--verify-launch']);
		}
		expect(appPath).toMatch(/ArcadeDesktopProofDemo\.app$/);
		await execFileAsync('open', [appPath!]);
		await assertSystemEventsCanReadDemoProcess();

		const root = await createRoot();
		const boxes: DiscoveredBox[] = [
			{
				file: path.join(root, 'native-macos.box.ts'),
				relativeFile: 'native-macos.box.ts',
				exportName: 'default',
				box: {
					name: 'macOS native count increments through pipeline.open',
					tags: [],
					modes: ['dev'],
					ui: false,
					run: async ({ pipeline }) => {
						const app = await pipeline.open({ app: 'arcade-shell' });
						await waitForAccessibleText(app, 'Count 0', 'initial count');
						await app.action({ kind: 'activate', role: 'AXButton', name: 'Count 0' });
						await waitForAccessibleText(app, 'Count 1', 'after increment');
						await app.screenshot('after increment');
						await app.close();
					},
				},
			},
		];

		const result = await runBoxes({
			root,
			boxes,
			fileSystem,
			adapters: macosAXAdapter({
				targetApp: 'arcade-shell',
				appPath,
				appName: demoProcessName,
				bundleId: demoBundleId,
				xctestBridgeCommand: process.env.WITNESS_MACOS_XCTEST_BRIDGE ?? defaultXCTestBridge,
			}),
		});

		const receiptText = await fileSystem.readTextFile(result.receiptPath);
		const receipt = JSON.parse(receiptText) as {
			boxes: Array<Record<string, any>>;
		};
		const session = receipt.boxes[0]!.apps.sessions[0] as Record<string, any>;
		await fileSystem.mkdir(path.dirname(latestMacOSReceipt), { recursive: true });
		const screenshot = session.screenshots[0] as Record<string, any> | undefined;
		if (typeof screenshot?.path === 'string') {
			await copyFile(screenshot.path, latestMacOSScreenshot);
			screenshot.path = latestMacOSScreenshot;
		}
		await fileSystem.writeTextFile(
			latestMacOSReceipt,
			`${JSON.stringify(receipt, null, '\t')}\n`,
		);
		if (result.status !== 'passed') {
			throw new Error(
				[
					'macOS native pipeline.open proof failed.',
					result.boxes.map((box) => box.error?.message ?? box.status).join('\n'),
					JSON.stringify(receipt.boxes[0], null, 2),
				].join('\n'),
			);
		}
		expect(result.status).toBe('passed');
		expect(session).toMatchObject({
			platform: 'desktop',
			adapter: 'macos-ax',
			status: 'closed',
			target: {
				app: 'arcade-shell',
			},
		});
		expect(
			session.accessibility.some((capture: any) =>
				hasAccessibleText(capture.tree, 'Count 0'),
			),
		).toBe(true);
		expect(
			session.accessibility.some((capture: any) =>
				hasAccessibleText(capture.tree, 'Count 1'),
			),
		).toBe(true);
		expect(session.actions).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ kind: 'activate', role: 'AXButton', name: 'Count 0' }),
			]),
		);
		expect(session.screenshots).toEqual(
			expect.arrayContaining([expect.objectContaining({ label: 'after increment' })]),
		);
	}, 30_000);
});
