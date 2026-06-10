// This config intentionally avoids importing 'vite' so the fixture can be
// copied to a temp directory (with no node_modules) and still load.
export default {
	environments: {
		client: {
			build: {
				outDir: 'dist/client',
				manifest: true,
				rollupOptions: {
					output: {
						entryFileNames: 'assets/[name].js',
						chunkFileNames: 'assets/[name].js',
						assetFileNames: 'assets/[name][extname]',
					},
				},
			},
		},
		ssr: {
			build: {
				outDir: 'dist/server',
				rollupOptions: {
					input: { 'entry-server': './src/entry-server.ts' },
					output: {
						entryFileNames: '[name].js',
					},
				},
			},
		},
	},
};
