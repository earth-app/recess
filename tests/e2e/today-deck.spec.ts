import type { Page } from '@playwright/test';
import {
	expect,
	frontCard,
	openSheet,
	resolveAction,
	tab,
	test,
	waitForDeck
} from './utils/fixtures';
import { readMockState } from './utils/native-mock';

/** the day's chosen ids, which are the contract; a rendered title is only its consequence */
interface StoredPick {
	day?: string;
	ids?: string[];
	bonusId?: string | null;
}

const readPick = async (page: Page): Promise<StoredPick> => {
	const stored = await page.evaluate(() => {
		const key = Object.keys(localStorage).find((name) => name.includes('today-pick'));
		return key ? String(localStorage.getItem(key)) : null;
	});
	// an absent pick reads as an empty one, so a caller asserts on ids rather than on null
	return stored ? (JSON.parse(stored) as StoredPick) : {};
};

test.describe('the today deck', () => {
	test('shows the day and its ring once the store hydrates', async ({ bootToday, page }) => {
		await bootToday();
		await waitForDeck(page);

		await expect(page.getByText(/0 of \d|0 de \d/).first()).toBeVisible();
		// the ring's accessible name lives on its wrapper, not on the svg element
		await expect(page.getByLabel(/0 of \d+ resolved/).first()).toBeVisible();
	});

	/**
	 * The fixture pins TEST_INSTALL_SEED, because the day's stream is keyed per install.
	 *
	 * Re-picking on relaunch is not enough on its own: the weather snapshot arrives
	 * asynchronously and is then cached, so a second boot scores against a context the
	 * first one did not have and can legitimately land on a different set. The day's
	 * chosen ids are persisted for exactly that reason, and they are the contract - the
	 * rendered title is only the visible consequence of it.
	 */
	test('is deterministic: the same day keeps the same set across a relaunch', async ({
		bootToday,
		page
	}) => {
		await bootToday();
		await waitForDeck(page);
		// the deck paints in the same tick as the ready marker, but under load the read can
		// still land mid-render; a settled front card is exactly one titled card
		await expect(page.getByTestId('nudge-title')).toHaveCount(1);

		const before = await readPick(page);
		expect(before.ids?.length, 'the day pick was not persisted').toBeGreaterThan(0);
		const firstTitle = await frontCard(page).textContent();

		await page.reload();
		await waitForDeck(page);
		await expect(page.getByTestId('nudge-title')).toHaveCount(1);

		const after = await readPick(page);
		expect(after.ids).toEqual(before.ids);
		expect(after.bonusId).toBe(before.bonusId);
		expect(await frontCard(page).textContent()).toBe(firstTitle);
	});

	/**
	 * The clock is pinned, and the assertion is on the whole set rather than the front card.
	 *
	 * Both seeds are fixed, but the pick is a function of `(seed, dayKey)` - so on any given real
	 * date the two installs can legitimately agree on the first of their four nudges, and this
	 * failed on exactly one day's date while passing on the one before it. Comparing the sets makes
	 * a collision astronomically unlikely rather than merely uncommon; pinning the day makes it
	 * impossible, and the same date is what the assertion was verified against.
	 */
	test('a different install gets a different day, which is the point of the seed', async ({
		bootToday,
		page
	}) => {
		// midday local, so the local day key is the same wherever this runs
		await page.clock.setFixedTime(new Date('2026-03-17T12:00:00'));

		await bootToday();
		await waitForDeck(page);
		const mine = await readPick(page);
		expect(mine.ids?.length, 'the first install persisted no pick').toBeGreaterThan(0);

		// a second device would not carry the first one's stored pick, and the stored pick
		// deliberately outranks the seed - so drop it to actually exercise the seed
		await page.evaluate(() => {
			for (const key of Object.keys(localStorage)) {
				if (key.includes('today-pick')) localStorage.removeItem(key);
			}
		});

		await bootToday({
			preferences: { 'recess:install-seed': JSON.stringify('ffffffffffffffffffffffffffffffff') }
		});
		await waitForDeck(page);
		const theirs = await readPick(page);

		// two people starting the same day should not be handed the same four nudges
		expect(theirs.ids, 'two installs drew an identical day').not.toEqual(mine.ids);
	});

	test('tapping a card opens its sheet', async ({ bootToday, page }) => {
		await bootToday();
		await waitForDeck(page);

		await frontCard(page).click();
		await expect(openSheet(page)).toBeVisible({ timeout: 10_000 });
	});

	test('a dismissed sheet can be reopened', async ({ bootToday, page }) => {
		await bootToday();
		await waitForDeck(page);

		await frontCard(page).click();
		await expect(openSheet(page)).toBeVisible({ timeout: 10_000 });

		// ionic keeps dismissed modals in the DOM, so this guards the is-open /
		// did-dismiss pairing that otherwise leaves the sheet un-reopenable
		await page.keyboard.press('Escape');
		await expect(page.locator('ion-modal:visible')).toHaveCount(0, { timeout: 10_000 });

		await frontCard(page).click();
		await expect(openSheet(page)).toBeVisible({ timeout: 10_000 });
	});

	test('resolving a nudge advances the ring and writes the ledger', async ({ bootToday, page }) => {
		await bootToday();
		await waitForDeck(page);

		await frontCard(page).click();
		const sheet = openSheet(page);
		await expect(sheet).toBeVisible({ timeout: 10_000 });

		// the day's first nudge can be any of the seven types, and each resolves
		// through its own action
		const resolve = resolveAction(page);
		await expect(resolve).toBeVisible({ timeout: 10_000 });
		await resolve.click();

		// the result panel confirms the pass; close it through its own Done action so
		// the ring behind it is measurable
		const done = openSheet(page)
			.getByRole('button', { name: /^Done$/i })
			.first();
		await expect(done).toBeVisible({ timeout: 20_000 });
		await done.click();
		await expect(page.locator('ion-modal:visible')).toHaveCount(0, { timeout: 10_000 });

		await expect(page.getByText(/1 of \d|1 de \d/).first()).toBeVisible({ timeout: 20_000 });

		const state = await readMockState(page);
		expect(state, 'the native mock was not installed').not.toBeNull();
		// Preferences.configure({group}) prefixes keys on web, so match by suffix
		const keys = Object.keys(state!.preferences as Record<string, string>);
		expect(keys.some((key) => key.endsWith('recess.progress.v1'))).toBe(true);
	});

	test('the tab bar reaches every surface', async ({ bootToday, page }) => {
		await bootToday();
		await waitForDeck(page);

		for (const name of ['playground', 'week', 'settings', 'today'] as const) {
			await tab(page, name).click();
			await expect(page).toHaveURL(new RegExp(`/tabs/${name}`), { timeout: 10_000 });
		}
	});

	test('survives every permission being denied', async ({ bootToday, page }) => {
		await bootToday({
			deniedPermissions: ['camera', 'microphone', 'location', 'notifications']
		});
		await waitForDeck(page);

		// filters treat unknown values as passing, so a locked-down device still
		// gets a full day rather than an empty one
		await expect(page.getByText(/of \d|de \d/).first()).toBeVisible();
		await expect(frontCard(page)).toBeVisible();
	});

	test('works offline', async ({ bootToday, page }) => {
		await bootToday({ offline: true });
		await waitForDeck(page);
		await expect(frontCard(page)).toBeVisible();
	});
});
