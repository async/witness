import { box } from '@async/witness';

// The Vite app lives in `app/`, not at the box root. This is the shape of a
// repo whose fixtures are subdirectories (for example qwik-bundler): the box
// overlays the dev root while project.edit stays relative to the runner root.
export default box(
	'app subdirectory edit hot-updates with fixture-rooted evidence',
	async ({ environment, project, pipeline, expect, receipt }) => {
		await pipeline.dev({
			config: (config) => ({ ...config, root: `${config.root}/app` }),
		});

		// Prime the client module graph without a browser.
		await environment.client.request('/');
		await environment.client.request('/src/main.ts');
		await environment.client.request('/src/message.ts');

		const change = await project.edit('app/src/message.ts', {
			replace: ['nested before', 'nested after'],
		});

		await expect.edit(change, {
			client: { hmr: 'accepted', invalidated: ['/src/message.ts'] },
		});
		await receipt.capture('after nested hmr update');
	},
);

// Builds with an overlaid root (the qwik-bundler fixture shape again) must
// still record their artifacts: outDirs and artifact paths are runner-root
// relative so expect.artifact.* and the receipt agree on one base.
export const NestedBuild = box(
	{ name: 'app subdirectory build records runner-root-relative artifacts', modes: ['build'] },
	async ({ pipeline, expect }) => {
		const build = await pipeline.build({
			config: (config) => ({ ...config, root: `${config.root}/app` }),
		});

		await expect.build.environment(build, 'client');
		await expect.build.artifact(build, 'app/dist/index.html');
		await expect.artifact.exists(build, 'app/dist/index.html');
		await expect.artifact.text(build, 'app/dist/index.html', {
			contains: 'Witness nested fixture',
		});
	},
);
