import path from 'pathe';
import { afterEach, describe, expect, test } from 'vitest';
import { fileURLToPath, pathToFileURL } from '../src/file-url.ts';
import { resolveProjectViteEntryUrl } from '../src/vite-loader.ts';
import { fileSystem } from './support/host-file-system.ts';

// Repo-local scratch space (gitignored) instead of os.tmpdir(), per the
// runtime-agnostic tooling rule: the os module is forbidden in src/ and test/.
const TMP_ROOT = path.join(fileURLToPath(new URL('..', import.meta.url)), '.tmp');

let temporaryProjects: string[] = [];

afterEach(async () => {
	for (const project of temporaryProjects) {
		await fileSystem.remove(project, { recursive: true, force: true });
	}
	temporaryProjects = [];
});

async function createProjectWithVitePackage(manifest: object): Promise<string> {
	const root = await createEmptyProject();
	await writeVitePackageManifest(root, manifest);
	return root;
}

async function createEmptyProject(): Promise<string> {
	await fileSystem.mkdir(TMP_ROOT, { recursive: true });
	const root = await fileSystem.makeTempDirectory({ dir: TMP_ROOT, prefix: 'vite-loader-' });
	temporaryProjects.push(root);
	return root;
}

async function writeVitePackageManifest(root: string, manifest: object): Promise<void> {
	const packageDir = path.join(root, 'node_modules', 'vite');
	await fileSystem.mkdir(packageDir, { recursive: true });
	await fileSystem.writeTextFile(path.join(packageDir, 'package.json'), JSON.stringify(manifest));
}

function viteEntryUrl(root: string, entry: string): string {
	return pathToFileURL(path.join(root, 'node_modules/vite', entry));
}

describe('resolveProjectViteEntryUrl', () => {
	test('resolves a string "." export (vite 8 shape)', async () => {
		const root = await createProjectWithVitePackage({
			name: 'vite',
			exports: { '.': './dist/node/index.js' },
		});
		expect(await resolveProjectViteEntryUrl(root)).toBe(
			viteEntryUrl(root, 'dist/node/index.js'),
		);
	});

	test('resolves a conditional "." export through import/default (vite 6 shape)', async () => {
		const root = await createProjectWithVitePackage({
			name: 'vite',
			exports: {
				'.': {
					import: { types: './dist/node/index.d.ts', default: './dist/node/index.js' },
					require: { types: './index.d.cts', default: './index.cjs' },
				},
			},
		});
		expect(await resolveProjectViteEntryUrl(root)).toBe(
			viteEntryUrl(root, 'dist/node/index.js'),
		);
	});

	test('falls back to main when there is no exports map', async () => {
		const root = await createProjectWithVitePackage({
			name: 'vite',
			main: './dist/node/index.js',
		});
		expect(await resolveProjectViteEntryUrl(root)).toBe(
			viteEntryUrl(root, 'dist/node/index.js'),
		);
	});

	test('walks up to a hoisted node_modules', async () => {
		const workspace = await createProjectWithVitePackage({
			name: 'vite',
			exports: { '.': './dist/node/index.js' },
		});
		const nestedProject = path.join(workspace, 'packages/app');
		await fileSystem.mkdir(nestedProject, { recursive: true });
		expect(await resolveProjectViteEntryUrl(nestedProject)).toBe(
			viteEntryUrl(workspace, 'dist/node/index.js'),
		);
	});

	test('returns undefined when no ancestor carries a vite package', async () => {
		// Asserted from a filesystem root: a temp project inside this repo
		// would (correctly) walk up and find gumbox's own node_modules/vite.
		expect(await resolveProjectViteEntryUrl('/nonexistent-gumbox-probe')).toBe(undefined);
	});
});
