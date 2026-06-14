import path from 'pathe';
import { fileURLToPath } from './file-url.ts';
import { glob } from 'tinyglobby';
import { loadProjectVite, withoutNodeEnvLeak } from './vite-loader.ts';
import { isBoxDefinition, withResolvedName } from './box.ts';
import type { BoxDefinition, DiscoveredBox, DiscoveryResult, InvalidBoxFile } from './types.ts';

const BOX_FILE_GLOB = '**/*.box.{ts,tsx}';
const SKIPPED_DIRECTORY_GLOBS = [
	'**/node_modules/**',
	'**/dist/**',
	'**/.git/**',
	'**/.witness/**',
	'**/.vite/**',
];

/**
 * Box files import '@async/witness', but discovered projects (for example a
 * fixture copied to a temp dir) may have no node_modules. The import is
 * aliased to this package's own entry module instead.
 */
function witnessEntryFile(): string {
	const self = fileURLToPath(import.meta.url);
	// During development this module is `src/discovery.ts` and the public TS
	// entry sits next to it. In the published build this code lives in a
	// chunk shared by the entry and the CLI bin — its exports are mangled, so
	// the alias must point at the sibling public entry `index.mjs`, never at
	// the chunk itself.
	if (path.basename(self) === 'discovery.ts') {
		return path.join(path.dirname(self), 'index.ts');
	}
	return path.join(path.dirname(self), 'index.mjs');
}

async function collectBoxFiles(root: string): Promise<string[]> {
	const found = await glob(BOX_FILE_GLOB, {
		cwd: root,
		absolute: true,
		dot: true,
		ignore: SKIPPED_DIRECTORY_GLOBS,
	});
	return found.sort();
}

/** Strips the `.box.ts(x)` suffix from a root-relative box file path. */
function withoutBoxExtension(relativeFile: string): string {
	return relativeFile.replace(/\.box\.tsx?$/, '');
}

type PendingBox = {
	file: string;
	relativeFile: string;
	exportName: string;
	definition: BoxDefinition;
};

function deriveName(base: string, exportName: string): string {
	return exportName === 'default' ? base : `${base}: ${exportName}`;
}

/**
 * Resolves every box's display name. Explicit names always win. Anonymous
 * boxes derive from the file basename ('cart' for cart.box.ts) plus the
 * export name for named exports ('cart: full'). When two derived names
 * collide, the colliding ones upgrade to relative-path bases instead
 * ('scenarios/cart'), so names stay unique without erroring on a legitimate
 * project layout.
 */
function resolveBoxNames(pending: PendingBox[]): DiscoveredBox[] {
	const proposals = pending.map((entry) => {
		if (entry.definition.name !== null) {
			return { entry, name: entry.definition.name, derived: false };
		}
		const base = withoutBoxExtension(path.basename(entry.relativeFile));
		return { entry, name: deriveName(base, entry.exportName), derived: true };
	});
	const nameCounts = new Map<string, number>();
	for (const proposal of proposals) {
		nameCounts.set(proposal.name, (nameCounts.get(proposal.name) ?? 0) + 1);
	}
	return proposals.map(({ entry, name, derived }) => {
		const collides = (nameCounts.get(name) ?? 0) > 1;
		const resolved =
			derived && collides
				? deriveName(withoutBoxExtension(entry.relativeFile), entry.exportName)
				: name;
		return {
			file: entry.file,
			relativeFile: entry.relativeFile,
			exportName: entry.exportName,
			box: withResolvedName(entry.definition, resolved),
		};
	});
}

/**
 * Finds `*.box.ts` / `*.box.tsx` files under the root and loads them through
 * Vite's module runner (`runnerImport`), so box files stay TypeScript without
 * extra tooling. Invalid box files are reported with actionable errors
 * instead of failing the whole discovery.
 */
export async function discoverBoxes(options: { root: string }): Promise<DiscoveryResult> {
	const root = path.resolve(options.root);
	const pending: PendingBox[] = [];
	const invalid: InvalidBoxFile[] = [];
	const vite = await loadProjectVite(root);
	for (const file of await collectBoxFiles(root)) {
		const relativeFile = path.relative(root, file).split(path.sep).join('/');
		try {
			// The module runner sets NODE_ENV when unset; discovery is witness
			// machinery and must not change what the user's pipeline later sees.
			const { module } = await withoutNodeEnvLeak(() =>
				vite.runnerImport<Record<string, unknown>>(file, {
					root,
					logLevel: 'error',
					resolve: {
						alias: { '@async/witness': witnessEntryFile() },
					},
				}),
			);
			const exported = Object.entries(module).filter(
				(entry): entry is [string, BoxDefinition] => isBoxDefinition(entry[1]),
			);
			if (exported.length === 0) {
				invalid.push({
					file,
					relativeFile,
					error: `${relativeFile} does not export a box. Export the result of box(name, run) from '@async/witness' as the default export or a named export.`,
				});
				continue;
			}
			for (const [exportName, definition] of exported) {
				pending.push({ file, relativeFile, exportName, definition });
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
	return { root, boxes: resolveBoxNames(pending), invalid };
}
