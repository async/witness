/**
 * Test-only host boundary for browser automation. The actual playwright-core
 * adaptation lives in the CLI host boundary (`src/cli/browser-host.ts`); this
 * module instantiates it for tests and adds availability detection so the
 * browser-dependent suites skip (with a reason) on machines without any
 * launchable Chromium-family browser.
 */
import { createHostBrowser } from '../../src/cli/browser-host.ts';
import type { GumboxBrowser } from '../../src/browser.ts';

export const hostBrowser: GumboxBrowser = createHostBrowser();

export type BrowserAvailability = { available: boolean; reason: string | null };

export async function detectBrowserAvailability(): Promise<BrowserAvailability> {
	try {
		const session = await hostBrowser.launch({ headless: true });
		await session.close();
		return { available: true, reason: null };
	} catch (error) {
		return {
			available: false,
			reason: error instanceof Error ? error.message : String(error),
		};
	}
}
