import path from 'pathe';
import type { GumboxFileSystem } from './filesystem.ts';

/**
 * Browser automation is a host capability, exactly like the filesystem:
 * library code never imports an automation driver itself. Hosts (the CLI bin,
 * test support) adapt a real driver — playwright-core in this repo — into
 * this minimal surface and inject it into `runBoxes()`.
 */
export type GumboxBrowser = {
	/** Driver/browser family name recorded in receipts, e.g. 'chromium'. */
	readonly name: string;
	launch(options: BrowserLaunchOptions): Promise<GumboxBrowserSession>;
};

export type BrowserLaunchOptions = {
	headless: boolean;
};

export type GumboxBrowserSession = {
	newPage(): Promise<GumboxBrowserPage>;
	close(): Promise<void>;
};

export type BrowserConsoleMessage = {
	/** Console method level: 'log', 'warning', 'error', ... */
	level: string;
	text: string;
};

export type BrowserPageError = {
	message: string;
};

export type BrowserRequestFailure = {
	url: string;
	method: string;
	reason: string | null;
};

export type GumboxBrowserPage = {
	goto(url: string): Promise<void>;
	reload(): Promise<void>;
	/** Full serialized HTML of the current DOM. */
	content(): Promise<string>;
	/** Writes a PNG screenshot to the given absolute path. */
	screenshot(filePath: string): Promise<void>;
	/** Evaluates a JS expression in the page; the result must be JSON-serializable. */
	evaluate(expression: string): Promise<unknown>;
	/** Event-driven bounded wait until the expression evaluates truthy. */
	waitForExpression(expression: string, timeoutMs: number): Promise<void>;
	onConsoleMessage(listener: (message: BrowserConsoleMessage) => void): void;
	onPageError(listener: (error: BrowserPageError) => void): void;
	onRequestFailed(listener: (request: BrowserRequestFailure) => void): void;
	close(): Promise<void>;
};

/** A screenshot + DOM/HTML snapshot pair, referenced relative to the run directory. */
export type PageSnapshot = {
	label: string;
	/** Run-dir-relative PNG path, or null when the screenshot could not be taken. */
	screenshot: string | null;
	/** Run-dir-relative HTML snapshot path. */
	html: string;
};

/** Receipt evidence for one visited page. */
export type PageRecord = {
	id: string;
	route: string;
	environment: string;
	surface: 'dev' | 'preview';
	url: string;
	consoleMessages: BrowserConsoleMessage[];
	pageErrors: BrowserPageError[];
	failedRequests: BrowserRequestFailure[];
	snapshots: PageSnapshot[];
};

/**
 * The box-facing page handle returned by `browser.visit(...)` and
 * `preview.browser.visit(...)`. Intentionally small: assertions go through
 * `expect.page.*`, not through a Playwright-style page object.
 */
export type PageHandle = {
	readonly route: string;
	readonly environment: string;
	readonly url: string;
	reload(): Promise<void>;
	content(): Promise<string>;
};

export type VisitArgs = {
	baseUrl: string;
	route: string;
	environment: string;
	surface: 'dev' | 'preview';
};

export type BrowserEvidenceRuntime = {
	readonly pages: PageRecord[];
	visit(args: VisitArgs): Promise<PageHandle>;
	/** Snapshots every open page under the given label (used by receipt.capture). */
	captureOpenPages(label: string): Promise<void>;
	closeAll(): Promise<void>;
};

type PageDriver = {
	page: GumboxBrowserPage;
	record: PageRecord;
};

/** Links a public PageHandle back to its driver without exposing it to boxes. */
const pageDrivers = new WeakMap<PageHandle, PageDriver>();

export function getPageDriver(handle: PageHandle, context: string): PageDriver {
	const driver = pageDrivers.get(handle);
	if (driver === undefined) {
		throw new Error(
			`${context} needs a page returned by browser.visit(...) or preview.browser.visit(...).`,
		);
	}
	return driver;
}

export function missingBrowserCapabilityError(context: string): Error {
	return new Error(
		`${context} needs a browser automation capability, but none was injected. ` +
			`Pass \`browser\` to runBoxes(...) — the gumbox CLI wires a playwright-core ` +
			`adapter automatically when playwright and a Chromium-family browser are installed.`,
	);
}

function snapshotSlug(label: string): string {
	const slug = label
		.toLowerCase()
		.replaceAll(/[^a-z0-9]+/g, '-')
		.replaceAll(/^-|-$/g, '');
	return slug.length === 0 ? 'snapshot' : slug;
}

/**
 * Per-box browser runtime: lazily launches one session through the injected
 * capability, attaches console/network evidence listeners to every page, and
 * writes screenshots + DOM/HTML snapshots under the receipt run directory.
 */
