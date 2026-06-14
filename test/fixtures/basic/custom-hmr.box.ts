import { box } from '@async/witness';

// Frameworks like qwik replace Vite's 'update' payload with their own hot
// messages. The framework message is the terminal HMR evidence then:
// expect.edit's `messages` must observe it, and the outcome must settle on it
// instead of timing out.
export default box(
	'custom hot payload replaces the vite update protocol',
	async ({ environment, project, pipeline, expect }) => {
		await pipeline.dev();

		await environment.client.request('/');
		await environment.client.request('/src/main.ts');
		await environment.client.request('/src/custom-message.ts');

		const change = await project.edit('src/custom-message.ts', {
			replace: ['custom before', 'custom after'],
		});

		await expect.edit(change, {
			client: {
				hmr: 'none',
				messages: ['fixture:hmr'],
				invalidated: ['/src/custom-message.ts'],
			},
		});
	},
);
