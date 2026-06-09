import { isFetchableDevEnvironment, isRunnableDevEnvironment } from 'vite';
import type { DevEnvironment, ViteDevServer } from 'vite';
import type { EnvironmentHandle } from './types.ts';

export type EnvironmentRuntime = {
	handles: Record<string, EnvironmentHandle>;
	names: string[];
	kinds: Record<string, 'browser' | 'server'>;
	browserName: string;
	serverUrl: string;
};

export function browserVisitError(visitPath: string): Error {
	return new Error(
		`browser.visit('${visitPath}') is not available in this Gumbox slice: browser evidence ships in a later slice. Use the browser environment's request(path) for HTML and transform evidence without a browser.`,
	);
}

function environmentKind(environment: DevEnvironment): 'browser' | 'server' {
	return environment.config.consumer === 'client' ? 'browser' : 'server';
}

export function createEnvironmentRuntime(
	server: ViteDevServer,
	onTimeline: (type: string, detail: Record<string, unknown>) => void,
): EnvironmentRuntime {
	const serverUrl = server.resolvedUrls?.local[0];
	if (serverUrl === undefined) {
		throw new Error(
			'the Vite dev server did not report a local URL; Gumbox needs a listening (non-middleware) dev server.',
		);
	}
	const names = Object.keys(server.environments);
	const kinds: Record<string, 'browser' | 'server'> = {};
	for (const name of names) {
		const environment = server.environments[name];
		if (environment !== undefined) {
			kinds[name] = environmentKind(environment);
		}
	}
	const browserName = names.includes('client')
		? 'client'
		: (names.find((name) => kinds[name] === 'browser') ?? names[0] ?? 'client');

	const handles: Record<string, EnvironmentHandle> = {};
	for (const name of names) {
		const environment = server.environments[name];
		if (environment === undefined) {
			continue;
		}
		const kind = kinds[name] ?? 'server';
		const handle: EnvironmentHandle = {
			name,
			kind,
			request: async (requestPath: string): Promise<string> => {
				if (name === browserName) {
					// The dev server serves the browser environment over HTTP;
					// fetching populates its module graph exactly like a browser would.
					onTimeline('route requested', { environment: name, path: requestPath });
					const response = await fetch(new URL(requestPath, serverUrl));
					const body = await response.text();
					if (!response.ok) {
						throw new Error(
							`environment.${name}.request('${requestPath}') returned HTTP ${response.status} from ${serverUrl}.`,
						);
					}
					return body;
				}
				if (isFetchableDevEnvironment(environment)) {
					onTimeline('environment requested', { environment: name, path: requestPath });
					const response = await environment.dispatchFetch(
						new Request(new URL(requestPath, serverUrl)),
					);
					return await response.text();
				}
				throw new Error(
					`environment.${name}.request() is unavailable: '${name}' is not a fetchable environment. Use environment.${name}.import(id) if it is runnable.`,
				);
			},
			import: async <T = Record<string, unknown>>(id: string): Promise<T> => {
				if (!isRunnableDevEnvironment(environment)) {
					const hint =
						name === browserName
							? ` Use environment.${name}.request(path) instead.`
							: '';
					throw new Error(
						`environment.${name}.import() is unavailable: '${name}' is not a runnable environment.${hint}`,
					);
				}
				onTimeline('environment imported module', { environment: name, id });
				return (await environment.runner.import(id)) as T;
			},
		};
		if (kind === 'browser') {
			handle.visit = (visitPath: string): Promise<never> => {
				return Promise.reject(browserVisitError(visitPath));
			};
		}
		handles[name] = handle;
	}

	return { handles, names, kinds, browserName, serverUrl };
}
