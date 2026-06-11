import type { BoxDefinition, BoxOptions, BoxRunFn, NamedBoxDefinition } from './types.ts';

/**
 * Cross-instance brand. Box files are loaded through a Vite module runner, so
 * the `box` they call may come from a different evaluation of this module.
 * `Symbol.for` keeps the brand shared across instances.
 */
const BOX_BRAND = Symbol.for('gumbox.box.v1');

export function box(run: BoxRunFn): BoxDefinition;
export function box(name: string, run: BoxRunFn): NamedBoxDefinition;
export function box(options: BoxOptions & { name: string }, run: BoxRunFn): NamedBoxDefinition;
export function box(options: BoxOptions, run: BoxRunFn): BoxDefinition;
export function box(
	nameOrOptionsOrRun: string | BoxOptions | BoxRunFn,
	maybeRun?: BoxRunFn,
): BoxDefinition {
	const isAnonymousForm = typeof nameOrOptionsOrRun === 'function';
	const run = isAnonymousForm ? nameOrOptionsOrRun : maybeRun;
	const options: BoxOptions = isAnonymousForm
		? {}
		: typeof nameOrOptionsOrRun === 'string'
			? { name: nameOrOptionsOrRun }
			: nameOrOptionsOrRun;
	if (typeof options !== 'object' || options === null) {
		throw new Error(
			"box(...) takes a name, an options object, or just a run function: box(run), box('name', run), or box({ ... }, run).",
		);
	}
	if (options.name !== undefined && (typeof options.name !== 'string' || options.name === '')) {
		throw new Error(
			"box(...) names must be non-empty strings; omit the name entirely to derive it from the box file's name.",
		);
	}
	if (typeof run !== 'function') {
		throw new Error(
			`box(${options.name === undefined ? '...' : `'${options.name}'`}) requires an async run function as its last argument.`,
		);
	}
	const definition: BoxDefinition = {
		// Discovery derives a name for anonymous boxes from the file and export.
		name: options.name ?? null,
		tags: [...(options.tags ?? [])],
		modes: [...(options.modes ?? ['dev'])],
		ui: options.ui ?? false,
		run,
	};
	return Object.assign(definition, { [BOX_BRAND]: true });
}

export function isBoxDefinition(value: unknown): value is BoxDefinition {
	return (
		typeof value === 'object' &&
		value !== null &&
		(value as Record<symbol, unknown>)[BOX_BRAND] === true
	);
}

/** Rebuilds a box definition with its discovery-resolved name, keeping the brand. */
export function withResolvedName(definition: BoxDefinition, name: string): NamedBoxDefinition {
	return Object.assign({ ...definition, name }, { [BOX_BRAND]: true });
}
