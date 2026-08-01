import { expect, test, waitForDeck } from './utils/fixtures';

/**
 * Regression cover for two theming bugs that produce a visibly broken app while
 * throwing nothing, so only a rendered assertion catches them.
 *
 * 1. `@nuxt/ui` brings `@nuxtjs/color-mode`, which writes `.dark` on the root from the
 *    OS preference. Ionic's palette does not follow that class - it ships as a
 *    separate sheet keyed off `.ion-palette-dark`, and `@nuxtjs/ionic` imports none of
 *    the palette files. Dark Nuxt UI tokens over light Ionic surfaces read as dark
 *    cards floating on a white page.
 * 2. Ionic never *declares* `--ion-background-color`; its components inline
 *    `var(--ion-background-color, #fff)` fallbacks instead. Anything of ours reading
 *    the variable directly resolved to whatever fallback we wrote, which made the
 *    nudge card translucent and let three stacked deck cards' copy show at once.
 */

function hexToRgb(value: string): string {
	if (!value.startsWith('#')) return value;
	const hex = value.length === 4 ? [...value.slice(1)].map((c) => c + c).join('') : value.slice(1);
	const parts = [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
	return `rgb(${parts.join(',')})`;
}

function contrast(a: string, b: string): number {
	const luminance = (color: string) => {
		const parts = color
			.match(/[\d.]+/g)
			?.slice(0, 3)
			.map(Number) ?? [0, 0, 0];
		const channel = (value: number) => {
			const scaled = value / 255;
			return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
		};
		const [r, g, blue] = parts.map(channel) as [number, number, number];
		return 0.2126 * r + 0.7152 * g + 0.0722 * blue;
	};

	const first = luminance(a);
	const second = luminance(b);
	return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

test.describe('theme coherence', () => {
	/**
	 * Booted twice rather than flipped in place: the native mock re-seeds Preferences
	 * from an `addInitScript`, which runs again on reload and would put the original
	 * theme straight back.
	 */
	test('the ionic palette class is present in dark mode', async ({ bootToday, page }) => {
		await bootToday({ preferences: { 'recess.setting.theme': JSON.stringify('dark') } });
		await waitForDeck(page);

		const root = page.locator('html');
		await expect(root).toHaveClass(/\bdark\b/);
		await expect(root).toHaveClass(/\bion-palette-dark\b/);
	});

	test('and absent in light mode, so the inverse bug cannot appear either', async ({
		bootToday,
		page
	}) => {
		await bootToday({ preferences: { 'recess.setting.theme': JSON.stringify('light') } });
		await waitForDeck(page);

		const root = page.locator('html');
		await expect(root).not.toHaveClass(/\bion-palette-dark\b/);
		await expect(root).not.toHaveClass(/\bdark\b/);
	});

	test('ion-content actually paints dark in dark mode', async ({ bootToday, page }) => {
		await bootToday({ preferences: { 'recess.setting.theme': JSON.stringify('dark') } });
		await waitForDeck(page);

		// the whole point of importing the palette sheet: this must not stay white
		const declared = await page.evaluate(() =>
			getComputedStyle(document.documentElement).getPropertyValue('--ion-background-color').trim()
		);
		expect(declared).not.toBe('');
		expect(declared.toLowerCase()).not.toBe('#ffffff');

		const background = await page
			.locator('ion-content')
			.first()
			.evaluate((element) => getComputedStyle(element).getPropertyValue('--background'));
		expect(background).toBeTruthy();
	});

	test('the token ladder is declared on the root only, so the dark palette can win', async ({
		bootToday,
		page
	}) => {
		await bootToday({ preferences: { 'recess.setting.theme': JSON.stringify('dark') } });
		await waitForDeck(page);

		// declaring the ladder on body or ion-app re-declares it locally, and a local
		// declaration beats an inherited one whatever the specificity
		const [onRoot, onBody] = await page.evaluate(() => {
			const read = (element: Element) =>
				getComputedStyle(element).getPropertyValue('--ion-text-color').trim();
			return [read(document.documentElement), read(document.body)];
		});

		expect(onBody).toBe(onRoot);
	});

	test('the muted-text rung clears AA against the page, in both themes', async ({
		bootToday,
		page
	}) => {
		for (const theme of ['light', 'dark']) {
			await bootToday({ preferences: { 'recess.setting.theme': JSON.stringify(theme) } });
			await waitForDeck(page);

			// step-400 is what a bare `ion-note` and most de-emphasised copy resolves to; a
			// tinted rather than neutral ladder is what dragged it under AA before
			const pair = await page.evaluate(() => {
				const root = getComputedStyle(document.documentElement);
				return {
					muted: root.getPropertyValue('--ion-text-color-step-400').trim(),
					background: root.getPropertyValue('--ion-background-color').trim()
				};
			});

			expect(pair.muted).not.toBe('');
			expect(pair.background).not.toBe('');
			expect(contrast(hexToRgb(pair.muted), hexToRgb(pair.background))).toBeGreaterThanOrEqual(4.5);
		}
	});
});

test.describe('deck card opacity', () => {
	test('only the front card of the deck shows any copy', async ({ bootToday, page }) => {
		await bootToday();
		await waitForDeck(page);

		const cards = page.locator('.nudge-back');

		// the back of the deck is a blank accent surface; if it carries text again, three
		// titles land within 14px of each other and all of them are legible at once
		const count = await cards.count();
		for (let index = 0; index < count; index++) {
			expect((await cards.nth(index).innerText()).trim()).toBe('');
		}
	});
});

/**
 * Tailwind v4's preflight sets `border: 0 solid` on `*`, and an outer-document rule beats
 * a shadow-root `:host()` rule regardless of specificity. `ion-chip` is the only Ionic
 * component that draws its border on the host itself, so its
 * `:host(.chip-outline){border-width:1px}` silently never applied and outline chips
 * rendered as bare text with invisible padding. `ion-button` and `ion-item` are safe -
 * their borders sit on shadow descendants, out of preflight's reach.
 */
test.describe('outline chips keep their border', () => {
	/**
	 * Routed straight at the settings interest grid rather than walked through onboarding:
	 * `outline` is a Vue prop that never reflects to the DOM, so the class Ionic derives from
	 * it is the only handle, and stepping through onboarding to reach a chip made the test
	 * depend on which slide the Next button was on.
	 */
	test('every unselected interest chip has a visible border', async ({ bootToday, page }) => {
		await bootToday({ route: '/tabs/settings/nudges' });

		const chips = page.locator('ion-chip.chip-outline');
		await expect(chips.first()).toBeVisible();

		const count = await chips.count();
		expect(count, 'no outline chips found to check').toBeGreaterThan(0);

		for (let index = 0; index < count; index++) {
			const width = await chips
				.nth(index)
				.evaluate((el) => Number.parseFloat(getComputedStyle(el).borderTopWidth));
			expect(width, `outline chip ${index} has no border`).toBeGreaterThan(0);
		}
	});
});
