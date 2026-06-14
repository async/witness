import { box } from '@async/witness';

// Some plugins swallow an update outright: the hotUpdate hook observes the
// change, returns [], and broadcasts nothing. The environment's reaction is
// "saw it, did nothing" — and proving that must not cost the full assertion
// timeout. The hook firing is the causal signal that the watcher processed
// the edit; after a short quiet window with no further evidence, the outcome
// settles as hmr 'none' with the originally invalidated modules.
export default box(
	'suppressed hot update settles without a payload',
	async ({ environment, project, pipeline, expect }) => {
		await pipeline.dev();

		await environment.client.request('/');
		await environment.client.request('/src/main.ts');
		await environment.client.request('/src/silent.ts');

		const change = await project.edit('src/silent.ts', {
			replace: ['silent before', 'silent after'],
		});

		// timeoutMs is deliberately long: the box must settle via the quiet
		// window long before the deadline, which the runtime test asserts.
		await expect.edit(
			change,
			{
				client: {
					hmr: 'none',
					invalidated: ['/src/silent.ts'],
				},
			},
			{ timeoutMs: 10_000 },
		);
	},
);
