import { beforeEach, describe, expect, it, vi } from 'vitest';

const { store, prefsGet, prefsSet } = vi.hoisted(() => {
	const backing = new Map<string, string>();
	return {
		store: backing,
		prefsGet: vi.fn(async ({ key }: { key: string }) => ({ value: backing.get(key) ?? null })),
		prefsSet: vi.fn(async ({ key, value }: { key: string; value: string }) => {
			backing.set(key, value);
		})
	};
});

vi.mock('@capacitor/preferences', () => ({
	Preferences: {
		configure: vi.fn(async () => {}),
		get: prefsGet,
		set: prefsSet,
		remove: vi.fn(async () => {}),
		clear: vi.fn(async () => {})
	}
}));

import {
	hasSeenTour,
	parseTour,
	TOUR_DEFAULTS,
	TOUR_KEY,
	TOUR_STEPS,
	TOUR_VERSION,
	useAppTour
} from '~/composables/useAppTour';

describe('TOUR_STEPS', () => {
	it('has a unique id per step', () => {
		const ids = TOUR_STEPS.map((step) => step.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('teaches the swipe first, which is the affordance nothing on screen reveals', () => {
		expect(TOUR_STEPS[0]?.id).toBe('deck');
		expect(TOUR_STEPS[0]?.demo).toBe('swipe');
	});

	it('points every step at a real selector shape, or deliberately at nothing', () => {
		for (const step of TOUR_STEPS) {
			if (step.target === null) continue;
			expect(step.target).toMatch(/^[#.[]/);
		}
	});

	it('names an i18n key for every title and body', () => {
		for (const step of TOUR_STEPS) {
			expect(step.titleKey).toMatch(/^tour\./);
			expect(step.bodyKey).toMatch(/^tour\./);
		}
	});

	it('stays short; sky had to cut its tour from 22 steps to 6', () => {
		expect(TOUR_STEPS.length).toBeLessThanOrEqual(6);
	});
});

describe('parseTour', () => {
	it('defaults an absent value', () => {
		expect(parseTour(null)).toEqual(TOUR_DEFAULTS);
		expect(parseTour(undefined)).toEqual(TOUR_DEFAULTS);
	});

	it('defaults a corrupt value rather than throwing', () => {
		expect(parseTour('nonsense')).toEqual(TOUR_DEFAULTS);
		expect(parseTour(42)).toEqual(TOUR_DEFAULTS);
		expect(parseTour([])).toEqual({ completedVersion: 0, step: 0 });
	});

	it('keeps a stored position so a mid-tour close resumes', () => {
		expect(parseTour({ completedVersion: 0, step: 2 }).step).toBe(2);
	});

	it('clamps a step past the end of the tour', () => {
		expect(parseTour({ completedVersion: 0, step: 99 }).step).toBe(TOUR_STEPS.length - 1);
	});

	it('clamps a negative or fractional step', () => {
		expect(parseTour({ completedVersion: 0, step: -3 }).step).toBe(0);
		expect(parseTour({ completedVersion: 0, step: 1.8 }).step).toBe(1);
	});

	it('coerces a nonsense completedVersion to unseen', () => {
		expect(parseTour({ completedVersion: 'yes', step: 0 }).completedVersion).toBe(0);
		expect(parseTour({ completedVersion: -1, step: 0 }).completedVersion).toBe(0);
	});
});

describe('hasSeenTour', () => {
	it('is false for a fresh install', () => {
		expect(hasSeenTour(TOUR_DEFAULTS)).toBe(false);
	});

	it('is true once the current version is finished', () => {
		expect(hasSeenTour({ completedVersion: TOUR_VERSION, step: 0 })).toBe(true);
	});

	/**
	 * Version-gated rather than a boolean, so rewriting the tour can show it again to
	 * someone who already finished the old one.
	 */
	it('is false again when the tour is rewritten past the version they saw', () => {
		expect(hasSeenTour({ completedVersion: 1, step: 0 }, 2)).toBe(false);
	});

	it('stays true for someone ahead of the current version', () => {
		expect(hasSeenTour({ completedVersion: 5, step: 0 }, 2)).toBe(true);
	});
});

/**
 * The write path, not just the arithmetic.
 *
 * This lives here rather than in e2e because the harness runs two Preferences
 * implementations at once - the mock stub and Capacitor's real web one, which keys
 * localStorage by the configured App Group - and which of them serves a given call is a
 * boot race, so asserting a persisted number through it measures the harness.
 */
describe('useAppTour lifecycle', () => {
	beforeEach(() => {
		store.clear();
		useSettings().cache.clear();
		const { state, ready, active } = useAppTour();
		state.value = { ...TOUR_DEFAULTS };
		ready.value = false;
		active.value = false;
	});

	it('starts on a fresh install', async () => {
		const tour = useAppTour();
		expect(await tour.startIfUnseen()).toBe(true);
		expect(tour.active.value).toBe(true);
	});

	it('does not start twice while it is already open', async () => {
		const tour = useAppTour();
		expect(await tour.startIfUnseen()).toBe(true);
		expect(await tour.startIfUnseen()).toBe(false);
	});

	// skip and done both land in finish(), so a half-seen tour must not nag either
	it('finishing writes the current version through to storage', async () => {
		const tour = useAppTour();
		await tour.startIfUnseen();
		await tour.finish();

		expect(tour.active.value).toBe(false);
		expect(JSON.parse(store.get(TOUR_KEY)!)).toEqual({
			completedVersion: TOUR_VERSION,
			step: 0
		});
	});

	it('stays closed on the next launch once finished', async () => {
		const first = useAppTour();
		await first.startIfUnseen();
		await first.finish();

		// a relaunch: in-memory state gone, storage intact
		useSettings().cache.clear();
		const { state, ready, active } = useAppTour();
		state.value = { ...TOUR_DEFAULTS };
		ready.value = false;
		active.value = false;

		expect(await useAppTour().startIfUnseen()).toBe(false);
		expect(useAppTour().active.value).toBe(false);
	});

	/**
	 * `startIfUnseen` reads through to storage instead of trusting `state`, because
	 * `load()`'s `ready` guard makes an early caller's result stick - and showing the tour
	 * again to someone who finished it is the one failure worth ruling out.
	 */
	it('reads through a stale ready flag rather than trusting cached state', async () => {
		store.set(TOUR_KEY, JSON.stringify({ completedVersion: TOUR_VERSION, step: 0 }));

		const tour = useAppTour();
		tour.ready.value = true;
		tour.state.value = { ...TOUR_DEFAULTS };

		expect(await tour.startIfUnseen()).toBe(false);
	});

	it('replay clears the completion so the tour can run again', async () => {
		const tour = useAppTour();
		await tour.startIfUnseen();
		await tour.finish();
		await tour.replay();

		expect(tour.active.value).toBe(true);
		expect(JSON.parse(store.get(TOUR_KEY)!).completedVersion).toBe(0);
	});

	it('walking to the last step and past it finishes', async () => {
		const tour = useAppTour();
		await tour.startIfUnseen();

		for (let index = 1; index < TOUR_STEPS.length; index++) {
			await tour.next();
			expect(tour.step.value).toBe(index);
		}

		await tour.next();
		expect(tour.active.value).toBe(false);
		expect(JSON.parse(store.get(TOUR_KEY)!).completedVersion).toBe(TOUR_VERSION);
	});

	it('back stops at the first step instead of going negative', async () => {
		const tour = useAppTour();
		await tour.startIfUnseen();
		await tour.back();
		expect(tour.step.value).toBe(0);
	});
});
