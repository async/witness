// This config intentionally avoids importing 'vite' so the fixture can be
// copied to a temp directory (with no node_modules) and still load.

/**
 * Emulates frameworks (for example qwik) that replace Vite's standard
 * 'update' payload with their own custom hot protocol: edits to
 * custom-message.ts broadcast a 'fixture:hmr' custom payload and suppress
 * Vite's default propagation by returning an empty module list.
 */
const customHotProtocolPlugin = {
	name: 'fixture:custom-hot-protocol',
	hotUpdate(context) {
		if (!context.file.endsWith('custom-message.ts')) {
			return undefined;
		}
		this.environment.hot.send({
			type: 'custom',
			event: 'fixture:hmr',
			data: { file: context.file, t: Date.now() },
		});
		return [];
	},
};

/**
 * Emulates plugins that swallow an update entirely: edits to silent.ts
 * suppress Vite's propagation and broadcast nothing, so the environment never
 * emits a terminal payload for the edit. The pipeline reaction is exactly
 * "the watcher saw it and nothing happened".
 */
const swallowedHotUpdatePlugin = {
	name: 'fixture:swallowed-hot-update',
	hotUpdate(context) {
		if (!context.file.endsWith('silent.ts')) {
			return undefined;
		}
		return [];
	},
};

export default {
	define: {
		// The restart box replaces this marker to prove that a config-file
		// edit restarts the dev server.
		__GUMBOX_CONFIG_MARKER__: JSON.stringify('marker-before'),
	},
	plugins: [customHotProtocolPlugin, swallowedHotUpdatePlugin],
	environments: {
		// One extra server-runnable environment so environment isolation is testable.
		ssr: {},
	},
};
