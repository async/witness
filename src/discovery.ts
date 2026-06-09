import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';
import { isBoxDefinition } from './box.ts';
import type { BoxDefinition, DiscoveredBox, DiscoveryResult, InvalidBoxFile } from './types.ts';

const BOX_FILE_PATTERN = /\.box\.tsx?$/;
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', '.git', '.gumbox', '.vite']);

/**
 * Box files import '@gumbox/vite', but discovered projects (for example a
 * fixture copied to a temp dir) may have no node_modules. The import is
 * aliased to this package's own entry module instead.
 */
function gumboxEntryFile(): string {
	const self = fileURLToPath(import.meta.url);
	// During development this module is `src/discovery.ts` and the public
	// entry sits next to it; the published build bundles everything into the
	// entry file itself, so `import.meta.url` already is the entry.
	if (path.basename(self) === 'discovery.ts') {
		return path.join(path.dirname(self), 'index.ts');
	}
	return self;
}

async function collectBoxFiles(root: string): Promise<string[]> {
	const found: string[] = [];
	const walk = async (directory: string): Promise<void> => {
		const entries = await readdir(directory, { withFileTypes: true });
		for (const entry of entries) {
			if (entry.isDirectory()) {
				if (!SKIPPED_DIRECTORIES.has(entry.name)) {
					await walk(path.join(directory, entry.name));
				}
				continue;
			}
			if (entry.isFile() && BOX_FILE_PATTERN.test(entry.name)) {
				found.push(path.join(directory, entry.name));
			}
		}
	};
	await walk(root);
	return found.sort();
}

/**
 * Finds `*.box.ts` / `*.box.tsx` files under the root and loads them through
 * Vite's module runner (`runnerImport`), so box files stay TypeScript without
 * extra tooling. Invalid box files are reported with actionable errors
 * instead of failing the whole discovery.
 */
export async function discoverBoxes(options: { root: string }): Promise<DiscoveryResult> {
	const root = path.resolve(options.root);
	const boxes: DiscoveredBox[] = [];
	const invalid: InvalidBoxFile[] = [];
	for (const file of await collectBoxFiles(root)) {
		const relativeFile = path.relative(root, file).split(path.sep).join('/');
		try {
			const { module } = await runnerImport<Record<string, unknown>>(file, {
				root,
				logLevel: 'error',
				resolve: {
					alias: { '@gumbox/vite': gumboxEntryFile() },
				},
			});
			const exported = Object.entries(module).filter(
				(entry): entry is [string, BoxDefinition] => isBoxDefinition(entry[1]),
			);
			if (exported.length === 0) {
				invalid.push({
					file,
					relativeFile,
					error: `${relativeFile} does not export a box. Export the result of box(name, run) from '@gumbox/vite' as the default export or a named export.`,
				});
				continue;
			}
			for (const [exportName, definition] of exported) {
				boxes.push({ file, relativeFile, exportName, box: definition });
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			invalid.push({
				file,
				relativeFile,
				error: `failed to load ${relativeFile}: ${message}. Fix the file so it can be imported, then export box(name, run) definitions from it.`,
			});
		}
	}
	return { root, boxes, invalid };
}
