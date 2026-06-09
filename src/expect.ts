import type { EvidenceStore, HotUpdateHookEvidence } from './evidence.ts';
import { classifyEditOutcome, GumboxTimeoutError } from './evidence.ts';
import type {
	AssertionRecord,
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
	getBrowserName(): string;
	getEnvironmentKind(name: string): EnvironmentEditOutcome['kind'];
	onAssertion(record: AssertionRecord): void;
}): ExpectApi {
	const {
		store,
		receiptPath,
		defaultTimeoutMs,
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
						event.file === change.absolutePath &&
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
										event.files.includes(change.absolutePath)),
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
				try {
					await store.waitUntil(
						`the Vite dev server to restart after editing ${change.file}`,
						() =>
							store.events.find(
								(event) =>
									event.kind === 'server-restart' && event.seq > change.seq,
							),
						timeoutMs,
					);
				} catch {
					failAssertion(
						'pipeline.serverRestarted',
						null,
						change,
						`expected the Vite dev server to restart after editing ${change.file}, but no restart was observed within ${timeoutMs}ms.`,
					);
				}
				passAssertion('pipeline.serverRestarted', null, change);
			},
		},
	};
}
