import path from 'pathe';
import { glob } from 'tinyglobby';
import * as viteModule from 'vite';
import { build } from 'vite';
import type { InlineConfig } from 'vite';
import type { GumboxFileSystem } from './filesystem.ts';
import { resolveWithinRoot } from './project.ts';
import type {
	ArtifactHandle,
	BuildArtifact,
	BuildHandle,
	BuildRecord,
	PipelineBuildOptions,
} from './types.ts';

type BuilderEnvironmentLike = {
	config: { build?: { outDir?: string } };
};

type ViteBuilderLike = {
	environments: Record<string, BuilderEnvironmentLike>;
	buildApp(): Promise<void>;
};

type CreateBuilderFn = (inlineConfig?: InlineConfig) => Promise<ViteBuilderLike>;

/**
 * `createBuilder` shipped with the Environment API. Resolve it dynamically so
 * older Vite versions without it fall back to the single `build()` pipeline
 * instead of failing at import time.
 */
function resolveCreateBuilder(): CreateBuilderFn | undefined {
	const candidate = (viteModule as { createBuilder?: unknown }).createBuilder;
	return typeof candidate === 'function' ? (candidate as CreateBuilderFn) : undefined;
}

function relativeOutDir(root: string, outDir: string | undefined): string {
	if (outDir === undefined) {
		return 'dist';
	}
	return path.isAbsolute(outDir) ? path.relative(root, outDir) : outDir;
}

async function scanArtifacts(
	root: string,
	outDirs: string[],
	fileSystem: GumboxFileSystem,
): Promise<BuildArtifact[]> {
	const found = await glob(
		outDirs.map((outDir) => `${outDir}/**/*`),
		{ cwd: root, dot: true, onlyFiles: true },
	);
	found.sort();
	const artifacts: BuildArtifact[] = [];
	for (const artifactPath of found) {
		artifacts.push({
			path: artifactPath,
			bytes: await fileSystem.fileSize(path.join(root, artifactPath)),
		});
	}
	return artifacts;
}

function describeArtifacts(artifacts: readonly BuildArtifact[]): string {
	if (artifacts.length === 0) {
		return '(no artifacts were emitted)';
	}
	const shown = artifacts.slice(0, 10).map((artifact) => artifact.path);
	const remaining = artifacts.length - shown.length;
	return remaining > 0 ? `${shown.join(', ')} and ${remaining} more` : shown.join(', ');
}

/**
 * Runs the user's Vite build pipeline: `createBuilder()` builds every
 * configured environment; the single `build()` call is the compatibility
 * fallback. Returns the box-facing handle plus the receipt record.
 */
export async function runPipelineBuild(args: {
	root: string;
	fileSystem: GumboxFileSystem;
	buildId: string;
	options?: PipelineBuildOptions | undefined;
	onTimeline(type: string, detail: Record<string, unknown>): void;
}): Promise<{ handle: BuildHandle; record: BuildRecord }> {
	const { root, fileSystem, buildId, options, onTimeline } = args;
	let inline: InlineConfig = { root, logLevel: 'error' };
	if (options?.config !== undefined) {
		inline = options.config(inline) ?? inline;
	}
	const createBuilder = resolveCreateBuilder();
	const strategy: BuildRecord['strategy'] = createBuilder === undefined ? 'build' : 'builder';
	const startedAt = new Date().toISOString();
	const startedAtMs = performance.now();
	onTimeline('build started', { strategy });

	const outDirs: Record<string, string> = {};
	let environments: string[];
	if (createBuilder !== undefined) {
		const builder = await createBuilder(inline);
		environments = Object.keys(builder.environments);
		await builder.buildApp();
		for (const name of environments) {
			outDirs[name] = relativeOutDir(root, builder.environments[name]?.config.build?.outDir);
			onTimeline('build environment completed', { environment: name, outDir: outDirs[name] });
		}
	} else {
		// Compatibility fallback: build() runs only the default client pipeline.
		await build(inline);
		environments = ['client'];
		outDirs['client'] = relativeOutDir(root, inline.build?.outDir);
		onTimeline('build environment completed', {
			environment: 'client',
			outDir: outDirs['client'],
		});
	}

	const artifacts = await scanArtifacts(root, [...new Set(Object.values(outDirs))], fileSystem);
	const durationMs = Math.round((performance.now() - startedAtMs) * 1000) / 1000;
	const record: BuildRecord = {
		id: buildId,
		strategy,
		environments,
		outDirs,
		artifacts,
		startedAt,
		durationMs,
	};

	const readArtifact = async (artifactPath: string): Promise<ArtifactHandle> => {
		const absolutePath = resolveWithinRoot(
			root,
			artifactPath,
			`build.artifact('${artifactPath}')`,
		);
		let text: string;
		try {
			text = await fileSystem.readTextFile(absolutePath);
		} catch {
			throw new Error(
				`build.artifact('${artifactPath}') failed: the build did not emit that file. Emitted artifacts: ${describeArtifacts(artifacts)}.`,
			);
		}
		onTimeline('artifact scanned', {
			path: artifactPath,
			bytes:
				artifacts.find((artifact) => artifact.path === artifactPath)?.bytes ?? text.length,
		});
		return { path: artifactPath, absolutePath, text };
	};

	const handle: BuildHandle = {
		id: buildId,
		strategy,
		environments,
		outDirs,
		artifacts,
		artifact: readArtifact,
	};
	return { handle, record };
}
