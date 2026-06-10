import path from 'pathe';
import type { EvidenceStore } from './evidence.ts';
import type { GumboxFileSystem } from './filesystem.ts';
import { isPathNotFoundError } from './filesystem.ts';
import type {
	EditApi,
	EditChange,
	EditChangeSummary,
	EditedFile,
	EditReceipt,
	ProjectApi,
} from './types.ts';

const VITE_CONFIG_FILE_NAMES = [
	'vite.config.ts',
	'vite.config.mts',
	'vite.config.cts',
	'vite.config.js',
	'vite.config.mjs',
	'vite.config.cjs',
];

const ENV_FILE_NAME_PATTERN = /^\.env(\..+)?$/;

/**
 * Resolves a project-relative path to an absolute path, rejecting anything
 * that escapes the Vite root.
 */
export function resolveWithinRoot(root: string, relativePath: string, context: string): string {
	const absolutePath = path.resolve(root, relativePath);
	const relative = path.relative(root, absolutePath);
	if (relative.startsWith('..') || path.isAbsolute(relative)) {
		throw new Error(
			`${context} must stay inside the Vite root (${root}); received '${relativePath}'.`,
		);
	}
	return absolutePath;
}

type RestorePlan = { kind: 'write'; content: string } | { kind: 'delete' };

type PlannedFileEdit = {
	relativeFile: string;
	absolutePath: string;
	before: string | null;
	after: string | null;
	summary: EditChangeSummary;
};

export type ProjectRuntime = {
	project: ProjectApi;
	edits: EditReceipt[];
	/** Restores every edited file to its original state. Returns how many restores failed. */
	restoreAll(): Promise<{ failed: number }>;
};

