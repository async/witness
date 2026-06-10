import { resolve as resolveModuleUrl } from 'mlly';
import path from 'pathe';

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
		// Resolve like an import written in a file at the project root.
		const resolvedUrl = await resolveModuleUrl('vite', {
			url: path.join(root, 'package.json'),
		});
		return (await import(resolvedUrl)) as ViteModule;
	} catch {
		// No project-local vite (for example gumbox's own copied test
		// fixtures); gumbox's bundled vite dependency is the fallback.
		return (await import('vite')) as ViteModule;
	}
}
