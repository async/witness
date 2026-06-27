import path from 'pathe';
import { afterEach, describe, expect, test } from 'vitest';
import { fileURLToPath } from '../src/file-url.ts';
import { runBoxes } from '../src/index.ts';
import type { DiscoveredBox, PipelineOpenAdapter } from '../src/index.ts';
import { fileSystem } from './support/host-file-system.ts';

const TMP_ROOT = path.join(fileURLToPath(new URL('..', import.meta.url)), '.tmp');

const temporaryRoots: string[] = [];

async function createRoot(): Promise<string> {
	await fileSystem.mkdir(TMP_ROOT, { recursive: true });
	const root = await fileSystem.makeTempDirectory({
		dir: TMP_ROOT,
		prefix: 'witness-pipeline-open-',
	});
	temporaryRoots.push(root);
	return root;
}

afterEach(async () => {
	await Promise.all(
		temporaryRoots
			.splice(0)
			.map((dir) => fileSystem.remove(dir, { recursive: true, force: true })),
	);
});

describe('pipeline.open receipts', () => {
	test('records accessibility, action, screenshot, log, and witness evidence', async () => {
		const root = await createRoot();
		const adapter: PipelineOpenAdapter = {
			name: 'fake-desktop',
			platform: 'desktop',
			supports: (target) => target.app === 'arcade-shell',
			open: async () => ({
				accessibilityTree: async () => ({
					role: 'window',
					name: 'Arcade Shell',
					children: [{ role: 'button', name: 'Run' }],
				}),
				action: async (action) => ({ ...action, status: 'passed' }),
				screenshot: async (label) => ({ label, path: 'apps/after-run.png' }),
				logs: async () => [{ level: 'info', text: 'ready' }],
				crash: async () => null,
			}),
		};
		const boxes: DiscoveredBox[] = [
			{
				file: path.join(root, 'pipeline-open.box.ts'),
				relativeFile: 'pipeline-open.box.ts',
				exportName: 'default',
				box: {
					name: 'pipeline.open receipt evidence',
					tags: [],
					modes: ['dev'],
					ui: false,
					run: async ({ pipeline }) => {
						const app = await pipeline.open({ app: 'arcade-shell' });
						await app.accessibility.snapshot('initial tree');
						await app.action({ kind: 'activate', role: 'button', name: 'Run' });
						await app.screenshot('after run');
						await app.close();
					},
				},
			},
		];

		const result = await runBoxes({ root, boxes, fileSystem, adapters: adapter });

		expect(result.status).toBe('passed');
		const receipt = JSON.parse(await fileSystem.readTextFile(result.receiptPath)) as {
			boxes: Array<Record<string, any>>;
		};
		const box = receipt.boxes[0]!;
		expect(box.apps.sessions[0]).toMatchObject({
			platform: 'desktop',
			adapter: 'fake-desktop',
			status: 'closed',
			target: { app: 'arcade-shell' },
			accessibility: [
				{ label: 'initial tree', tree: { role: 'window', name: 'Arcade Shell' } },
			],
			actions: [{ kind: 'activate', role: 'button', name: 'Run' }],
			screenshots: [{ label: 'after run', path: 'apps/after-run.png' }],
			logs: [{ level: 'info', text: 'ready' }],
			crash: null,
		});
		const timeline = box.timeline as Array<{ type: string; witness: string }>;
		expect(timeline.map((event) => event.type)).toEqual(
			expect.arrayContaining([
				'app opened',
				'app accessibility captured',
				'app action performed',
				'app screenshot captured',
				'app closed',
			]),
		);
		expect(timeline.filter((event) => event.type.startsWith('app '))).toSatisfy(
			(events: Array<{ witness: string }>) =>
				events.every((event) => event.witness === 'driver'),
		);
		expect(box.witnesses.driver).toMatchObject({ verdict: 'corroborates' });
	});
});
