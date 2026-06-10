import {
	getPageDriver,
	syncTrackedEvents,
	trackedEventCountExpression,
	trackedEventMatchCountExpression,
	trackedEventMatchesDetail,
} from './browser.ts';
import type { PageHandle } from './browser.ts';
import { glob } from 'tinyglobby';
import type { EvidenceStore } from './evidence.ts';
import { classifyEditOutcome, GumboxTimeoutError } from './evidence.ts';
import type { GumboxFileSystem } from './filesystem.ts';
import { resolveWithinRoot } from './project.ts';
import type {
	ArtifactHandle,
	ArtifactJsonPredicate,
	ArtifactTextExpectation,
	AssertionRecord,
	BodyTextExpectation,
	BuildForbidsOptions,
	BuildHandle,
	EditEnvironmentExpectation,
	EditExpectation,
	EditOutcomePredicate,
	EditReceipt,
	EnvironmentEditOutcome,
	EnvironmentResponse,
	ExpectApi,
	ExpectWaitOptions,
	PageExpectApi,
	PageOutcomeExpectation,
	ResponseExpectation,
} from './types.ts';

export class GumboxAssertionError extends Error {}

/** Artifact extensions `expect.build.forbids` scans when no glob is given. */
const TEXT_ARTIFACT_EXTENSIONS = ['.js', '.mjs', '.cjs', '.html', '.json', '.css', '.map', '.txt'];

/** Normalizes a `string | string[]` expectation field to an array. */
function toFragmentList(value: string | string[] | undefined): string[] {
	if (value === undefined) {
		return [];
	}
	return typeof value === 'string' ? [value] : value;
}

