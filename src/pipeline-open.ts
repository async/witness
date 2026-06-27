export type PipelineOpenTarget = Record<string, unknown> & { app?: string; entry?: string };

export type PipelineAccessibilityNode = Record<string, unknown> & {
	role: string;
	name?: string;
	children?: PipelineAccessibilityNode[];
};

export type PipelineAction = Record<string, unknown> & {
	kind: string;
	role?: string;
	name?: string;
};
type PipelineRecord = Record<string, unknown>;

export type PipelineAppSessionRecord = {
	id: string;
	platform: string;
	adapter: string;
	target: PipelineOpenTarget;
	status: 'open' | 'closed';
	startedAt: string;
	finishedAt?: string;
	accessibility: PipelineRecord[];
	actions: PipelineRecord[];
	screenshots: PipelineRecord[];
	logs: PipelineRecord[];
	crash: PipelineRecord | null;
};

export type PipelineDriverSession = {
	accessibilityTree(): Promise<PipelineAccessibilityNode>;
	action?(action: PipelineAction): Promise<PipelineRecord>;
	screenshot?(label: string): Promise<PipelineRecord>;
	logs?(): Promise<PipelineAppSessionRecord['logs']>;
	crash?(): Promise<PipelineAppSessionRecord['crash']>;
	close?(): Promise<void>;
};

export type PipelineOpenAdapter = {
	name: string;
	platform: 'web' | 'desktop' | 'mobile' | (string & Record<never, never>);
	supports(target: PipelineOpenTarget): boolean | Promise<boolean>;
	open(
		target: PipelineOpenTarget,
		context: { sessionId: string; runDir: string; receiptPath: string },
	): Promise<PipelineDriverSession>;
};

export type PipelineAppHandle = {
	readonly id: string;
	readonly target: PipelineOpenTarget;
	readonly accessibility: {
		snapshot(label?: string): Promise<PipelineAppSessionRecord['accessibility'][number]>;
	};
	action(action: PipelineAction): Promise<PipelineAppSessionRecord['actions'][number]>;
	screenshot(label?: string): Promise<PipelineAppSessionRecord['screenshots'][number]>;
	close(): Promise<void>;
};

export function normalizePipelineOpenAdapters(
	adapters: PipelineOpenAdapter | PipelineOpenAdapter[] | undefined,
): PipelineOpenAdapter[] {
	return adapters === undefined ? [] : Array.isArray(adapters) ? adapters : [adapters];
}

export function createPipelineOpenRuntime(options: {
	adapters: PipelineOpenAdapter[];
	runDir: string;
	receiptPath: string;
	onSession(record: PipelineAppSessionRecord): void;
	onTimeline(type: string, detail: Record<string, unknown>): void;
}): { open(target?: PipelineOpenTarget): Promise<PipelineAppHandle>; closeAll(): Promise<void> } {
	let nextSession = 1;
	const openSessions: PipelineAppHandle[] = [];
	const open = async (target: PipelineOpenTarget = {}): Promise<PipelineAppHandle> => {
		const adapter = await findAdapter(options.adapters, target);
		if (adapter === null) {
			throw new Error('pipeline.open(...) needs a web, desktop, or mobile adapter.');
		}
		const id = `app-${nextSession++}`;
		const driver = await adapter.open(target, {
			sessionId: id,
			runDir: options.runDir,
			receiptPath: options.receiptPath,
		});
		const record: PipelineAppSessionRecord = {
			id,
			platform: adapter.platform,
			adapter: adapter.name,
			target,
			status: 'open',
			startedAt: new Date().toISOString(),
			accessibility: [],
			actions: [],
			screenshots: [],
			logs: [],
			crash: null,
		};
		options.onSession(record);
		options.onTimeline('app opened', { sessionId: id, platform: adapter.platform });
		let closed = false;
		const handle: PipelineAppHandle = {
			id,
			target,
			accessibility: {
				snapshot: async (label = 'accessibility') => {
					const tree = await driver.accessibilityTree();
					const capture = { label, at: new Date().toISOString(), tree };
					record.accessibility.push(capture);
					options.onTimeline('app accessibility captured', { sessionId: id, label });
					return capture;
				},
			},
			action: async (action) => {
				if (driver.action === undefined) {
					throw new Error(`pipeline adapter '${adapter.name}' does not support actions.`);
				}
				const recorded = {
					...action,
					...(await driver.action(action)),
					at: new Date().toISOString(),
				};
				record.actions.push(recorded);
				options.onTimeline('app action performed', { sessionId: id, kind: recorded.kind });
				return recorded;
			},
			screenshot: async (label = 'screenshot') => {
				if (driver.screenshot === undefined) {
					throw new Error(
						`pipeline adapter '${adapter.name}' does not support screenshots.`,
					);
				}
				const screenshot = await driver.screenshot(label);
				record.screenshots.push(screenshot);
				options.onTimeline('app screenshot captured', { sessionId: id, label });
				return screenshot;
			},
			close: async () => {
				if (closed) {
					return;
				}
				record.logs.push(...((await driver.logs?.()) ?? []));
				record.crash = (await driver.crash?.()) ?? null;
				await driver.close?.();
				closed = true;
				record.status = 'closed';
				record.finishedAt = new Date().toISOString();
				options.onTimeline('app closed', { sessionId: id, crash: record.crash !== null });
			},
		};
		openSessions.push(handle);
		return handle;
	};
	return {
		open,
		closeAll: async () => {
			await Promise.all(
				openSessions.map((session) => session.close().catch(() => undefined)),
			);
		},
	};
}

async function findAdapter(
	adapters: PipelineOpenAdapter[],
	target: PipelineOpenTarget,
): Promise<PipelineOpenAdapter | null> {
	for (const adapter of adapters) {
		if (await adapter.supports(target)) {
			return adapter;
		}
	}
	return null;
}
