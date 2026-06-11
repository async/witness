// This config intentionally avoids importing 'vite' so the fixture can be
// copied to a temp directory (with no node_modules) and still load.

const SLOW_DEP_ID = 'slow-to-resolve';
const RESOLVED_SLOW_DEP_ID = `\0${SLOW_DEP_ID}`;

/**
 * Keeps the background dependency scan in flight long after a box body
 * finishes: the scanner resolves the bare 'slow-to-resolve' import through
 * the plugin container, and this plugin sleeps before answering. A box that
 * opens the dev server and returns immediately then reaches teardown while
 * the scan is still running — the race that made Vite log spurious "Failed
 * to run dependency scan" errors when the server closed mid-scan.
 */
const slowDependencyScanPlugin = {
	name: 'fixture:slow-dependency-scan',
	async resolveId(id, _importer, options) {
		if (id !== SLOW_DEP_ID) {
			return undefined;
		}
		if (options?.scan === true) {
			await new Promise((resolve) => setTimeout(resolve, 2000));
		}
		return RESOLVED_SLOW_DEP_ID;
	},
	load(id) {
		if (id === RESOLVED_SLOW_DEP_ID) {
			return 'export {}';
		}
		return undefined;
	},
};

export default {
	// Keep the optimizer cache inside the (temp) project root: the default
	// cacheDir resolves to the repo's shared node_modules/.vite, and a cache
	// hit there would skip the dependency scan this fixture exists to slow.
	cacheDir: '.vite',
	plugins: [slowDependencyScanPlugin],
};
