import { expect, frontCard, test, tourUnseen, waitForDeck } from './utils/fixtures';

/**
 * The tour exists because the deck's swipe gestures are invisible affordances - nothing
 * on screen said a swipe resolved anything, and people did not know it counted.
 */
test.describe('the first-run tour', () => {
	// ion-modal's internal wrapper is also a div[role=dialog][aria-modal=true], so the
	// tour carries its own testid rather than being matched by role alone
	const dialog = '[data-testid="tour"]';

	test('opens on a first run and leads with the swipe demonstration', async ({
		bootToday,
		page
	}) => {
		await bootToday({ preferences: tourUnseen() });
		await waitForDeck(page);

		const tour = page.locator(dialog);
		await expect(tour).toBeVisible({ timeout: 15_000 });

		// the gesture step is first, and it shows both directions rather than describing them
		await expect(tour.getByText(/Swipe to Choose|Desliza/i)).toBeVisible();
		await expect(tour.getByTestId('swipe-hint')).toBeVisible();
		await expect(tour.getByTestId('swipe-hint')).toContainText(/Not Now|Ahora No/i);
		await expect(tour.getByTestId('swipe-hint')).toContainText(/Open|Abrir/i);
		await expect(tour).toContainText(/1 \/ \d/);
	});

	test('walks every step and closes at the end', async ({ bootToday, page }) => {
		await bootToday({ preferences: tourUnseen() });
		await waitForDeck(page);

		const tour = page.locator(dialog);
		await expect(tour).toBeVisible({ timeout: 15_000 });

		const total = Number((await tour.textContent())?.match(/1 \/ (\d)/)?.[1] ?? 0);
		expect(total).toBeGreaterThan(1);

		for (let step = 1; step < total; step++) {
			await tour.getByRole('button', { name: /Next|Siguiente/i }).click();
			await expect(tour).toContainText(new RegExp(`${step + 1} / ${total}`));
		}

		await tour.getByRole('button', { name: /Got It|Entendido/i }).click();
		await expect(tour).toBeHidden();
	});

	// skip is not "later" - a half-seen tour must not nag, so it lands in finish() too
	test('skipping closes it for good', async ({ bootToday, page }) => {
		await bootToday({ preferences: tourUnseen() });
		await waitForDeck(page);

		const tour = page.locator(dialog);
		await expect(tour).toBeVisible({ timeout: 15_000 });
		await tour.getByRole('button', { name: /Skip|Omitir/i }).click();
		await expect(tour).toBeHidden();
	});

	/**
	 * The launch gate, end to end through the real storage read.
	 *
	 * What `finish()` actually *writes* is asserted in the unit lane instead: the harness
	 * runs the mock stub and Capacitor's real web Preferences side by side, and which one
	 * serves a call is a boot race, so reading a persisted number back through it measures
	 * the harness rather than the app.
	 */
	test('a finished tour does not open on the next launch', async ({ bootToday, page }) => {
		await bootToday();
		await waitForDeck(page);
		await expect(page.locator(dialog)).toBeHidden();
		// and the deck is immediately usable, with no scrim in the way
		await frontCard(page).click();
		await expect(page.locator('ion-modal:visible').first()).toBeVisible({ timeout: 10_000 });
	});

	test('escape closes it, and it is a real modal dialog', async ({ bootToday, page }) => {
		await bootToday({ preferences: tourUnseen() });
		await waitForDeck(page);

		const tour = page.locator(dialog);
		await expect(tour).toBeVisible({ timeout: 15_000 });
		await expect(tour).toHaveAttribute('aria-labelledby', 'recess-tour-title');

		await page.keyboard.press('Escape');
		await expect(tour).toBeHidden();
	});

	test('leaves the deck usable once dismissed', async ({ bootToday, page }) => {
		await bootToday({ preferences: tourUnseen() });
		await waitForDeck(page);

		const tour = page.locator(dialog);
		await expect(tour).toBeVisible({ timeout: 15_000 });
		await tour.getByRole('button', { name: /Skip|Omitir/i }).click();
		await expect(tour).toBeHidden();

		// the scrim covered the screen; if it lingers, the card underneath is unclickable
		await frontCard(page).click();
		await expect(page.locator('ion-modal:visible').first()).toBeVisible({ timeout: 10_000 });
	});

	// version gating (a rewritten tour running again for a finished user) is deterministic
	// arithmetic over the stored state, so it lives in tests/unit/composables/useAppTour.spec.ts
});

