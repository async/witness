import { box } from 'gumbox';

// The fixture's vite config holds the dependency scanner open for two
// seconds, so this box always finishes while the scan is still in flight and
// teardown must let the scan settle instead of closing the server mid-scan.
export default box(
	{ name: 'box finishes before the dependency scan', modes: ['dev'] },
	async ({ pipeline }) => {
		await pipeline.dev();
	},
);
