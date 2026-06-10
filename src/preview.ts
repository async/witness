import type { InlineConfig } from 'vite';
import { loadProjectVite } from './vite-loader.ts';
import type { PageHandle, VisitArgs } from './browser.ts';
import type { BuildHandle, PipelinePreviewOptions, PreviewHandle, PreviewRecord } from './types.ts';

function previewOutDir(build: BuildHandle): string {
	// Vite preview serves the client (browser) build output. Honor the build's
	// per-environment outDir so multi-environment builds preview the right one.
	const clientOutDir = build.outDirs['client'];
	if (clientOutDir !== undefined) {
		return clientOutDir;
	}
	const firstOutDir = Object.values(build.outDirs)[0];
	return firstOutDir ?? 'dist';
}

/**
 * Starts a local Vite preview server (`preview(...)`) against a finished
 * `pipeline.build()` and returns the box-facing handle plus the receipt
 * record. The preview URL stays local to this run; the runner owns closing.
 */
export async function startPipelinePreview(args: {
	root: string;
	build: BuildHandle;
	previewId: string;
	options?: PipelinePreviewOptions | undefined;
	/** Browser alias target recorded in the receipt for `preview.browser`. */
	browserAlias: string;
	visit(args: VisitArgs): Promise<PageHandle>;
	onTimeline(type: string, detail: Record<string, unknown>): void;
}): Promise<{ handle: PreviewHandle; record: PreviewRecord; close(): Promise<void> }> {
	const { root, build, previewId, options, browserAlias, visit, onTimeline } = args;
	const outDir = previewOutDir(build);
	let inline: InlineConfig = {
		root,
		logLevel: 'error',
		build: { outDir },
		preview: { host: '127.0.0.1' },
	};
	if (options?.config !== undefined) {
		inline = options.config(inline) ?? inline;
	}

	const vite = await loadProjectVite(root);
	const server = await vite.preview(inline);
	const url = server.resolvedUrls?.local[0];
	if (url === undefined) {
		await server.close().catch(() => undefined);
		throw new Error(
			'pipeline.preview() started a Vite preview server, but it did not report a local URL.',
		);
	}
	onTimeline('preview server started', { preview: previewId, url, outDir, browserAlias });

	const record: PreviewRecord = {
		id: previewId,
		buildId: build.id,
		url,
		outDir,
		browserAlias,
		startedAt: new Date().toISOString(),
	};

	let closed = false;
	const close = async (): Promise<void> => {
		if (closed) {
			return;
		}
		closed = true;
		await server.close().catch(() => undefined);
		onTimeline('preview server closed', { preview: previewId, url });
	};

	const handle: PreviewHandle = {
		url,
		browser: {
			visit: (route: string): Promise<PageHandle> =>
				visit({ baseUrl: url, route, environment: browserAlias, surface: 'preview' }),
		},
		request: async (requestPath: string): Promise<string> => {
			onTimeline('route requested', {
				preview: previewId,
				path: requestPath,
				surface: 'preview',
			});
			const response = await fetch(new URL(requestPath, url));
			const body = await response.text();
			if (!response.ok) {
				throw new Error(
					`preview.request('${requestPath}') returned HTTP ${response.status} from ${url}.`,
				);
			}
			return body;
		},
		close,
	};
	return { handle, record, close };
}
