import { box } from '@async/witness';

export default box(
	{
		name: 'network timings and throttling evidence',
		modes: ['dev'],
	},
	async ({ browser, expect, receipt }) => {
		const page = await browser.visit('/', {
			networkConditions: {
				latencyMs: 80,
				downloadThroughputBytesPerSecond: (256 * 1024) / 8,
				uploadThroughputBytesPerSecond: (128 * 1024) / 8,
				connectionType: 'cellular3g',
			},
		});
		await expect.page.text(page, '#message', 'hello from the browser fixture');
		await page.clearNetworkEmulation();

		const requests = await page.networkRequests();
		const scripts = requests.filter((request) => request.url.endsWith('/src/main.ts'));
		if (scripts.length === 0) {
			throw new Error('Expected CDP network evidence for /src/main.ts.');
		}
		receipt.note(
			`Observed ${requests.length} completed network requests; main script duration ${Math.round(scripts[0]!.durationMs ?? 0)}ms.`,
		);
	},
);