/**
 * The swipe demonstration's geometry.
 *
 * The travel used to be a percentage of the CARD's width, so it was a fixed ~80px however
 * wide the sheet got - on the 448px tour card that put the ghost on top of the labels it
 * is meant to be pointing at. Travel is now measured from the container.
 */
test.describe('the swipe demonstration', () => {
	test('the ghost never covers either label, at any point in the loop', async ({
		bootToday,
		page
	}) => {
		await bootToday({ preferences: tourUnseen() });
		await waitForDeck(page);
		await expect(page.getByTestId('swipe-hint')).toBeVisible({ timeout: 15_000 });

		const ghost = page.getByTestId('swipe-hint-card');
		const skip = page.getByTestId('swipe-hint-skip');
		const open = page.getByTestId('swipe-hint-open');

		const skipBox = await skip.boundingBox();
		const openBox = await open.boundingBox();
		expect(skipBox && openBox).toBeTruthy();

		// sample the whole loop by driving the animation clock rather than waiting on it
		const duration = await ghost.evaluate(
			(el) => (el.getAnimations()[0]?.effect?.getTiming().duration as number) ?? 0
		);
		expect(duration).toBeGreaterThan(0);

		for (let step = 0; step <= 20; step++) {
			const at = (duration * step) / 20;
			await page.evaluate((time) => {
				for (const el of document.querySelectorAll('[data-testid="swipe-hint"] *')) {
					for (const animation of el.getAnimations()) {
						animation.pause();
						animation.currentTime = time;
					}
				}
			}, at);

			const box = await ghost.boundingBox();
			expect(box, `no ghost box at ${at}ms`).toBeTruthy();

			const overlaps = (other: { x: number; width: number }) =>
				box!.x < other.x + other.width && box!.x + box!.width > other.x;

			expect(overlaps(skipBox!), `ghost covers "Not Now" at ${Math.round(at)}ms`).toBe(false);
			expect(overlaps(openBox!), `ghost covers "Open" at ${Math.round(at)}ms`).toBe(false);
		}
	});

	test('the swing is symmetric and stays inside the frame', async ({ bootToday, page }) => {
		await bootToday({ preferences: tourUnseen() });
		await waitForDeck(page);

		const hint = page.getByTestId('swipe-hint');
		await expect(hint).toBeVisible({ timeout: 15_000 });

		const frame = (await hint.boundingBox())!;
		const ghost = page.getByTestId('swipe-hint-card');
		const duration = await ghost.evaluate(
			(el) => (el.getAnimations()[0]?.effect?.getTiming().duration as number) ?? 0
		);

		const centreAt = async (fraction: number) => {
			await page.evaluate((time) => {
				for (const el of document.querySelectorAll('[data-testid="swipe-hint"] *')) {
					for (const animation of el.getAnimations()) {
						animation.pause();
						animation.currentTime = time;
					}
				}
			}, duration * fraction);
			const box = (await ghost.boundingBox())!;
			// every sample has to stay within the clipped frame
			expect(box.x).toBeGreaterThanOrEqual(frame.x - 1);
			expect(box.x + box.width).toBeLessThanOrEqual(frame.x + frame.width + 1);
			return box.x + box.width / 2 - (frame.x + frame.width / 2);
		};

		const rest = await centreAt(0.02);
		const right = await centreAt(0.3);
		const left = await centreAt(0.78);

		expect(Math.abs(rest)).toBeLessThan(2);
		expect(right).toBeGreaterThan(20);
		expect(left).toBeLessThan(-20);
		// the two swings mirror each other
		expect(Math.abs(right + left)).toBeLessThan(2);
	});
});

