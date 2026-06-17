/**
 * Generates the npm-consumption manifest (package.json) at the repo root from
 * deno.json, which is the canonical workspace/package manifest. The generated
 * package.json is gitignored build output: it only exists so package managers
 * (for example `"@async/witness": "link:../witness"`) can resolve this
 * package and its dist build + CLI bin.
 *
 * This is a host-side Deno tool. It lives outside src/ and test/ on purpose:
 * the runtime-agnostic rule forbids Deno.* in library code, while scripts/ is
 * an explicit host boundary. Run it with `deno task manifest`.
 *
 * Dependency posture: the dist build externalizes small runtime helpers, so the
 * npm manifest must list the packages that installed consumers need at runtime.
 * Vite remains a peer because Witness drives the consuming project's Vite copy.
 */

type DenoManifest = {
	name?: string;
	version?: string;
	imports?: Record<string, string>;
};

function requireField(value: string | undefined, field: string): string {
	if (value === undefined || value.length === 0) {
		throw new Error(`deno.json is missing '${field}', cannot generate package.json.`);
	}
	return value;
}

function requireNpmImport(imports: Record<string, string> | undefined, name: string): string {
	const specifier = imports?.[name];
	if (specifier === undefined || !specifier.startsWith('npm:')) {
		throw new Error(`deno.json is missing npm import '${name}', cannot generate package.json.`);
	}
	const packageSpecifier = specifier.slice('npm:'.length);
	if (packageSpecifier === name) {
		return '*';
	}

	const versionPrefix = `${name}@`;
	if (!packageSpecifier.startsWith(versionPrefix)) {
		throw new Error(`deno.json npm import '${name}' uses unexpected specifier '${specifier}'.`);
	}
	return packageSpecifier.slice(versionPrefix.length);
}

// Consumers bring their own vite (witness drives the project's copy at
// runtime — see src/vite-loader.ts). The workspace pins vite directly in
// deno.json so the loader's bare `import('vite')` fallback resolves from a
// fresh install, but consumers only see this peer range.
const vitePeerRange = '^8.0.0';

const repoRoot = new URL('..', import.meta.url);
const denoManifest = JSON.parse(
	await Deno.readTextFile(new URL('deno.json', repoRoot)),
) as DenoManifest;

const packageManifest = {
	'//': 'generated from deno.json by scripts/generate-package-json.ts — do not edit, do not commit',
	name: requireField(denoManifest.name, 'name'),
	version: requireField(denoManifest.version, 'version'),
	type: 'module',
	repository: {
		type: 'git',
		url: 'git+https://github.com/async/witness.git',
	},
	bugs: {
		url: 'https://github.com/async/witness/issues',
	},
	homepage: 'https://github.com/async/witness#readme',
	files: ['dist'],
	exports: {
		'.': {
			types: './dist/index.d.mts',
			default: './dist/index.mjs',
		},
		'./cli': './dist/witness.mjs',
	},
	bin: {
		witness: 'dist/witness.mjs',
	},
	publishConfig: {
		access: 'public',
	},
	dependencies: {
		mitt: requireNpmImport(denoManifest.imports, 'mitt'),
		pathe: requireNpmImport(denoManifest.imports, 'pathe'),
		tinyglobby: requireNpmImport(denoManifest.imports, 'tinyglobby'),
	},
	peerDependencies: {
		vite: vitePeerRange,
	},
};

await Deno.writeTextFile(
	new URL('package.json', repoRoot),
	`${JSON.stringify(packageManifest, null, '\t')}\n`,
);
console.log(`generated package.json for ${packageManifest.name}@${packageManifest.version}`);
