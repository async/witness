import { box } from '@async/witness';

export default box(
	'message updates without reload',
	async ({ environment, project, pipeline, expect, receipt }) => {
		await pipeline.dev();

		const html = await environment.client.request('/');
		await expect.html.contains(html, 'id="message"');

		const primed = await receipt.measure('prime client module graph', async () => {
			await environment.client.request('/src/main.ts');
			await environment.client.request('/src/message.ts');
		});
		receipt.note(`client module graph primed in ${primed.durationMs}ms without a browser`);

		const change = await project.edit('src/message.ts', {
			replace: ['before edit', 'after edit'],
		});

		await expect.edit(change, {
			client: { hmr: 'accepted', invalidated: ['/src/message.ts'] },
		});
		await receipt.capture('after hmr update');
	},
);

// Falsifiability: a wrong expectation must fail with every mismatched field
// across every named environment in one report, not just the first one.
export const WrongExpectation = box(
	{ name: 'wrong edit expectation reports every environment mismatch', tags: ['negative'] },
	async ({ environment, project, pipeline, expect }) => {
		await pipeline.dev();

		await environment.client.request('/');
		await environment.client.request('/src/main.ts');
		await environment.client.request('/src/message.ts');

		const change = await project.edit('src/message.ts', {
			replace: ['before edit', 'after edit'],
		});

		// Reality: client hot-accepts and invalidates /src/message.ts; the ssr
		// graph never imported it. Every field below is deliberately wrong.
		await expect.edit(change, {
			client: { hmr: 'full-reload', invalidated: [] },
			ssr: { hmr: 'accepted' },
		});
	},
);