export function createProjectApi(options: {
	root: string;
	fileSystem: GumboxFileSystem;
	store: EvidenceStore;
	/** The Vite config file resolved by a running dev server, when one exists. */
	getConfigFile?(): string | null;
	onTimeline(type: string, detail: Record<string, unknown>): void;
}): ProjectRuntime {
	const { root, fileSystem, store, getConfigFile, onTimeline } = options;
	const edits: EditReceipt[] = [];
	/** First-touch original state per absolute path, applied on restore. */
	const restorePlans = new Map<string, RestorePlan>();
	/** Directories created for new files, removed again (best effort) on restore. */
	const createdDirectories: string[] = [];

	const toRelativeFile = (absolutePath: string): string =>
		path.relative(root, absolutePath).split(path.sep).join('/');

	const readIfExists = async (absolutePath: string): Promise<string | null> => {
		try {
			return await fileSystem.readTextFile(absolutePath);
		} catch (error) {
			if (isPathNotFoundError(error)) {
				return null;
			}
			throw error;
		}
	};

	const requireExistingFile = (relativePath: string, before: string | null): string => {
		if (before === null) {
			throw new Error(
				`project.edit('${relativePath}') failed: the file does not exist under ${root}.`,
			);
		}
		return before;
	};

	const applyReplace = (
		relativePath: string,
		before: string,
		replace: [from: string | RegExp, to: string],
	): { after: string; summary: EditChangeSummary } => {
		const [from, to] = replace;
		const found = typeof from === 'string' ? before.includes(from) : from.test(before);
		if (!found) {
			const wanted = typeof from === 'string' ? JSON.stringify(from) : String(from);
			throw new Error(
				`project.edit('${relativePath}') could not find ${wanted} in the file, so the edit has nothing to change. Update the box or the project file.`,
			);
		}
		return {
			after: before.replace(from, to),
			summary: { kind: 'replace', from: String(from), to },
		};
	};

	const planFileEdit = async (
		relativePath: string,
		change: EditChange,
	): Promise<PlannedFileEdit> => {
		const absolutePath = resolveWithinRoot(
			root,
			relativePath,
			`project.edit('${relativePath}')`,
		);
		const relativeFile = toRelativeFile(absolutePath);
		const before = await readIfExists(absolutePath);
		const planned = (after: string | null, summary: EditChangeSummary): PlannedFileEdit => ({
			relativeFile,
			absolutePath,
			before,
			after,
			summary,
		});

		if (typeof change === 'function') {
			const existing = requireExistingFile(relativePath, before);
			const after = change(existing);
			if (typeof after !== 'string') {
				throw new Error(
					`project.edit('${relativePath}', fn) must return the new file contents as a string.`,
				);
			}
			return planned(after, { kind: 'function' });
		}
		if ('replace' in change && Array.isArray(change.replace) && change.replace.length === 2) {
			const existing = requireExistingFile(relativePath, before);
			const { after, summary } = applyReplace(relativePath, existing, change.replace);
			return planned(after, summary);
		}
		if ('create' in change && typeof change.create === 'string') {
			if (before !== null) {
				throw new Error(
					`project.edit.create('${relativePath}') failed: the file already exists. Use project.edit('${relativePath}', { replace }) or a function edit to change it.`,
				);
			}
			return planned(change.create, { kind: 'create' });
		}
		if ('remove' in change && change.remove === true) {
			requireExistingFile(relativePath, before);
			return planned(null, { kind: 'remove' });
		}
		if ('copyFrom' in change && typeof change.copyFrom === 'string') {
			const sourceAbsolute = resolveWithinRoot(
				root,
				change.copyFrom,
				`project.edit.copy('${relativePath}', '${change.copyFrom}')`,
			);
			const source = await readIfExists(sourceAbsolute);
			if (source === null) {
				throw new Error(
					`project.edit.copy('${relativePath}', '${change.copyFrom}') failed: the source file does not exist under ${root}.`,
				);
			}
			return planned(source, { kind: 'copy', from: toRelativeFile(sourceAbsolute) });
		}
		throw new Error(
			`project.edit('${relativePath}') received an unsupported change. Use { replace: [from, to] }, a (code) => string function, { create: contents }, { remove: true }, or { copyFrom: path }.`,
		);
	};

	const timelineTypeFor = (plan: PlannedFileEdit): string => {
		if (plan.summary.kind === 'create') {
			return 'file created';
		}
		if (plan.summary.kind === 'remove') {
			return 'file removed';
		}
		if (plan.summary.kind === 'copy') {
			return 'file copied';
		}
		const baseName = path.basename(plan.absolutePath);
		const serverConfigFile = getConfigFile?.() ?? null;
		if (plan.absolutePath === serverConfigFile || VITE_CONFIG_FILE_NAMES.includes(baseName)) {
			return 'vite config edited';
		}
		if (ENV_FILE_NAME_PATTERN.test(baseName)) {
			return 'env file edited';
		}
		return 'file edited';
	};

	const ensureParentDirectory = async (absolutePath: string): Promise<void> => {
		const parent = path.dirname(absolutePath);
		if (await fileSystem.exists(parent)) {
			return;
		}
		// Remember every directory level this edit introduces so restore can
		// clean them up again once the created files are gone.
		let current = parent;
		while (current !== root && !(await fileSystem.exists(current))) {
			createdDirectories.push(current);
			current = path.dirname(current);
		}
		await fileSystem.mkdir(parent, { recursive: true });
	};

	const performEdit = async (
		label: string,
		fileChanges: Array<[string, EditChange]>,
	): Promise<EditReceipt> => {
		if (fileChanges.length === 0) {
			throw new Error(`project.edit('${label}', changes) needs at least one file change.`);
		}
		const planned: PlannedFileEdit[] = [];
		for (const [relativePath, change] of fileChanges) {
			const plan = await planFileEdit(relativePath, change);
			if (plan.after === plan.before) {
				throw new Error(
					`project.edit('${plan.relativeFile}') produced no change, so Vite would have nothing to react to.`,
				);
			}
			planned.push(plan);
		}
		const editId = `edit-${edits.length + 1}`;
		// Mark the evidence sequence before writing so every watcher-driven
		// event caused by these writes sorts after the marker.
		const marker = store.record({ kind: 'file-edit', file: planned[0]!.absolutePath });
		const files: EditedFile[] = [];
		for (const plan of planned) {
			if (!restorePlans.has(plan.absolutePath)) {
				restorePlans.set(
					plan.absolutePath,
					plan.before === null
						? { kind: 'delete' }
						: { kind: 'write', content: plan.before },
				);
			}
			if (plan.after === null) {
				await fileSystem.remove(plan.absolutePath);
			} else {
				await ensureParentDirectory(plan.absolutePath);
				await fileSystem.writeTextFile(plan.absolutePath, plan.after);
			}
			files.push({
				file: plan.relativeFile,
				absolutePath: plan.absolutePath,
				before: plan.before,
				after: plan.after,
				change: plan.summary,
				restored: null,
			});
			onTimeline(timelineTypeFor(plan), { file: plan.relativeFile, editId });
		}
		const receipt: EditReceipt = {
			id: editId,
			file: label,
			files,
			seq: marker.seq,
			at: marker.at,
		};
		edits.push(receipt);
		return receipt;
	};

	const editSingle = (relativePath: string, change: EditChange): Promise<EditReceipt> => {
		const absolutePath = resolveWithinRoot(
			root,
			relativePath,
			`project.edit('${relativePath}')`,
		);
		return performEdit(toRelativeFile(absolutePath), [[relativePath, change]]);
	};

	const isSingleEditChange = (
		change: EditChange | Record<string, EditChange>,
	): change is EditChange =>
		typeof change === 'function' ||
		'replace' in change ||
		'create' in change ||
		'remove' in change ||
		'copyFrom' in change;

	const editFunction = (
		target: string,
		change: EditChange | Record<string, EditChange>,
	): Promise<EditReceipt> => {
		if (isSingleEditChange(change)) {
			return editSingle(target, change);
		}
		return performEdit(target, Object.entries(change));
	};

	const resolveConfigFile = async (): Promise<string> => {
		const fromServer = getConfigFile?.() ?? null;
		if (fromServer !== null) {
			return fromServer;
		}
		for (const name of VITE_CONFIG_FILE_NAMES) {
			const candidate = path.join(root, name);
			if (await fileSystem.exists(candidate)) {
				return candidate;
			}
		}
		throw new Error(
			`project.edit.config() could not find a Vite config file under ${root}. Looked for: ${VITE_CONFIG_FILE_NAMES.join(', ')}.`,
		);
	};

	const edit: EditApi = Object.assign(editFunction, {
		create: (relativePath: string, contents: string): Promise<EditReceipt> =>
			editSingle(relativePath, { create: contents }),
		remove: (relativePath: string): Promise<EditReceipt> =>
			editSingle(relativePath, { remove: true }),
		copy: (relativePath: string, from: string): Promise<EditReceipt> =>
			editSingle(relativePath, { copyFrom: from }),
		config: async (change: EditChange): Promise<EditReceipt> => {
			const configFile = await resolveConfigFile();
			return await editSingle(toRelativeFile(configFile), change);
		},
	});

	const read = async (relativePath: string): Promise<string> => {
		return await fileSystem.readTextFile(
			resolveWithinRoot(root, relativePath, `project.read('${relativePath}')`),
		);
	};

	const exists = async (relativePath: string): Promise<boolean> => {
		return await fileSystem.exists(
			resolveWithinRoot(root, relativePath, `project.exists('${relativePath}')`),
		);
	};

	const markRestored = (absolutePath: string, restored: boolean, restoreError?: string): void => {
		for (const receipt of edits) {
			for (const file of receipt.files) {
				if (file.absolutePath !== absolutePath) {
					continue;
				}
				file.restored = restored;
				if (restoreError !== undefined) {
					file.restoreError = restoreError;
				}
			}
		}
	};

	const removeCreatedDirectories = async (): Promise<void> => {
		// Deepest directories first so emptied parents can be removed too.
		const directories = [...new Set(createdDirectories)].sort((a, b) => b.length - a.length);
		for (const directory of directories) {
			try {
				await fileSystem.remove(directory);
			} catch {
				// The directory gained other contents; leave it in place.
			}
		}
		createdDirectories.length = 0;
	};

	const restoreAll = async (): Promise<{ failed: number }> => {
		let failed = 0;
		for (const [absolutePath, plan] of restorePlans) {
			const relativeFile = toRelativeFile(absolutePath);
			try {
				if (plan.kind === 'write') {
					await fileSystem.writeTextFile(absolutePath, plan.content);
				} else {
					await fileSystem.remove(absolutePath, { force: true });
				}
				markRestored(absolutePath, true);
				onTimeline('file restored', {
					file: relativeFile,
					action:
						plan.kind === 'write'
							? 'rewrote original contents'
							: 'removed created file',
				});
			} catch (error) {
				failed += 1;
				const message = error instanceof Error ? error.message : String(error);
				markRestored(absolutePath, false, message);
				onTimeline('file restore failed', { file: relativeFile, error: message });
			}
		}
		restorePlans.clear();
		await removeCreatedDirectories();
		return { failed };
	};

	return {
		project: { edit, read, exists },
		edits,
		restoreAll,
	};
}
