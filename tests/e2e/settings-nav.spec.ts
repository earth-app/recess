import { expect, tab, test } from './utils/fixtures';

/**
 * Back out of a settings sub-page.
 *
 * `settings.vue` used to render the list *and* the child outlet, gated on the route.
 * `/tabs/settings` therefore never entered that outlet, so pushing a sub-page left a
 * stack one entry deep: `router.back()` had nothing to pop and the `defaultHref`
 * navigated to the route hosting the outlet, hiding the list while the child stayed on
 * screen. Nothing threw - Back just did nothing.
 */
test.describe('settings navigation', () => {
	// `IonItem`'s `routerLink` is a Vue prop and never reaches the DOM, so there is no
	// `ion-item[router-link=...]` to match - the rows carry a testid instead
	const SECTIONS = ['appearance', 'nudges', 'notifications', 'models', 'data', 'about'] as const;

	test('the list renders at the tab root', async ({ bootToday, page }) => {
		await bootToday();
		await tab(page, 'settings').click();

		for (const key of SECTIONS) {
			await expect(page.getByTestId(`settings-${key}`)).toHaveCount(1);
		}
	});

	for (const key of SECTIONS) {
		test(`back returns to the list from ${key}`, async ({ bootToday, page }) => {
			await bootToday();
			await tab(page, 'settings').click();

			await page.getByTestId(`settings-${key}`).click();
			await expect(page).toHaveURL(new RegExp(`/tabs/settings/${key}$`), { timeout: 15_000 });

			const back = page.locator('ion-back-button');
			await expect(back).toBeVisible();
			await back.click();

			// the URL has to return AND the list has to be on screen; the old shape could
			// satisfy one without the other
			await expect(page).toHaveURL(/\/tabs\/settings$/, { timeout: 15_000 });
			await expect(page.getByTestId(`settings-${key}`).first()).toBeVisible();
		});
	}

	test('a second drill-down still comes back', async ({ bootToday, page }) => {
		await bootToday();
		await tab(page, 'settings').click();

		for (const key of ['appearance', 'about']) {
			await page.getByTestId(`settings-${key}`).click();
			await expect(page).toHaveURL(new RegExp(`/tabs/settings/${key}$`), { timeout: 15_000 });
			await page.locator('ion-back-button').click();
			await expect(page).toHaveURL(/\/tabs\/settings$/, { timeout: 15_000 });
		}
	});
});
