import type { Page } from '@playwright/test';
import { expect, frontCard, tab, test, waitForDeck } from './utils/fixtures';

/**
 * Layout invariants at the size the app actually ships at.
 *
 * Everything else in this suite runs at Desktop Chrome or iPhone 14, and the
 * `mobile-chromium` project had no specs at all - so nothing was checking the app at
 * Android phone width, which is where undersized controls and horizontal overflow show up.
 * These are the checks that would otherwise be done by eye on a screenshot, which is
 * exactly the work that should not be done by eye.
 *
 * The 44px floor is Apple's HIG minimum. WCAG 2.2 SC 2.5.8 only asks for 24px, but this
 * ships as an iOS app first and Ionic's own defaults land under both - toolbar buttons
 * measured 32px and the model-pack Download button 25px before `main.css` set a floor.
 */

const TAP_MIN = 44;

/** every element that responds to a tap, and nothing that merely looks like one */
const CONTROLS = [
	'ion-button',
	'ion-back-button',
	'ion-tab-button',
	'ion-item[button]',
	'[role="button"]',
	'button',
	'a[href]',
	'ion-toggle',
	'ion-checkbox'
].join(', ');

interface Finding {
	what: string;
	detail: string;
}

/**
 * Ionic keeps the outgoing view mounted during a route transition, parked exactly one
 * viewport to the left, so an off-frame check has to ignore anything sitting there or
 * every settings drill-down reports 43 phantom violations.
 */
async function survey(page: Page) {
	// wait on the route transition itself rather than a fixed delay: a leaving page caught
	// mid-slide sits at left -409 of 412, which reads as content 3px past the right edge
	await page.waitForFunction(() => {
		const outlet = document.querySelector('ion-router-outlet');
		if (!outlet) return true;
		return outlet.getAnimations({ subtree: true }).every((a) => a.playState !== 'running');
	});
	await page.waitForTimeout(150);
	return page.evaluate(
		([selector, floor]) => {
			const doc = document.documentElement;
			const width = doc.clientWidth;
			const offstage = (rect: DOMRect) => rect.right <= 0 || rect.left >= width;

			const overflowing: { what: string; detail: string }[] = [];
			const undersized: { what: string; detail: string }[] = [];
			const truncated: { what: string; detail: string }[] = [];

			const describe = (el: Element) => {
				const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 24);
				const label = el.getAttribute('aria-label') ?? '';
				return `${el.tagName.toLowerCase()}[${text || label}]`;
			};

			for (const el of document.querySelectorAll('*')) {
				const rect = el.getBoundingClientRect();
				if (rect.width === 0 || rect.height === 0 || offstage(rect)) continue;
				if (getComputedStyle(el).position === 'fixed') continue;
				if (rect.right > width + 1 || rect.left < -1)
					overflowing.push({
						what: describe(el),
						detail: `left ${Math.round(rect.left)} right ${Math.round(rect.right)} in ${width}`
					});
			}

			for (const el of document.querySelectorAll(selector as string)) {
				const rect = el.getBoundingClientRect();
				if (rect.width === 0 || rect.height === 0 || offstage(rect)) continue;
				if (el.hasAttribute('disabled') || el.classList.contains('button-disabled')) continue;
				if (rect.height < (floor as number) || rect.width < (floor as number))
					undersized.push({
						what: describe(el),
						detail: `${rect.width.toFixed(0)}x${rect.height.toFixed(0)}`
					});
			}

			for (const el of document.querySelectorAll('h1, h2, h3, p, ion-label, ion-title')) {
				const rect = el.getBoundingClientRect();
				if (rect.width === 0 || offstage(rect)) continue;
				if (el.scrollWidth > el.clientWidth + 1)
					truncated.push({
						what: describe(el),
						detail: `${el.scrollWidth} into ${el.clientWidth}`
					});
			}

			/**
			 * A tab root slots nothing before its title, and Ionic only insets the title by
			 * whatever precedes it - so all four tab titles sat at x=0 with their text against
			 * the screen edge. Measured on the shadow `.toolbar-title`, because the host box
			 * spans the toolbar whether or not the text inside it is inset.
			 */
			const flush: { what: string; detail: string }[] = [];
			for (const el of document.querySelectorAll('ion-title')) {
				const rect = el.getBoundingClientRect();
				if (rect.width === 0 || offstage(rect)) continue;
				const inner = el.shadowRoot?.querySelector('.toolbar-title');
				const left = (inner ?? el).getBoundingClientRect().left;
				if (left < 12)
					flush.push({ what: describe(el), detail: `text starts at ${Math.round(left)}px` });
			}

			return {
				pageOverflow: doc.scrollWidth > width ? `${doc.scrollWidth} > ${width}` : null,
				overflowing,
				undersized,
				truncated,
				flush
			};
		},
		[CONTROLS, TAP_MIN] as const
	);
}

