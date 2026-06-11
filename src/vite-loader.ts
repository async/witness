import path from 'pathe';
import { pathToFileURL } from './file-url.ts';

export type ViteModule = typeof import('vite');

const loadedByRoot = new Map<string, Promise<ViteModule>>();

/**
 * Loads the project's own vite package, resolved from the project root.
 *
 * Gumbox is often linked into a project (`link:../gumbox`) that carries its
 * own vite copy in node_modules. Gumbox must drive the pipeline with THAT
 * copy: the project's plugins are loaded against their vite instance, and
 * orchestrating them with a second instance silently diverges — plugin state
 * shared across environment builds (for example a client manifest consumed by
 * the SSR build) breaks across instances.
 */
export function loadProjectVite(root: string): Promise<ViteModule> {
	let loaded = loadedByRoot.get(root);
	if (loaded === undefined) {
		loaded = resolveAndImportVite(root);
		loadedByRoot.set(root, loaded);
	}
	return loaded;
}

type HostProcessLike = { env?: Record<string, string | undefined> };

function hostProcessEnv(): Record<string, string | undefined> | undefined {
	return (globalThis as { process?: HostProcessLike }).process?.env;
}

/** The NODE_ENV the host process currently carries, for receipt evidence. */
export function hostNodeEnv(): string | undefined {
	return hostProcessEnv()?.NODE_ENV;
}

/**
 * Runs a gumbox-internal Vite operation without leaking its NODE_ENV side
 * effect into the host process. Vite's dev-flavored entry points (for example
 * the module runner gumbox uses for box discovery) set NODE_ENV when it is
 * unset; the user's own pipeline commands must still see exactly the
 * environment the operator launched gumbox with — gumbox never imposes an
 * env, it only cleans up after itself.
 */
export async function withoutNodeEnvLeak<T>(run: () => Promise<T>): Promise<T> {
	const env = hostProcessEnv();
	if (env === undefined) {
		return await run();
	}
	const before = env.NODE_ENV;
	try {
		return await run();
	} finally {
		if (before === undefined) {
			delete env.NODE_ENV;
		} else {
			env.NODE_ENV = before;
		}
	}
}

async function resolveAndImportVite(root: string): Promise<ViteModule> {
	try {
		const resolvedUrl = await resolveProjectViteEntryUrl(root);
		if (resolvedUrl !== undefined) {
			return (await import(resolvedUrl)) as ViteModule;
		}
	} catch {
		// Resolution found a vite package the runtime could not import;
		// fall through to gumbox's own copy below.
	}
	// No project-local vite (for example gumbox's own copied test
	// fixtures); gumbox's bundled vite dependency is the fallback.
	return (await import('vite')) as ViteModule;
}

type PackageManifest = {
	exports?: unknown;
	module?: string;
	main?: string;
};

/**
 * Finds the project's vite entry module by walking `node_modules/vite` up
 * from the root, the same ancestors Node-style resolution would consult.
 * Exported for tests. Returns undefined when no ancestor carries vite, and
 * deliberately avoids `node:module`/mlly so the lookup stays runtime-agnostic.
 */
export async function resolveProjectViteEntryUrl(root: string): Promise<string | undefined> {
	let directory = path.resolve(root);
	// The walk stops BEFORE the filesystem root: a probe there would be
	// `/node_modules/vite/package.json`, which Vite-managed import graphs
	// (gumbox often runs inside one) resolve root-relative and false-positive
	// on the host project's own vite.
	while (path.dirname(directory) !== directory) {
		const packageDir = path.join(directory, 'node_modules', 'vite');
		const manifest = await importPackageManifest(path.join(packageDir, 'package.json'));
		if (manifest !== undefined) {
			const entry = packageEntryPath(manifest);
			if (entry !== undefined) {
				return pathToFileURL(path.join(packageDir, entry));
			}
		}
		directory = path.dirname(directory);
	}
	return undefined;
}

/**
 * Reads a package.json through the runtime's own module loader (standard
 * JSON import attributes work on Node, Deno, and Bun) instead of filesystem
 * APIs, so this module needs no injected GumboxFileSystem.
 */
async function importPackageManifest(manifestPath: string): Promise<PackageManifest | undefined> {
	try {
		const imported = (await import(pathToFileURL(manifestPath), {
			with: { type: 'json' },
		})) as { default?: PackageManifest };
		return imported.default;
	} catch {
		return undefined;
	}
}

/**
 * Conditions accepted when reading vite's `exports["."]`, in spec order:
 * nested condition objects are tried key by key, keeping the first match.
 */
const ENTRY_EXPORT_CONDITIONS = new Set(['import', 'module-sync', 'default']);

function packageEntryPath(manifest: PackageManifest): string | undefined {
	const { exports } = manifest;
	if (exports !== undefined) {
		const rootExport = isConditionRecord(exports) && '.' in exports ? exports['.'] : exports;
		return entryExportTarget(rootExport);
	}
	return manifest.module ?? manifest.main;
}

function entryExportTarget(exportValue: unknown): string | undefined {
	if (typeof exportValue === 'string') {
		return exportValue;
	}
	if (!isConditionRecord(exportValue)) {
		return undefined;
	}
	for (const [condition, nested] of Object.entries(exportValue)) {
		if (!ENTRY_EXPORT_CONDITIONS.has(condition)) {
			continue;
		}
		const target = entryExportTarget(nested);
		if (target !== undefined) {
			return target;
		}
	}
	return undefined;
}

function isConditionRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
