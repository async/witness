import { defineConfig } from 'vite-plus';

export default defineConfig({
	staged: {
		'*': 'pnpm run check',
	},
	pack: {
		entry: {
			index: './src/index.ts',
			witness: './src/cli/witness.ts',
		},
		format: ['esm'],
		dts: true,
		clean: true,
		deps: {
			// Keep runtime helpers and the consumer project's Vite copy external.
			neverBundle: ['mitt', 'pathe', 'tinyglobby', 'vite'],
		},
	},
	test: {
		environment: 'node',
		include: ['test/**/*.test.ts'],
	},
	lint: {
		ignorePatterns: ['dist/**', 'node_modules/**', 'docs/**'],
	},
	fmt: {
		useTabs: true,
		tabWidth: 4,
		printWidth: 100,
		endOfLine: 'lf',
		singleQuote: true,
		ignorePatterns: ['dist/**', 'node_modules/**', 'docs/**'],
	},
});