export function createBrowserEvidence(options: {
	browser: GumboxBrowser | undefined;
	headless: boolean;
	fileSystem: GumboxFileSystem;
	/** Absolute receipt run directory; snapshots are referenced relative to it. */
	runDir: string;
	/** Run-dir-relative directory for this box's page assets, e.g. 'box-1'. */
	assetDir: string;
	onTimeline(type: string, detail: Record<string, unknown>): void;
}): BrowserEvidenceRuntime {
	const { browser, headless, fileSystem, runDir, assetDir, onTimeline } = options;
	const pages: PageRecord[] = [];
	const openDrivers: PageDriver[] = [];
	let session: GumboxBrowserSession | null = null;
	let assetDirCreated = false;

	const ensureSession = async (): Promise<GumboxBrowserSession> => {
		if (session === null) {
			if (browser === undefined) {
				throw missingBrowserCapabilityError('browser.visit()');
			}
			session = await browser.launch({ headless });
			onTimeline('browser session started', { browser: browser.name, headless });
		}
		return session;
	};

	const snapshotPage = async (driver: PageDriver, label: string): Promise<void> => {
		if (!assetDirCreated) {
			await fileSystem.mkdir(path.join(runDir, assetDir), { recursive: true });
			assetDirCreated = true;
		}
		const baseName = `${driver.record.id}-${snapshotSlug(label)}-${driver.record.snapshots.length + 1}`;
		const htmlRelative = path.join(assetDir, `${baseName}.html`);
		const screenshotRelative = path.join(assetDir, `${baseName}.png`);

		const html = await driver.page.content();
		await fileSystem.writeTextFile(path.join(runDir, htmlRelative), html);
		onTimeline('dom snapshot captured', {
			page: driver.record.id,
			label,
			path: htmlRelative,
		});

		let screenshot: string | null = screenshotRelative;
		try {
			await driver.page.screenshot(path.join(runDir, screenshotRelative));
			onTimeline('screenshot captured', {
				page: driver.record.id,
				label,
				path: screenshotRelative,
			});
		} catch (error) {
			screenshot = null;
			onTimeline('screenshot failed', {
				page: driver.record.id,
				label,
				error: error instanceof Error ? error.message : String(error),
			});
		}
		driver.record.snapshots.push({ label, screenshot, html: htmlRelative });
	};

	const visit = async (args: VisitArgs): Promise<PageHandle> => {
		const { baseUrl, route, environment, surface } = args;
		if (browser === undefined) {
			throw missingBrowserCapabilityError(`browser.visit('${route}')`);
		}
		const activeSession = await ensureSession();
		const url = new URL(route, baseUrl).href;
		const record: PageRecord = {
			id: `page-${pages.length + 1}`,
			route,
			environment,
			surface,
			url,
			consoleMessages: [],
			pageErrors: [],
			failedRequests: [],
			snapshots: [],
		};
		pages.push(record);

		const page = await activeSession.newPage();
		const driver: PageDriver = { page, record };
		openDrivers.push(driver);
		// Listeners attach before navigation so evidence from the very first
		// document request is captured.
		page.onConsoleMessage((message) => {
			record.consoleMessages.push(message);
			if (message.level === 'error') {
				onTimeline('console error captured', { page: record.id, text: message.text });
			}
		});
		page.onPageError((error) => {
			record.pageErrors.push(error);
			onTimeline('console error captured', {
				page: record.id,
				text: error.message,
				source: 'pageerror',
			});
		});
		page.onRequestFailed((request) => {
			record.failedRequests.push(request);
			onTimeline('network failure captured', {
				page: record.id,
				url: request.url,
				method: request.method,
				reason: request.reason,
			});
		});

		onTimeline('route requested', { environment, path: route, surface, url });
		await page.goto(url);
		onTimeline('route visited', { environment, path: route, surface, url });
		await snapshotPage(driver, 'visit');

		const handle: PageHandle = {
			route,
			environment,
			url,
			reload: async (): Promise<void> => {
				await page.reload();
				onTimeline('page reloaded', { page: record.id, url });
			},
			content: () => page.content(),
		};
		pageDrivers.set(handle, driver);
		return handle;
	};

	const captureOpenPages = async (label: string): Promise<void> => {
		for (const driver of openDrivers) {
			await snapshotPage(driver, label);
		}
	};

	const closeAll = async (): Promise<void> => {
		for (const driver of openDrivers.splice(0)) {
			await driver.page.close().catch(() => undefined);
		}
		if (session !== null) {
			await session.close().catch(() => undefined);
			session = null;
			onTimeline('browser session closed', {});
		}
	};

	return { pages, visit, captureOpenPages, closeAll };
}
