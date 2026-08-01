import { expect, test } from './utils/fixtures';
import { readMockState } from './utils/native-mock';

test.describe('onboarding', () => {
	test('a first run lands on onboarding, not the dashboard', async ({ boot, page }) => {
		await boot();
		await expect(page).toHaveURL(/\/onboarding/);
	});

	test('a completed run skips straight to today', async ({ bootToday, page }) => {
		await bootToday();
		await expect(page).toHaveURL(/\/tabs\/today/);
	});

	test('walking the whole flow lands on today and persists completion', async ({
		boot,
		page,
		confirms
	}) => {
		await boot();
		await expect(page).toHaveURL(/\/onboarding/);

		// five Next presses walk the slides, interests and times; the models step
		// deliberately hides Next and finishes through its own actions instead
		for (let step = 0; step < 5; step++) {
			const next = page.getByRole('button', { name: /Next|Start|Get Started/i }).first();
			if (!(await next.isVisible().catch(() => false))) break;
			await next.click();
			await page.waitForTimeout(250);
		}

		// the models step runs a capability benchmark on mount, so its actions appear
		// a beat later than the rest of the flow
		const notNow = page.getByRole('button', { name: /Not Now/i }).first();
		await expect(notNow).toBeVisible({ timeout: 30_000 });

		// skipping the packs drops every photo, text and audio nudge to self-attestation,
		// so it asks first; the fixture accepts and records the confirm
		await notNow.click();
		await expect
			.poll(() => confirms.join('\n'), { timeout: 10_000 })
			.toMatch(/photos, writing, or audio/i);

		await expect(page).toHaveURL(/\/tabs\/today/, { timeout: 20_000 });

		const state = await readMockState(page);
		// Preferences.configure({group}) prefixes every key on web, so match by suffix
		const entry = Object.entries(state!.preferences as Record<string, string>).find(([key]) =>
			key.endsWith('recess.onboarding.v1')
		);
		expect(entry, 'onboarding completion was not persisted').toBeTruthy();
		expect(JSON.parse(String(entry![1])).completed).toBe(true);
	});

	test('skipping jumps to today without answering anything', async ({ boot, page }) => {
		await boot();
		const skip = page.getByRole('button', { name: /Skip|Saltar/i }).first();
		await expect(skip).toBeVisible();
		await skip.click();
		await expect(page).toHaveURL(/\/tabs\/today/, { timeout: 15_000 });
	});

	test('resumes at the step it was left on', async ({ boot, page }) => {
		await boot({
			preferences: {
				'recess.onboarding.v1': JSON.stringify({
					completed: false,
					step: 3,
					skippedModels: false,
					completedAt: null
				})
			}
		});

		await expect(page).toHaveURL(/\/onboarding/);
		// step 3 is the interests picker; its heading is the stable hook
		await expect(page.getByText(/What Are You Drawn To/i).first()).toBeVisible({
			timeout: 15_000
		});
	});

	test('a denied notification permission does not trap the user', async ({ boot, page }) => {
		await boot({
			deniedPermissions: ['notifications'],
			preferences: {
				'recess.onboarding.v1': JSON.stringify({
					completed: false,
					step: 4,
					skippedModels: false,
					completedAt: null
				})
			}
		});

		await expect(page).toHaveURL(/\/onboarding/);
		const next = page.getByRole('button', { name: /Next|Start|Siguiente|Empezar/i }).first();
		await expect(next).toBeEnabled();
	});
});
