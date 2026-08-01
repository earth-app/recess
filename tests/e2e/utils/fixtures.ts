import { test as base, expect, type Page } from '@playwright/test';
import { saveCoverageForTest } from './coverage';
import {
	completedOnboarding,
	installNativeMock,
	readMockState,
	type NativeMockOptions
} from './native-mock';

// One fixture that installs the native mock before the app boots, plus the small
// helpers every journey needs. Ionic's shadow DOM and its habit of keeping
// dismissed overlays in the DOM make a few of these non-obvious.

export interface RecessFixtures {
	/** boot the app with the native bridge mocked */
	boot: (options?: NativeMockOptions & { route?: string }) => Promise<void>;
	/** boot straight past onboarding onto the dashboard */
	bootToday: (options?: NativeMockOptions & { route?: string }) => Promise<void>;
	mockState: () => Promise<Awaited<ReturnType<typeof readMockState>>>;
	/** messages of every confirm/alert raised so far, in order */
	confirms: string[];
}

/**
 * The tour is a full-screen modal that swallows every click behind it, so it is seeded
 * as already finished for every spec except its own - which opts back in by passing
 * `TOUR_KEY` explicitly, since a spec's own `preferences` spread wins over this.
 *
 * Seeded rather than gated on a build flag: `test -d dist ||` in the webServer command
 * means playwright happily serves whatever build is already in `.output`, so a
 * `NUXT_PUBLIC_TEST_BUILD` check silently inverts after any plain `generate` run.
 */
export const TOUR_KEY = 'recess.tour.v1';
export const tourSeen = () => ({ [TOUR_KEY]: { completedVersion: 1, step: 0 } });
export const tourUnseen = () => ({ [TOUR_KEY]: { completedVersion: 0, step: 0 } });

export const test = base.extend<RecessFixtures>({
	/**
	 * `useNotify().confirm` falls back to `window.confirm` off-native, and Playwright
	 * auto-*dismisses* native dialogs - so an unhandled confirm silently answers "no"
	 * and the action under test just never happens. Accept every dialog and record it,
	 * rather than letting a spec add its own handler: two handlers both calling
	 * `accept()` is an error, and `waitForEvent` counts as one.
	 */
	confirms: async ({ page }, use) => {
		const seen: string[] = [];
		page.on('dialog', (dialog) => {
			seen.push(dialog.message());
			void dialog.accept();
		});
		await use(seen);
	},

	boot: async ({ page }, use) => {
		await use(async (options = {}) => {
			const { route = '/', ...mock } = options;
			await installNativeMock(page, {
				...mock,
				preferences: { ...tourSeen(), ...(mock.preferences ?? {}) }
			});
			await page.goto(route);
		});
	},

	bootToday: async ({ page }, use) => {
		await use(async (options = {}) => {
			const { route = '/tabs/today', ...mock } = options;
			await installNativeMock(page, {
				...mock,
				preferences: {
					...completedOnboarding(),
					...tourSeen(),
					...(mock.preferences ?? {})
				}
			});
			await page.goto(route);
			await expect(page.locator('ion-content').first()).toBeVisible();
		});
	},

	mockState: async ({ page }, use) => {
		await use(() => readMockState(page));
	},

	/**
	 * Wraps every page in V8 coverage when `COVERAGE=1`, chromium only - webkit exposes no
	 * equivalent. `resetOnNavigation: false` matters here more than in a single-page app: the tab
	 * shell navigates on nearly every spec, and the default would discard everything measured
	 * before the last route change.
	 */
	page: async ({ page, browserName }, use, testInfo) => {
		const collecting = browserName === 'chromium' && process.env.COVERAGE === '1';
		if (collecting) await page.coverage.startJSCoverage({ resetOnNavigation: false });

		await use(page);

		if (!collecting) return;
		try {
			await saveCoverageForTest(testInfo.testId, await page.coverage.stopJSCoverage());
		} catch {
			// the page closed first; nothing left to read
		}
	}
});

export { expect };

/**
 * The title of the deck's front card.
 *
 * `h2` alone is not enough: the Today page also has an `h2` for the checklist section
 * and one for its empty state, and which of them sorts first depends on whether the
 * deck has painted yet - so `h2.first()` intermittently read the wrong heading.
 */
export function frontCard(page: Page) {
	return page.getByTestId('nudge-title').first();
}

/**
 * Ionic keeps dismissed modals in the DOM with `aria-hidden`, so a plain
 * `ion-modal` locator matches stale ones too. Always scope to the visible one.
 */
export function openSheet(page: Page) {
	return page.locator('ion-modal:visible').first();
}

/**
 * The action that resolves a nudge, whatever its type.
 *
 * Two traps: `getByRole('button')` also matches Ionic's sheet-handle button, and
 * the sheet's own toolbar close button is an `ion-button` with empty text. Both
 * sort ahead of the real actions, so scope to non-toolbar buttons that have text.
 */
export function resolveAction(page: Page) {
	return openSheet(page)
		.locator('ion-button:not(.in-toolbar)')
		.filter({ hasText: /\S/ })
		.filter({ hasNotText: /Not Now/i })
		.first();
}

/** ion-button does not reflect `disabled` to the DOM; it sets a class instead */
export async function expectButtonDisabled(page: Page, name: string | RegExp) {
	const button = page.getByRole('button', { name });
	await expect(button).toHaveClass(/button-disabled/);
}

/**
 * Wait for the deck to settle; the store hydrates from Preferences first.
 *
 * Asserts a positive readiness marker rather than the absence of spinners -
 * `IonRefresherContent` always contains one, so counting spinners never reaches
 * zero and would hang every spec.
 */
export async function waitForDeck(page: Page) {
	await expect(page.getByTestId('today-ready')).toBeVisible({ timeout: 20_000 });
}

/**
 * `IonTabButton` takes `tab` and `href` as component props and does NOT reflect
 * them to DOM attributes, so `ion-tab-button[tab="today"]` matches nothing. Ionic
 * does emit a stable `id`, and matching on label text is unreliable because the
 * today tab's innerText also contains its badge count.
 */
export function tab(page: Page, name: 'today' | 'playground' | 'week' | 'settings') {
	return page.locator(`#tab-button-${name}`);
}
