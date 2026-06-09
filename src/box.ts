import type { BoxDefinition, BoxOptions, BoxRunFn } from './types.ts';

/**
 * Cross-instance brand. Box files are loaded through a Vite module runner, so
 * the `box` they call may come from a different evaluation of this module.
 * `Symbol.for` keeps the brand shared across instances.
 */
const BOX_BRAND = Symbol.for('gumbox.box.v1');

export function box(name: string, run: BoxRunFn): BoxDefinition;
export function box(options: BoxOptions, run: BoxRunFn): BoxDefinition;
export function box(nameOrOptions: string | BoxOptions, run: BoxRunFn): BoxDefinition {
	const options = typeof nameOrOptions === 'string' ? { name: nameOrOptions } : nameOrOptions;
	if (
		typeof options !== 'object' ||
		options === null ||
		typeof options.name !== 'string' ||
		options.name.length === 0
	) {
		throw new Error(
			"box(...) requires a non-empty name: use box('name', run) or box({ name: 'name' }, run).",
		);
	}
	if (typeof run !== 'function') {
		throw new Error(
			`box('${options.name}') requires an async run function as its second argument.`,
		);
	}
	const definition: BoxDefinition = {
		name: options.name,
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
