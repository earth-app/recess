import { mountSuspended } from '@nuxt/test-utils/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OnboardingInterests from '~/components/onboarding/Interests.vue';
import type { NudgeCategory } from '~/types/nudge';
import { NUDGE_CATEGORIES } from '~/types/nudge';

/**
 * The onboarding step that seeds the recommender.
 *
 * There is no minimum and no maximum: interests are prior evidence for `affinity.ts`, never a
 * filter, so an empty answer has to be written through rather than treated as unfinished. What it
 * writes is the category id (`nature`), not the label the chip shows, because that string is what
 * `recommend()` matches against a nudge's `category`.
 */

const { setInterests, init, selection, haptics } = vi.hoisted(() => ({
	setInterests: vi.fn(async (_categories: NudgeCategory[]) => {}),
	init: vi.fn(async () => {}),
	selection: vi.fn((): NudgeCategory[] => []),
	haptics: vi.fn()
}));

vi.mock('~/composables/useOnboarding', async (importOriginal) => {
	const actual = await importOriginal<typeof import('~/composables/useOnboarding')>();
	return { ...actual, useOnboarding: () => ({ ...actual.useOnboarding(), setInterests }) };
});

vi.mock('~/composables/useSettings', async (importOriginal) => {
	const actual = await importOriginal<typeof import('~/composables/useSettings')>();
	return {
		...actual,
		useAppSettings: () => {
			const settings = actual.useAppSettingsState();
			settings.value = { ...settings.value, interests: [...selection()] };
			return {
				settings,
				initialized: ref(true),
				init,
				setValue: vi.fn(),
				resetToDefaults: vi.fn()
			};
		}
	};
});

vi.mock('~/composables/useHaptics', () => ({
	useHaptics: () => ({
		selection: haptics,
		swipe: vi.fn(),
		success: vi.fn(),
		warning: vi.fn(),
		tap: vi.fn()
	})
}));

/** IonChip swallows its slot, so the category labels never reach the dom without this */
const passthrough = { template: '<div><slot /></div>' };

type Wrapper = Awaited<ReturnType<typeof mountSuspended<typeof OnboardingInterests>>>;
let mounted: Wrapper | null = null;

/** the saved selection is read in `onMounted`, so a flush is required */
async function step() {
	mounted = await mountSuspended(OnboardingInterests, {
		global: { stubs: { IonChip: passthrough } }
	});
	await new Promise((r) => setTimeout(r, 0));
	await mounted.vm.$nextTick();
	return mounted;
}

const chips = (w: Wrapper) => w.findAll('[role="button"]');
const chip = (w: Wrapper, label: string) => chips(w).find((entry) => entry.text() === label)!;
const lastSaved = () => setInterests.mock.lastCall?.[0];

beforeEach(() => {
	vi.clearAllMocks();
	selection.mockReturnValue([]);
});

afterEach(() => {
	mounted?.unmount();
	mounted = null;
});

describe('what it offers', () => {
	it('offers all nine categories, in catalog order', async () => {
		const w = await step();
		expect(chips(w).map((entry) => entry.text())).toEqual([
			'People',
			'Adventure',
			'Home',
			'Learn',
			'Cooking',
			'Nature',
			'Errands',
			'Exercise',
			'Art'
		]);
		expect(chips(w)).toHaveLength(NUDGE_CATEGORIES.length);
	});

	it('starts with nothing chosen and counts what is', async () => {
		const w = await step();

		expect(chips(w).every((entry) => entry.attributes('aria-pressed') === 'false')).toBe(true);
		expect(w.text()).toContain('0 picked');
	});

	it('shows the picks a resumed run already saved', async () => {
		selection.mockReturnValue(['nature', 'art']);
		const w = await step();

		expect(chip(w, 'Nature').attributes('aria-pressed')).toBe('true');
		expect(chip(w, 'Art').attributes('aria-pressed')).toBe('true');
		expect(chip(w, 'People').attributes('aria-pressed')).toBe('false');
		expect(w.text()).toContain('2 picked');
	});

	it('writes nothing before anything is touched', async () => {
		await step();
		expect(setInterests, 'mounting the step overwrote the saved answer').not.toHaveBeenCalled();
	});
});

describe('the selection', () => {
	it('saves the category id, not the label on the chip', async () => {
		const w = await step();
		await chip(w, 'Nature').trigger('click');

		expect(lastSaved()).toEqual(['nature']);
	});

	it('keeps every pick rather than replacing the last', async () => {
		const w = await step();
		for (const label of ['People', 'Nature', 'Art']) await chip(w, label).trigger('click');

		expect(lastSaved()).toEqual(['people', 'nature', 'art']);
		expect(w.text()).toContain('3 picked');
	});

	it('round-trips a deselect', async () => {
		const w = await step();
		await chip(w, 'Cooking').trigger('click');
		expect(chip(w, 'Cooking').attributes('aria-pressed')).toBe('true');

		await chip(w, 'Cooking').trigger('click');
		expect(chip(w, 'Cooking').attributes('aria-pressed')).toBe('false');
		expect(lastSaved()).toEqual([]);
		expect(w.text()).toContain('0 picked');
	});

	it('drops only the chip that was deselected', async () => {
		const w = await step();
		for (const label of ['Home', 'Learn', 'Exercise']) await chip(w, label).trigger('click');
		await chip(w, 'Learn').trigger('click');

		expect(lastSaved()).toEqual(['home', 'exercise']);
	});

	/**
	 * No minimum and no maximum, so the empty set has to be persisted as an answer. Dropping the
	 * write would leave a resumed run showing picks the user had just cleared.
	 */
	it('saves an empty answer instead of skipping the write', async () => {
		const w = await step();
		await chip(w, 'Errands').trigger('click');
		await chip(w, 'Errands').trigger('click');

		expect(setInterests).toHaveBeenCalledTimes(2);
		expect(lastSaved()).toEqual([]);
	});

	it('lets every category be chosen at once', async () => {
		const w = await step();
		for (const entry of chips(w)) await entry.trigger('click');

		expect(lastSaved()).toEqual([...NUDGE_CATEGORIES]);
		expect(w.text()).toContain('9 picked');
	});

	it('saves ids the recommender knows', async () => {
		const w = await step();
		for (const entry of chips(w)) await entry.trigger('click');

		for (const id of lastSaved() ?? []) {
			expect(NUDGE_CATEGORIES as readonly string[], `${id} is not a category`).toContain(id);
		}
	});

	it('ticks once per toggle', async () => {
		const w = await step();
		await chip(w, 'Art').trigger('click');
		await chip(w, 'Art').trigger('click');

		expect(haptics).toHaveBeenCalledTimes(2);
	});
});

describe('reachability', () => {
	// Ionic gives IonChip no role, no focus and no key handling, so the component adds all three
	it('presents every chip as a named toggle', async () => {
		const w = await step();

		for (const entry of chips(w)) {
			expect(entry.attributes('tabindex'), 'a chip cannot be focused').toBe('0');
			expect(entry.attributes('aria-pressed'), 'a toggle with no state').toBeDefined();
			expect(entry.text().trim().length, 'a tappable chip with no accessible name').toBeGreaterThan(
				0
			);
		}
	});

	it('toggles on enter', async () => {
		const w = await step();
		await chip(w, 'Nature').trigger('keydown.enter');

		expect(lastSaved()).toEqual(['nature']);
		expect(chip(w, 'Nature').attributes('aria-pressed')).toBe('true');
	});

	it('toggles on space', async () => {
		const w = await step();
		await chip(w, 'Nature').trigger('keydown.space');

		expect(lastSaved()).toEqual(['nature']);
	});
});
