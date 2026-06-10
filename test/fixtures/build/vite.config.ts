// This config intentionally avoids importing 'vite' so the fixture can be
// copied to a temp directory (with no node_modules) and still load.

// Simulated user-project plugin: many real plugins (qwik, frameworks) gate
// production-only output on NODE_ENV. The emitted artifact proves gumbox runs
// builds with production semantics even though box discovery started a Vite
// module runner (which sets NODE_ENV=development) in the same process.
const recordNodeEnv = {
	name: 'fixture:record-node-env',
	applyToEnvironment: (environment: { name: string }) => environment.name === 'client',
	generateBundle(this: { emitFile(file: object): void }) {
		this.emitFile({
			type: 'asset',
			fileName: 'node-env.txt',
			source:
				(globalThis as { process?: { env?: { NODE_ENV?: string } } }).process?.env
					?.NODE_ENV ?? 'unset',
		});
	},
};

export default {
	plugins: [recordNodeEnv],
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
