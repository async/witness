import type { EvidenceStore, HotUpdateHookEvidence } from './evidence.ts';
import { classifyEditOutcome, editTouchesFile, GumboxTimeoutError } from './evidence.ts';
import type { GumboxFileSystem } from './filesystem.ts';
import { resolveWithinRoot } from './project.ts';
import type {
	ArtifactHandle,
	ArtifactJsonPredicate,
	AssertionRecord,
	BuildHandle,
	EditReceipt,
	EnvironmentEditOutcome,
	EnvironmentExpectApi,
	ExpectApi,
	ExpectWaitOptions,
} from './types.ts';

export class GumboxAssertionError extends Error {}

export function createExpectApi(options: {
	store: EvidenceStore;
	receiptPath: string;
	defaultTimeoutMs: number;
	root: string;
	fileSystem: GumboxFileSystem;
	getBrowserName(): string;
	getEnvironmentKind(name: string): EnvironmentEditOutcome['kind'];
	onAssertion(record: AssertionRecord): void;
}): ExpectApi {
	const {
		store,
		receiptPath,
		defaultTimeoutMs,
		root,
		fileSystem,
		getBrowserName,
		getEnvironmentKind,
		onAssertion,
	} = options;

	const passAssertion = (
		name: string,
		environment: string | null,
		change: EditReceipt | null,
	): void => {
		onAssertion({
			name,
			environment,
			editId: change?.id ?? null,
			status: 'passed',
			message: null,
		});
	};

	const failAssertion = (
		name: string,
		environment: string | null,
		change: EditReceipt | null,
		message: string,
	): never => {
		onAssertion({
			name,
			environment,
			editId: change?.id ?? null,
			status: 'failed',
			message,
		});
		throw new GumboxAssertionError(`${message}\nReceipt: ${receiptPath}`);
	};

	const errorMessage = (error: unknown): string =>
		error instanceof Error ? error.message : String(error);

	const waitForHook = (
		environment: string,
		change: EditReceipt,
		timeoutMs: number,
	): Promise<HotUpdateHookEvidence> => {
		return store.waitUntil(
			`environment '${environment}' to observe the file change for ${change.file}`,
			() =>
				store.events.find(
					(event): event is HotUpdateHookEvidence =>
						event.kind === 'hot-update-hook' &&
						event.environment === environment &&
						editTouchesFile(change, event.file) &&
						event.seq > change.seq,
				),
			timeoutMs,
		);
	};

	const classify = (
		environment: string,
		change: EditReceipt,
	): ReturnType<typeof classifyEditOutcome> => {
		return classifyEditOutcome({
			store,
			environmentName: environment,
			kind: getEnvironmentKind(environment),
			edit: change,
		});
	};

	const resolveOutcome = async (
		environment: string,
		change: EditReceipt,
		timeoutMs: number,
	): Promise<EnvironmentEditOutcome> => {
		try {
			return await store.waitUntil(
				`environment '${environment}' to settle its Vite reaction to the edit of ${change.file}`,
				() => {
					const { settled, outcome } = classify(environment, change);
					return settled ? outcome : undefined;
				},
				timeoutMs,
			);
		} catch (error) {
			const { hookSeen, outcome } = classify(environment, change);
			if (error instanceof GumboxTimeoutError && hookSeen) {
				// The environment observed the change but sent no terminal
				// payload ("no update happened"); report the partial outcome.
				return outcome;
			}
			throw error;
		}
	};

	const createEnvironmentExpect = (name: string): EnvironmentExpectApi => {
		return {
			hotUpdate: async (change, waitOptions?: ExpectWaitOptions): Promise<void> => {
				const timeoutMs = waitOptions?.timeoutMs ?? defaultTimeoutMs;
				try {
					await store.waitUntil(
						`environment '${name}' to receive a Vite HMR update payload for ${change.file}`,
						() =>
							store.events.find(
								(event) =>
									event.kind === 'hot-payload' &&
									event.environment === name &&
									event.payload.type === 'update' &&
									event.seq > change.seq &&
									(event.files.length === 0 ||
										event.files.some((file) => editTouchesFile(change, file))),
							),
						timeoutMs,
					);
				} catch {
					const { outcome } = classify(name, change);
					const observed = outcome.fullReload
						? ' Vite sent a full reload instead.'
						: outcome.error !== null
							? ' Vite sent an error payload instead.'
							: '';
					failAssertion(
						'hotUpdate',
						name,
						change,
						`expected environment '${name}' to hot-update after editing ${change.file}, but no HMR update payload was observed within ${timeoutMs}ms.${observed}`,
					);
				}
				passAssertion('hotUpdate', name, change);
			},
			noFullReload: async (change, waitOptions?: ExpectWaitOptions): Promise<void> => {
				const timeoutMs = waitOptions?.timeoutMs ?? defaultTimeoutMs;
				let outcome: EnvironmentEditOutcome;
				try {
					outcome = await resolveOutcome(name, change, timeoutMs);
				} catch (error) {
					failAssertion(
						'noFullReload',
						name,
						change,
						`could not verify noFullReload for ${change.file} in environment '${name}': ${errorMessage(error)}`,
					);
					return;
				}
				if (outcome.fullReload) {
					failAssertion(
						'noFullReload',
						name,
						change,
						`expected environment '${name}' to avoid a full reload after editing ${change.file}, but Vite sent a full-reload payload.`,
					);
				}
				passAssertion('noFullReload', name, change);
			},
			invalidated: async (
				change,
				modulePath?: string,
				waitOptions?: ExpectWaitOptions,
			): Promise<void> => {
				const timeoutMs = waitOptions?.timeoutMs ?? defaultTimeoutMs;
				let hook: HotUpdateHookEvidence;
				try {
					hook = await waitForHook(name, change, timeoutMs);
				} catch (error) {
					failAssertion('invalidated', name, change, errorMessage(error));
					return;
				}
				if (hook.modules.length === 0) {
					failAssertion(
						'invalidated',
						name,
						change,
						`expected environment '${name}' to invalidate modules after editing ${change.file}, but its module graph had no modules for that file.`,
					);
				}
				if (modulePath !== undefined) {
					const matched = hook.modules.some(
						(mod) =>
							mod.url === modulePath ||
							mod.id === modulePath ||
							(mod.file !== null &&
								(mod.file === modulePath || mod.file.endsWith(modulePath))),
					);
					if (!matched) {
						const seen = hook.modules.map((mod) => mod.url).join(', ');
						failAssertion(
							'invalidated',
							name,
							change,
							`expected environment '${name}' to invalidate ${modulePath} after editing ${change.file}, but it invalidated: ${seen}.`,
						);
					}
				}
				passAssertion('invalidated', name, change);
			},
			notInvalidated: async (change, waitOptions?: ExpectWaitOptions): Promise<void> => {
				const timeoutMs = waitOptions?.timeoutMs ?? defaultTimeoutMs;
				let hook: HotUpdateHookEvidence;
				try {
					hook = await waitForHook(name, change, timeoutMs);
				} catch (error) {
					failAssertion('notInvalidated', name, change, errorMessage(error));
					return;
				}
				if (hook.modules.length > 0) {
					const seen = hook.modules.map((mod) => mod.url).join(', ');
					failAssertion(
						'notInvalidated',
						name,
						change,
						`expected environment '${name}' to ignore the edit of ${change.file}, but it invalidated: ${seen}.`,
					);
				}
				passAssertion('notInvalidated', name, change);
			},
			satisfies: async (
				change,
				predicate,
				waitOptions?: ExpectWaitOptions,
			): Promise<void> => {
				const timeoutMs = waitOptions?.timeoutMs ?? defaultTimeoutMs;
				let outcome: EnvironmentEditOutcome;
				try {
					outcome = await resolveOutcome(name, change, timeoutMs);
				} catch (error) {
					failAssertion(
						'satisfies',
						name,
						change,
						`could not gather edit evidence for ${change.file} in environment '${name}': ${errorMessage(error)}`,
					);
					return;
				}
				const accepted = await predicate(outcome);
				if (!accepted) {
					failAssertion(
						'satisfies',
						name,
						change,
						`custom evidence predicate rejected the outcome for environment '${name}' after editing ${change.file}: ${JSON.stringify(
							{
								update: outcome.update,
								fullReload: outcome.fullReload,
								restart: outcome.restart,
								invalidated: outcome.invalidated.map((mod) => mod.url),
							},
						)}.`,
					);
				}
				passAssertion('satisfies', name, change);
			},
		};
	};

	const memo = new Map<string, EnvironmentExpectApi>();
	const environmentNamespace = new Proxy({} as Record<string, EnvironmentExpectApi>, {
		get: (_target, prop): EnvironmentExpectApi | undefined => {
			if (typeof prop !== 'string' || prop === 'then' || prop === 'toJSON') {
				return undefined;
			}
			let api = memo.get(prop);
			if (api === undefined) {
				api = createEnvironmentExpect(prop);
				memo.set(prop, api);
			}
			return api;
		},
	});

	const browserNamespace = new Proxy({} as EnvironmentExpectApi, {
		get: (_target, prop): unknown => {
			if (typeof prop !== 'string' || prop === 'then' || prop === 'toJSON') {
				return undefined;
			}
			const api = environmentNamespace[getBrowserName()];
			return api === undefined ? undefined : api[prop as keyof EnvironmentExpectApi];
		},
	});

	return {
		environment: environmentNamespace,
		browser: browserNamespace,
		html: {
			contains: async (html: string, fragment: string): Promise<void> => {
				if (typeof html !== 'string') {
					failAssertion(
						'html.contains',
						null,
						null,
						'expect.html.contains(html, fragment) needs HTML evidence as a string; pass the result of an environment request.',
					);
				}
				if (!html.includes(fragment)) {
					failAssertion(
						'html.contains',
						null,
						null,
						`expected the HTML evidence (${html.length} characters) to contain ${JSON.stringify(fragment)}.`,
					);
				}
				passAssertion('html.contains', null, null);
			},
		},
		pipeline: {
			serverRestarted: async (
				change: EditReceipt,
				waitOptions?: ExpectWaitOptions,
			): Promise<void> => {
				const timeoutMs = waitOptions?.timeoutMs ?? defaultTimeoutMs;
				let restartSeq = 0;
				try {
					const restart = await store.waitUntil(
						`the Vite dev server to restart after editing ${change.file}`,
						() =>
							store.events.find(
								(event) =>
									event.kind === 'server-restart' && event.seq > change.seq,
							),
						timeoutMs,
					);
					restartSeq = restart.seq;
				} catch {
					failAssertion(
						'pipeline.serverRestarted',
						null,
						change,
						`expected the Vite dev server to restart after editing ${change.file}, but no restart was observed within ${timeoutMs}ms.`,
					);
				}
				// Settle on the restarted server accepting connections again, so
				// the box does not tear the server down mid-restart.
				try {
					await store.waitUntil(
						'the restarted Vite dev server to start listening again',
						() =>
							store.events.find(
								(event) =>
									event.kind === 'server-listening' && event.seq > restartSeq,
							),
						timeoutMs,
					);
				} catch {
					failAssertion(
						'pipeline.serverRestarted',
						null,
						change,
						`the Vite dev server began restarting after editing ${change.file}, but it did not start listening again within ${timeoutMs}ms.`,
					);
				}
				passAssertion('pipeline.serverRestarted', null, change);
			},
		},
		build: {
			environment: async (build: BuildHandle, name: string): Promise<void> => {
				if (!build.environments.includes(name)) {
					failAssertion(
						'build.environment',
						name,
						null,
						`expected the Vite build to include environment '${name}', but it built: ${build.environments.join(', ') || '(none)'}.`,
					);
				}
				passAssertion('build.environment', name, null);
			},
			artifact: async (build: BuildHandle, artifactPath: string): Promise<void> => {
				const emitted = build.artifacts.some((artifact) => artifact.path === artifactPath);
				if (!emitted) {
					failAssertion(
						'build.artifact',
						null,
						null,
						`expected the build to emit ${artifactPath}, but it emitted: ${describeArtifactList(build)}.`,
					);
				}
				passAssertion('build.artifact', null, null);
			},
		},
		artifact: {
			exists: async (build: BuildHandle, artifactPath: string): Promise<void> => {
				const absolutePath = resolveWithinRoot(
					root,
					artifactPath,
					`expect.artifact.exists('${artifactPath}')`,
				);
				if (!(await fileSystem.exists(absolutePath))) {
					failAssertion(
						'artifact.exists',
						null,
						null,
						`expected build output ${artifactPath} to exist on disk, but it does not. Emitted artifacts: ${describeArtifactList(build)}.`,
					);
				}
				passAssertion('artifact.exists', null, null);
			},
			text: async (
				build: BuildHandle,
				artifactPath: string,
				expectation: { contains?: string; notContains?: string },
			): Promise<void> => {
				let artifact: ArtifactHandle;
				try {
					artifact = await build.artifact(artifactPath);
				} catch (error) {
					failAssertion('artifact.text', null, null, errorMessage(error));
					return;
				}
				if (
					expectation.contains !== undefined &&
					!artifact.text.includes(expectation.contains)
				) {
					failAssertion(
						'artifact.text',
						null,
						null,
						`expected artifact ${artifactPath} (${artifact.text.length} characters) to contain ${JSON.stringify(expectation.contains)}.`,
					);
				}
				if (
					expectation.notContains !== undefined &&
					artifact.text.includes(expectation.notContains)
				) {
					failAssertion(
						'artifact.text',
						null,
						null,
						`forbidden string leaked into the build: artifact ${artifactPath} contains ${JSON.stringify(expectation.notContains)} at index ${artifact.text.indexOf(expectation.notContains)}.`,
					);
				}
				passAssertion('artifact.text', null, null);
			},
			json: (async (
				target: BuildHandle | ArtifactHandle,
				second: string | ArtifactJsonPredicate,
				third?: ArtifactJsonPredicate,
			): Promise<void> => {
				let artifact: ArtifactHandle;
				let predicate: ArtifactJsonPredicate;
				if (typeof second === 'string') {
					predicate = third as ArtifactJsonPredicate;
					try {
						artifact = await (target as BuildHandle).artifact(second);
					} catch (error) {
						failAssertion('artifact.json', null, null, errorMessage(error));
						return;
					}
				} else {
					artifact = target as ArtifactHandle;
					predicate = second;
				}
				let json: unknown;
				try {
					json = JSON.parse(artifact.text);
				} catch (error) {
					failAssertion(
						'artifact.json',
						null,
						null,
						`artifact ${artifact.path} is not valid JSON: ${errorMessage(error)}.`,
					);
					return;
				}
				const accepted = await predicate(json);
				if (!accepted) {
					failAssertion(
						'artifact.json',
						null,
						null,
						`custom JSON predicate rejected artifact ${artifact.path}.`,
					);
				}
				passAssertion('artifact.json', null, null);
			}) as ExpectApi['artifact']['json'],
		},
	};
}

function describeArtifactList(build: BuildHandle): string {
	if (build.artifacts.length === 0) {
		return '(no artifacts were emitted)';
	}
	const shown = build.artifacts.slice(0, 10).map((artifact) => artifact.path);
	const remaining = build.artifacts.length - shown.length;
	return remaining > 0 ? `${shown.join(', ')} and ${remaining} more` : shown.join(', ');
}
