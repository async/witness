// This config intentionally avoids importing 'vite' so the fixture can be
// copied to a temp directory (with no node_modules) and still load.
export default {
	environments: {
		client: {
			build: {
				outDir: 'dist/client',
				manifest: true,
			},
		},
	},
};
