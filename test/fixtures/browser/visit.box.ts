import { box } from '@gumbox/vite';

export default box(
	{ name: 'dashboard route works in dev', tags: ['ui'], modes: ['dev'], ui: true },
	async ({ browser, expect, receipt }) => {
		// No explicit pipeline.dev(): browser.visit() auto-starts the dev server.
		const page = await browser.visit('/');

		await expect.page.exists(page, '#message');
		await expect.page.visible(page, '#title');
		await expect.page.text(page, '#message', 'hello from the browser fixture');
		await expect.page.computedStyle(page, '#title', { color: 'rgb(0, 128, 0)' });
		await expect.page.cleanConsole(page);
		await receipt.capture('dashboard state');
	},
);

export const NoisyPage = box(
	{ name: 'noisy page records console and network evidence', modes: ['dev'] },
	async ({ browser, expect }) => {
		const page = await browser.visit('/?noise=1');

		// The box itself passes; the console error and the failed request must
		// still land in the receipt as evidence.
		await expect.page.text(page, '#message', 'hello from the browser fixture');
	},
);

export const WrongText = box(
	{ name: 'failing page text assertion', modes: ['dev'] },
	async ({ browser, expect }) => {
		const page = await browser.visit('/');

		await expect.page.text(page, '#message', 'text that never appears', { timeoutMs: 1500 });
	},
);