export function createExpectApi(options: {
	store: EvidenceStore;
	receiptPath: string;
	defaultTimeoutMs: number;
	root: string;
	fileSystem: GumboxFileSystem;
	getEnvironmentKind(name: string): EnvironmentEditOutcome['kind'];
	onAssertion(record: AssertionRecord): void;
}): ExpectApi {
	const {
		store,
		receiptPath,
		defaultTimeoutMs,
		root,
		fileSystem,
		getEnvironmentKind,
		onAssertion,
	} = options;

	const passAssertion = (
		name: string,
		environment: string | null,
		change: EditReceipt | null,
		expected?: unknown,
	): void => {
		onAssertion({
			name,
			environment,
			editId: change?.id ?? null,
			status: 'passed',
			message: null,
			...(expected === undefined ? {} : { expected }),
		});
	};

	const failAssertion = (
		name: string,
		environment: string | null,
		change: EditReceipt | null,
		message: string,
		detail?: { expected?: unknown; observed?: unknown },
	): never => {
		onAssertion({
			name,
			environment,
			editId: change?.id ?? null,
			status: 'failed',
			message,
			...(detail?.expected === undefined ? {} : { expected: detail.expected }),
			...(detail?.observed === undefined ? {} : { observed: detail.observed }),
		});
		throw new GumboxAssertionError(`${message}\nReceipt: ${receiptPath}`);
	};

	const errorMessage = (error: unknown): string =>
		error instanceof Error ? error.message : String(error);

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

	const moduleMatchesPath = (
		module: { url: string; id: string | null; file: string | null },
		modulePath: string,
	): boolean =>
		module.url === modulePath ||
		module.id === modulePath ||
		(module.file !== null && (module.file === modulePath || module.file.endsWith(modulePath)));

	const summarizeOutcome = (outcome: EnvironmentEditOutcome): Record<string, unknown> => ({
		hmr: outcome.hmr,
		invalidated: outcome.invalidated.map((mod) => mod.url),
		messages: outcome.messages.map((message) => message.name),
		restart: outcome.restart,
		error: outcome.error,
	});

	const diffEnvironmentOutcome = (
		name: string,
		expected: EditEnvironmentExpectation,
		outcome: EnvironmentEditOutcome,
		mismatches: string[],
	): void => {
		if (expected.hmr !== undefined && outcome.hmr !== expected.hmr) {
			mismatches.push(`${name}.hmr: expected '${expected.hmr}', observed '${outcome.hmr}'`);
		}
		if (expected.invalidated !== undefined) {
			const seen = outcome.invalidated.map((mod) => mod.url).join(', ');
			if (expected.invalidated.length === 0) {
				if (outcome.invalidated.length > 0) {
					mismatches.push(
						`${name}.invalidated: expected no invalidated modules, observed: ${seen}`,
					);
				}
			} else {
				for (const modulePath of expected.invalidated) {
					const matched = outcome.invalidated.some((mod) =>
						moduleMatchesPath(mod, modulePath),
					);
					if (!matched) {
						mismatches.push(
							`${name}.invalidated: expected ${modulePath} to be invalidated, observed: ${seen || '(none)'}`,
						);
					}
				}
			}
		}
		if (expected.messages !== undefined) {
			const seenNames = [...new Set(outcome.messages.map((message) => message.name))];
			for (const messageName of expected.messages) {
				if (!seenNames.includes(messageName)) {
					mismatches.push(
						`${name}.messages: expected a '${messageName}' hot message, observed: ${seenNames.join(', ') || '(none)'}`,
					);
				}
			}
		}
		if (expected.error === undefined) {
			// Naming an environment fails closed: no error expectation means
			// the environment must not have reported an error.
			if (outcome.error !== null) {
				mismatches.push(
					`${name}.error: expected no error, observed: ${JSON.stringify(outcome.error)}`,
				);
			}
			return;
		}
		if (outcome.error === null) {
			mismatches.push(
				`${name}.error: expected an error matching ${JSON.stringify(expected.error)}, observed none`,
			);
			return;
		}
		for (const [key, value] of Object.entries(expected.error)) {
			if (JSON.stringify(outcome.error[key]) !== JSON.stringify(value)) {
				mismatches.push(
					`${name}.error.${key}: expected ${JSON.stringify(value)}, observed ${JSON.stringify(outcome.error[key])}`,
				);
			}
		}
	};

	const checkServerRestarted = async (
		change: EditReceipt,
		timeoutMs: number,
		mismatches: string[],
	): Promise<void> => {
		let restartSeq = 0;
		try {
			const restart = await store.waitUntil(
				`the Vite dev server to restart after editing ${change.file}`,
				() =>
					store.events.find(
						(event) => event.kind === 'server-restart' && event.seq > change.seq,
					),
				timeoutMs,
			);
			restartSeq = restart.seq;
		} catch {
			mismatches.push(
				`server: expected the dev server to restart after editing ${change.file}, but no restart was observed within ${timeoutMs}ms`,
			);
			return;
		}
		// Settle on the restarted server accepting connections again, so the
		// box does not tear the server down mid-restart.
		try {
			await store.waitUntil(
				'the restarted Vite dev server to start listening again',
				() =>
					store.events.find(
						(event) => event.kind === 'server-listening' && event.seq > restartSeq,
					),
				timeoutMs,
			);
		} catch {
			mismatches.push(
				`server: the dev server began restarting after editing ${change.file}, but it did not start listening again within ${timeoutMs}ms`,
			);
		}
	};

	/** The expectation with predicates made JSON-safe for the receipt record. */
	const serializableExpectation = (expectation: EditExpectation): Record<string, unknown> =>
		Object.fromEntries(
			Object.entries(expectation).map(([key, value]) => [
				key,
				typeof value === 'function' ? '(predicate)' : value,
			]),
		);

	const expectEdit = async (
		change: EditReceipt,
		expectation: EditExpectation,
		waitOptions?: ExpectWaitOptions,
	): Promise<void> => {
		const timeoutMs = waitOptions?.timeoutMs ?? defaultTimeoutMs;
		const mismatches: string[] = [];
		const observed: Record<string, unknown> = {};

		if (expectation.server !== undefined) {
			await checkServerRestarted(change, timeoutMs, mismatches);
		}

		const environmentNames = Object.keys(expectation).filter(
			(name) => name !== 'server' && expectation[name] !== undefined,
		);
		for (const name of environmentNames) {
			const expected = expectation[name] as EditEnvironmentExpectation | EditOutcomePredicate;
			let outcome: EnvironmentEditOutcome;
			try {
				outcome = await resolveOutcome(name, change, timeoutMs);
			} catch (error) {
				mismatches.push(`${name}: could not gather edit evidence — ${errorMessage(error)}`);
				continue;
			}
			const expectedMessages =
				typeof expected === 'object' && expected.messages !== undefined
					? expected.messages
					: [];
			if (expectedMessages.length > 0) {
				// An environment can settle (hook seen, nothing invalidated)
				// before the framework broadcasts its hot messages; expected
				// messages extend the wait, event-driven, until they arrive.
				try {
					outcome = await store.waitUntil(
						`environment '${name}' to broadcast hot message(s) ${expectedMessages.join(', ')}`,
						() => {
							const current = classify(name, change).outcome;
							const seenNames = new Set(
								current.messages.map((message) => message.name),
							);
							return expectedMessages.every((messageName) =>
								seenNames.has(messageName),
							)
								? current
								: undefined;
						},
						timeoutMs,
					);
				} catch {
					// The diff below reports exactly which messages never came.
					outcome = classify(name, change).outcome;
				}
			}
			observed[name] = summarizeOutcome(outcome);
			if (typeof expected === 'function') {
				const accepted = await expected(outcome);
				if (!accepted) {
					mismatches.push(
						`${name}: custom outcome predicate rejected ${JSON.stringify(summarizeOutcome(outcome))}`,
					);
				}
				continue;
			}
			diffEnvironmentOutcome(name, expected, outcome, mismatches);
		}

		if (mismatches.length > 0) {
			failAssertion(
				'edit',
				null,
				change,
				`the reaction to editing ${change.file} did not match the expectation:\n  - ${mismatches.join('\n  - ')}`,
				{ expected: serializableExpectation(expectation), observed },
			);
		}
		passAssertion('edit', null, change, serializableExpectation(expectation));
	};

	const selectorExpression = (selector: string): string =>
		`document.querySelector(${JSON.stringify(selector)})`;

	const styleValueExpression = (selector: string, property: string): string =>
		// getPropertyValue covers kebab-case names; indexed access covers camelCase.
		`(getComputedStyle(${selectorExpression(selector)}).getPropertyValue(${JSON.stringify(property)}) || getComputedStyle(${selectorExpression(selector)})[${JSON.stringify(property)}])`;

	const readPageState = async (page: PageHandle, expression: string): Promise<unknown> => {
		const driver = getPageDriver(page, 'expect.page');
		try {
			return await driver.page.evaluate(expression);
		} catch {
			return undefined;
		}
	};

	const expectPageCondition = async (args: {
		assertion: string;
		page: PageHandle;
		condition: string;
		timeoutMs: number;
		describeFailure(): Promise<string>;
	}): Promise<void> => {
		const { assertion, page, condition, timeoutMs, describeFailure } = args;
		const driver = getPageDriver(page, `expect.${assertion}`);
		try {
			await driver.page.waitForExpression(condition, timeoutMs);
		} catch {
			failAssertion(
				assertion,
				driver.record.environment,
				null,
				`${await describeFailure()} (page ${page.url}, waited ${timeoutMs}ms)`,
			);
		}
		passAssertion(assertion, driver.record.environment, null);
	};

	const pageNamespace: PageExpectApi = {
		text: async (page, selector, expected, waitOptions?: ExpectWaitOptions): Promise<void> => {
			const element = selectorExpression(selector);
			await expectPageCondition({
				assertion: 'page.text',
				page,
				condition: `(() => { const el = ${element}; return el !== null && (el.textContent ?? '').trim() === ${JSON.stringify(expected)}; })()`,
				timeoutMs: waitOptions?.timeoutMs ?? defaultTimeoutMs,
				describeFailure: async () => {
					const actual = await readPageState(
						page,
						`(() => { const el = ${element}; return el === null ? null : (el.textContent ?? '').trim(); })()`,
					);
					if (actual === null) {
						return `expected '${selector}' to have text ${JSON.stringify(expected)}, but no element matched the selector`;
					}
					return `expected '${selector}' to have text ${JSON.stringify(expected)}, but it was ${JSON.stringify(actual)}`;
				},
			});
		},
		bodyText: async (
			page,
			expectation: BodyTextExpectation,
			waitOptions?: ExpectWaitOptions,
		): Promise<void> => {
			const conditions: string[] = [];
			const requirements: string[] = [];
			if (expectation.contains !== undefined) {
				conditions.push(
					`(document.body?.textContent ?? '').includes(${JSON.stringify(expectation.contains)})`,
				);
				requirements.push(`contain ${JSON.stringify(expectation.contains)}`);
			}
			if (expectation.notContains !== undefined) {
				conditions.push(
					`!(document.body?.textContent ?? '').includes(${JSON.stringify(expectation.notContains)})`,
				);
				requirements.push(`stop containing ${JSON.stringify(expectation.notContains)}`);
			}
			if (conditions.length === 0) {
				failAssertion(
					'page.bodyText',
					null,
					null,
					'expect.page.bodyText needs a contains and/or notContains expectation.',
				);
			}
			await expectPageCondition({
				assertion: 'page.bodyText',
				page,
				condition: conditions.join(' && '),
				timeoutMs: waitOptions?.timeoutMs ?? defaultTimeoutMs,
				describeFailure: async () =>
					`expected the page body text to ${requirements.join(' and ')}, but it never did`,
			});
		},
		attribute: async (
			page,
			selector,
			attributeName,
			expected?: string | null,
			waitOptions?: ExpectWaitOptions,
		): Promise<void> => {
			const element = selectorExpression(selector);
			const attributeValue = `${element}?.getAttribute(${JSON.stringify(attributeName)})`;
			// null = the element must exist without the attribute (absence);
			// undefined = the attribute must be present with any value.
			const condition =
				expected === null
					? `(() => { const el = ${element}; return el !== null && !el.hasAttribute(${JSON.stringify(attributeName)}); })()`
					: expected === undefined
						? `(${attributeValue}) !== null && (${attributeValue}) !== undefined`
						: `(${attributeValue}) === ${JSON.stringify(expected)}`;
			await expectPageCondition({
				assertion: 'page.attribute',
				page,
				condition,
				timeoutMs: waitOptions?.timeoutMs ?? defaultTimeoutMs,
				describeFailure: async () => {
					const actual = await readPageState(
						page,
						`(() => { const el = ${element}; return el === null ? { missing: true } : { value: el.getAttribute(${JSON.stringify(attributeName)}) }; })()`,
					);
					if ((actual as { missing?: boolean } | undefined)?.missing === true) {
						return `expected '${selector}' to ${expected === null ? `exist without attribute '${attributeName}'` : `have attribute '${attributeName}'`}, but no element matched the selector`;
					}
					const value = (actual as { value?: string | null } | undefined)?.value ?? null;
					if (expected === null) {
						return `expected '${selector}' to lose attribute '${attributeName}', but the element still carries it`;
					}
					if (expected === undefined) {
						return `expected '${selector}' to have attribute '${attributeName}', but it was absent`;
					}
					return `expected '${selector}' attribute '${attributeName}' to be ${JSON.stringify(expected)}, but it was ${JSON.stringify(value)}`;
				},
			});
		},
		exists: async (page, selector, waitOptions?: ExpectWaitOptions): Promise<void> => {
			await expectPageCondition({
				assertion: 'page.exists',
				page,
				condition: `${selectorExpression(selector)} !== null`,
				timeoutMs: waitOptions?.timeoutMs ?? defaultTimeoutMs,
				describeFailure: async () =>
					`expected an element matching '${selector}' to exist in the DOM, but none appeared`,
			});
		},
		visible: async (page, selector, waitOptions?: ExpectWaitOptions): Promise<void> => {
			const element = selectorExpression(selector);
			await expectPageCondition({
				assertion: 'page.visible',
				page,
				condition: `(() => { const el = ${element}; if (el === null) return false; if (typeof el.checkVisibility === 'function') return el.checkVisibility(); return el.getClientRects().length > 0; })()`,
				timeoutMs: waitOptions?.timeoutMs ?? defaultTimeoutMs,
				describeFailure: async () => {
					const exists = await readPageState(page, `${element} !== null`);
					if (exists === false) {
						return `expected '${selector}' to be visible, but no element matched the selector`;
					}
					return `expected '${selector}' to be visible, but it stayed hidden`;
				},
			});
		},
		computedStyle: async (
			page,
			selector,
			styles,
			waitOptions?: ExpectWaitOptions,
		): Promise<void> => {
			const element = selectorExpression(selector);
			const checks = Object.entries(styles)
				.map(
					([property, value]) =>
						`${styleValueExpression(selector, property)} === ${JSON.stringify(value)}`,
				)
				.join(' && ');
			const actualEntries = Object.keys(styles)
				.map(
					(property) =>
						`${JSON.stringify(property)}: ${styleValueExpression(selector, property)}`,
				)
				.join(', ');
			await expectPageCondition({
				assertion: 'page.computedStyle',
				page,
				condition: `(() => { if (${element} === null) return false; return ${checks.length === 0 ? 'true' : checks}; })()`,
				timeoutMs: waitOptions?.timeoutMs ?? defaultTimeoutMs,
				describeFailure: async () => {
					const actual = await readPageState(
						page,
						`(() => { if (${element} === null) return null; return { ${actualEntries} }; })()`,
					);
					if (actual === null) {
						return `expected '${selector}' to match computed styles ${JSON.stringify(styles)}, but no element matched the selector`;
					}
					return `expected '${selector}' to match computed styles ${JSON.stringify(styles)}, but the computed values were ${JSON.stringify(actual)}`;
				},
			});
		},
		outcome: async (
			page,
			expectation: PageOutcomeExpectation,
			waitOptions?: ExpectWaitOptions,
		): Promise<void> => {
			const driver = getPageDriver(page, 'expect.page.outcome');
			const timeoutMs = waitOptions?.timeoutMs ?? defaultTimeoutMs;
			const mismatches: string[] = [];
			const observed: Record<string, unknown> = {};

			// Event expectations wait (bounded) for their counts; everything
			// else compares what the page record holds afterwards.
			for (const [eventName, eventExpectation] of Object.entries(expectation.events ?? {})) {
				const atLeast = eventExpectation.atLeast ?? 1;
				const detailIncludes = eventExpectation.detailIncludes;
				if (driver.record.trackedEvents[eventName] === undefined) {
					failAssertion(
						'page.outcome',
						driver.record.environment,
						null,
						`expect.page.outcome has no tracking data for '${eventName}': call page.trackEvents(${JSON.stringify(eventName)}) before the action that fires it.`,
					);
				}
				const countExpression =
					detailIncludes === undefined
						? trackedEventCountExpression(eventName)
						: trackedEventMatchCountExpression(eventName, detailIncludes);
				try {
					await driver.page.waitForExpression(
						`${countExpression} >= ${atLeast}`,
						timeoutMs,
					);
				} catch {
					await syncTrackedEvents(driver.page, driver.record);
					const occurrences = driver.record.trackedEvents[eventName] ?? [];
					const observedCount =
						detailIncludes === undefined
							? occurrences.length
							: occurrences.filter((occurrence) =>
									trackedEventMatchesDetail(occurrence, detailIncludes),
								).length;
					const filterPart =
						detailIncludes === undefined
							? ''
							: ` with detail containing ${JSON.stringify(detailIncludes)}`;
					mismatches.push(
						`events.${eventName}: expected at least ${atLeast} event(s)${filterPart}, observed ${observedCount} within ${timeoutMs}ms`,
					);
				}
			}
			await syncTrackedEvents(driver.page, driver.record);

			if (expectation.navigations !== undefined) {
				const navigations = driver.record.navigations;
				observed.navigations = navigations.map((navigation) => navigation.url);
				if (navigations.length !== expectation.navigations) {
					const urls = navigations.map((navigation) => navigation.url).join(', ');
					mismatches.push(
						`navigations: expected ${expectation.navigations}, observed ${navigations.length}${urls === '' ? '' : ` (${urls})`}`,
					);
				}
			}
			if (expectation.consoleErrors !== undefined) {
				const consoleErrors = driver.record.consoleMessages
					.filter((message) => message.level === 'error')
					.map((message) => message.text);
				const pageErrors = driver.record.pageErrors.map((error) => error.message);
				const problems = [...consoleErrors, ...pageErrors];
				observed.consoleErrors = problems;
				if (problems.length !== expectation.consoleErrors) {
					const shown = problems.slice(0, 5).join('; ');
					mismatches.push(
						`consoleErrors: expected ${expectation.consoleErrors}, observed ${problems.length}${shown === '' ? '' : ` (${shown})`}`,
					);
				}
			}
			if (expectation.failedRequests !== undefined) {
				const failures = driver.record.failedRequests;
				observed.failedRequests = failures.map(
					(failure) =>
						`${failure.method} ${failure.url} (${failure.reason ?? 'unknown reason'})`,
				);
				if (failures.length !== expectation.failedRequests) {
					const shown = (observed.failedRequests as string[]).slice(0, 5).join('; ');
					mismatches.push(
						`failedRequests: expected ${expectation.failedRequests}, observed ${failures.length}${shown === '' ? '' : ` (${shown})`}`,
					);
				}
			}

			if (mismatches.length > 0) {
				failAssertion(
					'page.outcome',
					driver.record.environment,
					null,
					`the recorded evidence for page ${page.url} did not match the expectation:\n  - ${mismatches.join('\n  - ')}`,
					{ expected: expectation, observed },
				);
			}
			passAssertion('page.outcome', driver.record.environment, null, expectation);
		},
	};

	const selectArtifactPaths = async (
		build: BuildHandle,
		filesGlob: string | undefined,
	): Promise<string[]> => {
		if (filesGlob === undefined) {
			return build.artifacts
				.map((artifact) => artifact.path)
				.filter((artifactPath) =>
					TEXT_ARTIFACT_EXTENSIONS.some((extension) => artifactPath.endsWith(extension)),
				);
		}
		const matched = new Set(await glob([filesGlob], { cwd: root, dot: true, onlyFiles: true }));
		return build.artifacts
			.map((artifact) => artifact.path)
			.filter((artifactPath) => matched.has(artifactPath));
	};

	return {
		edit: expectEdit,
		page: pageNamespace,
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
		response: {
			matches: async (
				response: EnvironmentResponse,
				expectation: ResponseExpectation,
			): Promise<void> => {
				const problems: string[] = [];
				if (expectation.status !== undefined && response.status !== expectation.status) {
					problems.push(`expected status ${expectation.status}, got ${response.status}`);
				}
				if (expectation.ok !== undefined && response.ok !== expectation.ok) {
					problems.push(`expected ok=${expectation.ok}, got ok=${response.ok}`);
				}
				if (
					expectation.contentType !== undefined &&
					!(response.contentType ?? '').includes(expectation.contentType.toLowerCase())
				) {
					problems.push(
						`expected content-type to include ${JSON.stringify(expectation.contentType)}, got ${JSON.stringify(response.contentType)}`,
					);
				}
				if (
					expectation.contains !== undefined &&
					!response.text.includes(expectation.contains)
				) {
					problems.push(
						`expected the body (${response.text.length} characters) to contain ${JSON.stringify(expectation.contains)}`,
					);
				}
				if (problems.length > 0) {
					failAssertion(
						'response.matches',
						response.environment,
						null,
						`response for '${response.path}' from environment '${response.environment}' did not match: ${problems.join('; ')}.`,
					);
				}
				passAssertion('response.matches', response.environment, null);
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
			forbids: async (
				build: BuildHandle,
				forbidden: string[],
				options?: BuildForbidsOptions,
			): Promise<void> => {
				if (forbidden.length === 0) {
					failAssertion(
						'build.forbids',
						null,
						null,
						'expect.build.forbids needs at least one forbidden string.',
					);
				}
				const scannedPaths = await selectArtifactPaths(build, options?.files);
				if (scannedPaths.length === 0) {
					failAssertion(
						'build.forbids',
						null,
						null,
						`expect.build.forbids found no text artifacts to scan${options?.files === undefined ? '' : ` matching '${options.files}'`}. Emitted artifacts: ${describeArtifactList(build)}.`,
					);
				}
				const leaks: string[] = [];
				for (const artifactPath of scannedPaths) {
					const artifact = await build.artifact(artifactPath);
					for (const value of forbidden) {
						if (artifact.text.includes(value)) {
							leaks.push(
								`${artifactPath}: ${JSON.stringify(value)} at index ${artifact.text.indexOf(value)}`,
							);
						}
					}
				}
				if (leaks.length > 0) {
					failAssertion(
						'build.forbids',
						null,
						null,
						`forbidden string(s) leaked into the build output (scanned ${scannedPaths.length} artifacts):\n  - ${leaks.join('\n  - ')}`,
						{ expected: { forbidden, files: options?.files ?? null }, observed: leaks },
					);
				}
				passAssertion('build.forbids', null, null, {
					forbidden,
					files: options?.files ?? null,
					scanned: scannedPaths.length,
				});
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
				expectation: ArtifactTextExpectation,
			): Promise<void> => {
				let artifact: ArtifactHandle;
				try {
					artifact = await build.artifact(artifactPath);
				} catch (error) {
					failAssertion('artifact.text', null, null, errorMessage(error));
					return;
				}
				const mismatches: string[] = [];
				for (const fragment of toFragmentList(expectation.contains)) {
					if (!artifact.text.includes(fragment)) {
						mismatches.push(`missing ${JSON.stringify(fragment)}`);
					}
				}
				for (const fragment of toFragmentList(expectation.notContains)) {
					if (artifact.text.includes(fragment)) {
						mismatches.push(
							`forbidden string leaked: contains ${JSON.stringify(fragment)} at index ${artifact.text.indexOf(fragment)}`,
						);
					}
				}
				if (mismatches.length > 0) {
					failAssertion(
						'artifact.text',
						null,
						null,
						`artifact ${artifactPath} (${artifact.text.length} characters) did not match:\n  - ${mismatches.join('\n  - ')}`,
						{ expected: expectation, observed: mismatches },
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
