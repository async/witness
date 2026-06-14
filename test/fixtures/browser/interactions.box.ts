import { box } from '@async/witness';

// page.click is the minimal interaction primitive: it lets a box reach a
// user-made UI state (for example a counter at a known count) before an edit,
// so HMR state-preservation scenarios are expressible. Every click is receipt
// evidence; assertions stay in expect.page.*.
export default box(
	{ name: 'counter clicks update page state', modes: ['dev'] },
	async ({ browser, expect }) => {
		const page = await browser.visit('/');

		await expect.page.attribute(page, '#counter', 'data-idle');
		await expect.page.attribute(page, '#counter', 'data-idle', 'true');
		await expect.page.bodyText(page, { contains: 'clicked 0 times' });

		await page.click('#counter');
		await page.click('#counter');

		// null = the attribute must be absent.
		await expect.page.attribute(page, '#counter', 'data-idle', null);
		await expect.page.attribute(page, '#counter', 'data-clicks', '2');
		await expect.page.bodyText(page, {
			contains: 'clicked 2 times',
			notContains: 'clicked 0 times',
		});
		await expect.page.outcome(page, { failedRequests: 0 });
	},
);

export const StaleTextFails = box(
	{ name: 'bodyText notContains fails while the text is still present', modes: ['dev'] },
	async ({ browser, expect }) => {
		const page = await browser.visit('/');

		await expect.page.bodyText(page, { contains: 'clicked 0 times' });
		// This must fail: nothing removes the initial counter text.
		await expect.page.bodyText(page, { notContains: 'clicked 0 times' }, { timeoutMs: 1500 });
	},
);

export const FailedRequestFails = box(
	{ name: 'failedRequests: 0 fails after a failed page request', modes: ['dev'] },
	async ({ browser, expect }) => {
		const page = await browser.visit('/?noise=1');

		// Event-driven settle: the page flags the body once the doomed request
		// has been rejected, so the failed-request evidence exists before the
		// assertion runs.
		await expect.page.attribute(page, 'body', 'data-noise-settled', 'true');
		// This must fail: the noise page made a request the browser rejected.
		await expect.page.outcome(page, { failedRequests: 0 });
	},
);