function report(findings: Finding[]) {
	return findings.map((f) => `${f.what} ${f.detail}`).join('\n');
}

async function expectClean(page: Page, where: string) {
	const found = await survey(page);
	expect(found.pageOverflow, `${where}: the page scrolls sideways`).toBeNull();
	expect(report(found.overflowing), `${where}: content past the right edge`).toBe('');
	expect(report(found.undersized), `${where}: tap targets under ${TAP_MIN}px`).toBe('');
	expect(report(found.truncated), `${where}: text clipped by its own box`).toBe('');
	expect(report(found.flush), `${where}: a title is against the screen edge`).toBe('');
}

test.describe('layout at phone width', () => {
	test('every tab fits the frame with reachable controls', async ({ bootToday, page }) => {
		await bootToday();
		await waitForDeck(page);

		for (const name of ['today', 'playground', 'out-there', 'week', 'settings'] as const) {
			await tab(page, name).click();
			await expect(page).toHaveURL(new RegExp(`/tabs/${name}`));
			await expectClean(page, name);
		}
	});

	test('every settings page does too', async ({ bootToday, page }) => {
		await bootToday({ route: '/tabs/settings' });

		for (const child of [
			'appearance',
			'nudges',
			'notifications',
			'models',
			'data',
			'about'
		] as const) {
			await page.getByTestId(`settings-${child}`).click();
			await expect(page).toHaveURL(new RegExp(child));
			await expectClean(page, `settings/${child}`);
			await page.goBack();
			await expect(page.getByTestId('settings-about')).toBeVisible();
		}
	});

	/**
	 * Onboarding is the one flow nobody can skip, and its Back/Next/Skip live in a toolbar -
	 * where Ionic's scoped 32px rule outranked the app's floor until `main.css` matched its
	 * specificity, so every first-run control was undersized.
	 */
	test('onboarding is reachable at every step', async ({ boot, page }) => {
		await boot();
		await expect(page.getByRole('button', { name: /Next|Get Started/i }).first()).toBeVisible();

		for (let step = 0; step < 8; step++) {
			await expectClean(page, `onboarding step ${step}`);
			const next = page.getByRole('button', { name: /Next|Get Started/i }).first();
			if (!(await next.isVisible().catch(() => false))) break;
			await next.click();
			await page.waitForTimeout(350);
		}
	});

	/**
	 * Onboarding is a wizard, so every step has to present its own way forward without
	 * scrolling - unlike a settings list, where content below the fold is the point.
	 *
	 * The models step is the one that breaks this, and the test above could never catch it: it
	 * stops as soon as no Next/Get Started is visible, and the models step deliberately has
	 * neither (it finishes through its own Download / Not Now actions). So that step was never
	 * audited, and both of its actions sat entirely below the fold at Pixel 7 height - the user
	 * saw four toggles and no button, and a Maestro `tapOn` could not reach either one.
	 */
	test('every onboarding step offers its way forward above the fold', async ({ boot, page }) => {
		await boot();

		for (let step = 0; step < 8; step++) {
			await page.waitForTimeout(400);

			const reachable = await page.evaluate(() => {
				const height = window.innerHeight;
				const actions = [...document.querySelectorAll('ion-button')]
					.map((el) => ({
						text: (el.textContent ?? '').trim(),
						rect: el.getBoundingClientRect()
					}))
					.filter((entry) => entry.rect.width > 0 && entry.rect.height > 0);

				// Skip and Back move backwards or out; they are not a way forward
				const forward = actions.filter(
					(entry) => !/^(Skip|Back|Omitir|Atr[aá]s)$/i.test(entry.text)
				);

				return {
					offscreen: forward
						.filter((entry) => entry.rect.bottom > height || entry.rect.top < 0)
						.map(
							(entry) =>
								`${entry.text} at ${Math.round(entry.rect.top)}-${Math.round(entry.rect.bottom)} of ${height}`
						),
					count: forward.length
				};
			});

			expect(
				reachable.count,
				`onboarding step ${step} offers no way forward at all`
			).toBeGreaterThan(0);
			expect(
				reachable.offscreen.join('\n'),
				`onboarding step ${step} hides an action off-screen`
			).toBe('');

			const next = page.getByRole('button', { name: /Next|Get Started/i }).first();
			if (!(await next.isVisible().catch(() => false))) break;
			await next.click();
		}
	});

	test('the nudge sheet fits too', async ({ bootToday, page }) => {
		await bootToday();
		await waitForDeck(page);
		await frontCard(page).click();
		await expect(page.locator('ion-modal:visible').first()).toBeVisible();
		await expectClean(page, 'nudge sheet');
	});

	// the tab bar is the one thing that sits on the home indicator, so it carries the inset
	test('the tab bar clears the bottom inset', async ({ bootToday, page }) => {
		await bootToday();
		await waitForDeck(page);

		const padding = await page
			.locator('ion-tab-bar')
			.evaluate((el) => getComputedStyle(el).paddingBottom);
		expect(padding).not.toBe('');
	});

	/**
	 * The deck used a flat 420px, which was 40px taller than the room above the tab bar on a
	 * Pixel 7 - so the front card's bottom edge and its points pill sat behind the bar before
	 * any scrolling.
	 *
	 * The invariant is not "always fits": at 667px with 1.5x type only 28px of room is left,
	 * and a 28px card is not a card, so the deck keeps its 300px floor and the page scrolls.
	 * What must hold is that the deck never takes MORE than the room available unless it is
	 * already at that floor - which is exactly what a hardcoded height cannot promise. The
	 * matrix covers both axes because the deck's top moves 180px between text-size extremes.
	 */
	const DECK_FLOOR = 300;

	for (const [height, scale] of [
		[667, '1'],
		[839, '1'],
		[932, '1'],
		[839, '1.5'],
		[667, '1.5'],
		[839, '0.7']
	] as const) {
		test(`the deck fits the room it has at ${height}px tall, ${scale}x text`, async ({
			bootToday,
			page
		}) => {
			await page.setViewportSize({ width: 412, height });
			await bootToday({ preferences: { 'recess.setting.scale': JSON.stringify(scale) } });
			await waitForDeck(page);
			await page.waitForTimeout(700);

			const box = await page.evaluate(() => {
				const frame = document.querySelector('[data-testid="deck-frame"]');
				const bar = document.querySelector('ion-tab-bar');
				if (!frame || !bar) return null;
				const scroller = frame.closest('ion-content')?.shadowRoot?.querySelector('.inner-scroll');
				const scrolled = scroller instanceof HTMLElement ? scroller.scrollTop : 0;
				const top = frame.getBoundingClientRect().top + scrolled;
				return {
					deckHeight: Math.round(frame.getBoundingClientRect().height),
					available: Math.round(bar.getBoundingClientRect().top - top)
				};
			});

			expect(box, 'no deck frame or tab bar found').not.toBeNull();
			const allowed = Math.max(DECK_FLOOR, box!.available);
			expect(
				box!.deckHeight,
				`deck is ${box!.deckHeight}px with ${box!.available}px of room, so it overruns by ${box!.deckHeight - allowed}px`
			).toBeLessThanOrEqual(allowed);
		});
	}

	/**
	 * The invariant the deck-height check was missing.
	 *
	 * Asserting only `deckBottom <= barTop` let the deck consume every last pixel, which pushed
	 * the swipe-hint row that follows it *under* the tab bar. It stayed in the accessibility
	 * tree there, overlapping the Playground tab, and swallowed the taps meant for it - a
	 * Maestro run found that, because Maestro taps screen coordinates while Playwright clicks an
	 * element directly and never noticed the element on top.
	 *
	 * Only the text sizes where the deck actually fits. At 1.5x there is ~200px of room for a
	 * card with a 300px floor, so the card itself necessarily extends past the bar and the page
	 * scrolls - that case is covered by the deck-fits matrix above instead. What this pins is
	 * that at rest, with room available, nothing is tucked underneath.
	 */
	/**
	 * The invariant the deck-height check was missing.
	 *
	 * Asserting only `deckBottom <= barTop` let the deck consume every last pixel, which pushed
	 * the swipe-hint row that follows it *under* the tab bar. It stayed in the accessibility
	 * tree there, overlapping the Playground tab, and swallowed the taps meant for it - a Maestro
	 * run found that, because Maestro taps screen coordinates while Playwright clicks an element
	 * directly and never noticed the element sitting on top.
	 *
	 * Scoped to the deck's own following row rather than "nothing overlaps the bar": the
	 * checklist below it is ordinary scrolling content and passing under an opaque tab bar is
	 * what scrolling looks like. The hint row is different - it is the deck's affordance, the
	 * deck's height is what determines where it lands, and it is the element that stole the tap.
	 *
	 * 1.5x is exempt for the same reason it is exempt above: the deck is already at its 300px
	 * floor with ~200px of room, so there is nowhere above the bar left to put anything and the
	 * page scrolls. The deck-fits matrix covers that case.
	 */
	for (const scale of ['0.7', '1'] as const) {
		test(`the deck leaves its hint row visible at ${scale}x text`, async ({ bootToday, page }) => {
			await page.setViewportSize({ width: 412, height: 839 });
			await bootToday({ preferences: { 'recess.setting.scale': JSON.stringify(scale) } });
			await waitForDeck(page);
			await page.waitForTimeout(700);

			const measured = await page.evaluate(() => {
				const frame = document.querySelector('[data-testid="deck-frame"]');
				const bar = document.querySelector('ion-tab-bar');
				const following = document.querySelector('[data-deck-hint]');
				if (!frame || !bar || !(following instanceof HTMLElement)) return null;
				return {
					hint: (following.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40),
					hintBottom: Math.round(following.getBoundingClientRect().bottom),
					barTop: Math.round(bar.getBoundingClientRect().top)
				};
			});

			expect(measured, 'no deck frame, tab bar, or following row').not.toBeNull();
			expect(
				measured!.hintBottom,
				`the hint row "${measured!.hint}" runs ${measured!.hintBottom - measured!.barTop}px under the tab bar, where it still takes taps meant for a tab`
			).toBeLessThanOrEqual(measured!.barTop);
		});
	}

	// and the room is genuinely used rather than the floor being taken everywhere
	test('the deck grows into a taller viewport', async ({ bootToday, page }) => {
		const heightAt = async (viewport: number) => {
			await page.setViewportSize({ width: 412, height: viewport });
			await bootToday();
			await waitForDeck(page);
			await page.waitForTimeout(700);
			return page
				.getByTestId('deck-frame')
				.evaluate((el) => Math.round(el.getBoundingClientRect().height));
		};

		const short = await heightAt(760);
		const tall = await heightAt(932);
		expect(tall, `deck stayed at ${tall}px on a taller screen`).toBeGreaterThan(short);
	});
});