/**
 * The spotlight has to ring the element the step is actually talking about.
 *
 * The checklist step sits below the fold. Its rect was measured off-screen and then
 * clamped to the viewport, which produced a box that happened to sit over the deck - so
 * the ring highlighted the wrong element and nothing about it looked broken.
 */
test.describe('the tour spotlight', () => {
	const TARGETS: Record<string, string> = {
		'Swipe to Choose': '[data-tour="deck"]',
		'Four a Day': '[data-tour="ring"]',
		'The Whole Day': '[data-tour="list"]',
		'Something Grows': '#tab-button-playground',
		'Your Week': '#tab-button-week'
	};

	test('rings the element each step describes', async ({ bootToday, page }) => {
		await bootToday({ preferences: tourUnseen() });
		await waitForDeck(page);

		const tour = page.getByTestId('tour');
		await expect(tour).toBeVisible({ timeout: 15_000 });

		const total = Number((await tour.textContent())?.match(/1 \/ (\d)/)?.[1] ?? 0);
		expect(total).toBe(Object.keys(TARGETS).length);

		for (let step = 0; step < total; step++) {
			const heading = (await tour.locator('h2').textContent())?.trim() ?? '';
			const key = Object.keys(TARGETS).find((name) => heading.startsWith(name));
			expect(key, `no expected target for step "${heading}"`).toBeTruthy();

			const ring = tour.locator('div.pointer-events-none.absolute.z-10');
			await expect(ring, `step "${heading}" drew no spotlight`).toBeVisible();

			// the ring tweens between steps, so measure only once it has stopped moving
			let previous = '';
			await expect
				.poll(
					async () => {
						const box = await ring.boundingBox();
						const key = JSON.stringify(box);
						const settled = key === previous;
						previous = key;
						return settled;
					},
					{ timeout: 5_000 }
				)
				.toBe(true);

			const ringBox = (await ring.boundingBox())!;
			const targetBox = (await page.locator(TARGETS[key!]!).first().boundingBox())!;

			// the ring is the target's rect plus 8px of padding on every side
			expect(Math.abs(ringBox.x - (targetBox.x - 8)), `x for "${heading}"`).toBeLessThan(2);
			expect(Math.abs(ringBox.y - (targetBox.y - 8)), `y for "${heading}"`).toBeLessThan(2);
			expect(
				Math.abs(ringBox.width - (targetBox.width + 16)),
				`width for "${heading}"`
			).toBeLessThan(2);
			expect(
				Math.abs(ringBox.height - (targetBox.height + 16)),
				`height for "${heading}"`
			).toBeLessThan(2);

			if (step < total - 1) {
				await tour.getByRole('button', { name: /Next|Siguiente/i }).click();
				await expect(tour).toContainText(new RegExp(`${step + 2} / ${total}`));
			}
		}
	});

	test('scrolls a below-the-fold target into view rather than ringing empty space', async ({
		bootToday,
		page
	}) => {
		await bootToday({ preferences: tourUnseen() });
		await waitForDeck(page);

		const tour = page.getByTestId('tour');
		await expect(tour).toBeVisible({ timeout: 15_000 });

		// walk to the checklist step, which starts off-screen
		for (let step = 0; step < 2; step++) {
			await tour.getByRole('button', { name: /Next|Siguiente/i }).click();
			await page.waitForTimeout(150);
		}
		await expect(tour.locator('h2')).toContainText(/The Whole Day|Todo el/i);

		const list = page.locator('[data-tour="list"]');
		const box = (await list.boundingBox())!;
		const height = page.viewportSize()!.height;

		// fully on screen, which is what makes the ring meaningful
		expect(box.y).toBeGreaterThanOrEqual(0);
		expect(box.y + box.height).toBeLessThanOrEqual(height);
	});
});
