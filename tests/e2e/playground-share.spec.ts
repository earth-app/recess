import { expect, test } from './utils/fixtures';

/**
 * The share sheet's "show" half needs no camera, so it is drivable here. The scan half
 * needs a real video stream and is covered by the codec's unit specs instead.
 */
test.describe('sharing a playground', () => {
	async function openShare(page: import('@playwright/test').Page) {
		await page.goto('/tabs/playground');
		await expect(page.locator('ion-content').first()).toBeVisible();

		const share = page.getByRole('button', { name: /Show a Friend|Muestr/i }).first();
		await expect(share).toBeEnabled({ timeout: 20_000 });
		await share.click();

		return page.locator('ion-modal:visible').first();
	}

	test('renders a scannable code and a preview of exactly what is shared', async ({
		bootToday,
		page
	}) => {
		await bootToday();
		const sheet = await openShare(page);

		await expect(sheet.getByText(/scan|escanear/i).first()).toBeVisible();

		// the code is inlined as SVG, so a real symbol means a real <svg> with a viewBox
		const svg = sheet.locator('svg[viewBox]').first();
		await expect(svg).toBeVisible({ timeout: 20_000 });

		const modules = await svg.getAttribute('viewBox');
		// `0 0 N N`, where N is modules-per-side including the quiet zone; a 160-element
		// playground lands at version 7 (45 modules), so anything past ~110 means the
		// payload has silently stopped being bit-packed
		const side = Number(modules?.split(' ')[2] ?? 0);
		expect(side).toBeGreaterThan(20);
		expect(side).toBeLessThan(110);

		// the sharer previews the re-rolled tuple, not their own scene, so a canvas has to
		// be there next to the code or the preview is a lie by omission
		await expect(sheet.locator('canvas')).toHaveCount(1);
	});

	test('says plainly that the code stops working', async ({ bootToday, page }) => {
		await bootToday();
		const sheet = await openShare(page);

		await expect(sheet.getByText(/today only|solo hoy/i).first()).toBeVisible({
			timeout: 20_000
		});
	});

	test('closes without leaving an overlay behind', async ({ bootToday, page }) => {
		await bootToday();
		const sheet = await openShare(page);

		await sheet
			.getByRole('button', { name: /Close|Cerrar/i })
			.first()
			.click();
		await expect(page.locator('ion-modal:visible')).toHaveCount(0);
	});
});
