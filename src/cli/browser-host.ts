/**
 * Host boundary for browser automation. This is the one place (besides the
 * test-support adapter that re-exports it) allowed to drive a real browser.
 * gumbox owns the whole stack: per-OS discovery + process launch
 * (`browser-launch.ts`), a JSON-RPC client over the global WebSocket
 * (`cdp-client.ts`), and the CDP page adapter (`cdp-browser.ts`).
 *
 * No browser binary is downloaded at install time: launch discovers an
 * installed Chrome, Edge, or Chromium (or an explicit `GUMBOX_BROWSER_PATH`)
 * and speaks the Chrome DevTools Protocol to it directly.
 */
import type { BrowserLaunchOptions, GumboxBrowser, GumboxBrowserSession } from '../browser.ts';
import { launchBrowserEndpoint } from './browser-launch.ts';
import { connectCdpSession } from './cdp-browser.ts';

export function createHostBrowser(): GumboxBrowser {
	return {
		name: 'chromium',
		launch: async (options: BrowserLaunchOptions): Promise<GumboxBrowserSession> => {
			const endpoint = await launchBrowserEndpoint({ headless: options.headless });
			try {
				return await connectCdpSession(endpoint);
			} catch (error) {
				await endpoint.shutdown().catch(() => undefined);
				throw error;
			}
		},
	};
}
