import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Nudge } from '~/types/nudge';

const store = new Map<string, string>();

const { prefsGet, prefsSet } = vi.hoisted(() => ({
	prefsGet: vi.fn(),
	prefsSet: vi.fn()
}));

vi.mock('@capacitor/preferences', () => ({
	Preferences: {
		configure: vi.fn(async () => {}),
		get: prefsGet,
		set: prefsSet,
		remove: vi.fn(async () => {}),
		clear: vi.fn(async () => {})
	}
}));

import { PICK_KEY, useNudgesStore } from '~/stores/nudges';
import { entry, FIXED_NOW, think } from '../helpers';

// the shared factory, re-keyed so every nudge sits in a different category and the
// picker's per-category cap does not shape these assertions
function nudge(id: string, points = 10): Nudge {
	const [category, , slug] = id.split('.') as [string, string, string];
	return think({ id, slug, category: category as never, points }) as Nudge;
}

const CATALOG = [
	nudge('nature.think.a'),
	nudge('art.think.b'),
	nudge('people.think.c'),
	nudge('home.think.d'),
	nudge('learn.think.e'),
	nudge('cooking.think.f'),
	nudge('exercise.think.g'),
	nudge('errands.think.h', 25)
];

function context(day = '2026-07-27') {
	return {
		now: FIXED_NOW,
		day,
		hour: 9,
		weekday: 1,
		time_of_day: 'day',
		season: 'summer',
		moon_phase: 'full',
		moon_illumination: 1,
		locale: 'en',
		points: 0,
		streak_days: 0,
		completed_today: 0,
		completions: {},
		granted_permissions: [],
		installed_packs: []
	} as unknown as Parameters<ReturnType<typeof useNudgesStore>['ensure']>[0];
}

function seed(key: string, value: unknown) {
	store.set(key, JSON.stringify(value));
}

beforeEach(() => {
	setActivePinia(createPinia());
	store.clear();
	// useSettings' cache is module-scope, which is right for an app session and wrong
	// across tests - a write in one case would otherwise satisfy the next case's read
	useSettings().cache.clear();

	prefsGet.mockImplementation(async ({ key }: { key: string }) => ({
		value: store.get(key) ?? null
	}));
	prefsSet.mockImplementation(async ({ key, value }: { key: string; value: string }) => {
		store.set(key, value);
	});
});

/**
 * The day's set has to survive a relaunch. Re-picking is deterministic given its
 * inputs, but the inputs are not stable through a day - the weather snapshot arrives
 * asynchronously and is then cached - so a second launch scores against a context the
 * first one did not have. Persisting the chosen ids is what makes the promise real.
 */
describe('useNudgesStore.ensure', () => {
	it('persists the day it picked', async () => {
		const nudges = useNudgesStore();
		nudges.catalog = CATALOG;

		await nudges.ensure(context());

		const stored = JSON.parse(String(store.get(PICK_KEY)));
		expect(stored.day).toBe('2026-07-27');
		expect(stored.ids.length).toBeGreaterThan(0);
		expect(nudges.today.map((item) => item.id)).toEqual(stored.ids);
	});

	it('restores the stored set rather than re-picking, even against a changed context', async () => {
		seed(PICK_KEY, {
			day: '2026-07-27',
			ids: ['errands.think.h', 'nature.think.a'],
			bonusId: 'art.think.b'
		});

		const nudges = useNudgesStore();
		nudges.catalog = CATALOG;

		await nudges.ensure(context());

		expect(nudges.today.map((item) => item.id)).toEqual(['errands.think.h', 'nature.think.a']);
		expect(nudges.bonus?.id).toBe('art.think.b');
	});

	it('discards a stored set from another day and rewrites it', async () => {
		seed(PICK_KEY, { day: '2001-01-01', ids: ['errands.think.h'], bonusId: null });

		const nudges = useNudgesStore();
		nudges.catalog = CATALOG;

		await nudges.ensure(context());

		const stored = JSON.parse(String(store.get(PICK_KEY)));
		expect(stored.day).toBe('2026-07-27');
		expect(stored.ids).not.toEqual(['errands.think.h']);
	});

	it('re-picks rather than restoring a partial set, which would silently shrink the day', async () => {
		seed(PICK_KEY, {
			day: '2026-07-27',
			ids: ['nature.think.a', 'gone.think.missing'],
			bonusId: null
		});

		const nudges = useNudgesStore();
		nudges.catalog = CATALOG;

		await nudges.ensure(context());

		expect(nudges.today.length).toBeGreaterThan(1);
		expect(nudges.today.map((item) => item.id)).not.toContain('gone.think.missing');
	});

	/**
	 * `ensure` is called from several places, some of which can land before `load`
	 * finishes. An empty pick used to satisfy the day guard, so the awaited call
	 * short-circuited, the deck stayed blank and nothing was ever persisted.
	 */
	it('is a no-op while the catalog is empty, and does not poison the day guard', async () => {
		const nudges = useNudgesStore();

		await nudges.ensure(context());
		expect(nudges.today).toEqual([]);
		expect(store.has(PICK_KEY)).toBe(false);

		nudges.catalog = CATALOG;
		await nudges.ensure(context());

		expect(nudges.today.length).toBeGreaterThan(0);
		expect(store.has(PICK_KEY)).toBe(true);
	});

	it('does not re-pick twice for the same day', async () => {
		const nudges = useNudgesStore();
		nudges.catalog = CATALOG;

		await nudges.ensure(context());
		const first = nudges.today.map((item) => item.id);

		await nudges.ensure(context());
		expect(nudges.today.map((item) => item.id)).toEqual(first);
	});

	it('picks afresh once the day rolls over', async () => {
		const nudges = useNudgesStore();
		nudges.catalog = CATALOG;

		await nudges.ensure(context('2026-07-27'));
		await nudges.ensure(context('2026-07-28'));

		expect(JSON.parse(String(store.get(PICK_KEY))).day).toBe('2026-07-28');
	});

	it('survives a corrupt stored pick', async () => {
		store.set(PICK_KEY, 'not json at all');

		const nudges = useNudgesStore();
		nudges.catalog = CATALOG;

		await expect(nudges.ensure(context())).resolves.toBeUndefined();
		expect(nudges.today.length).toBeGreaterThan(0);
	});

	it('ignores a stored pick that is not an object', async () => {
		seed(PICK_KEY, 42);

		const nudges = useNudgesStore();
		nudges.catalog = CATALOG;

		await nudges.ensure(context());
		expect(nudges.today.length).toBeGreaterThan(0);
	});

	it('marks resolved ids from the ledger without changing the set', async () => {
		const nudges = useNudgesStore();
		nudges.catalog = CATALOG;
		await nudges.ensure(context());

		const first = nudges.today[0];
		expect(first).toBeDefined();

		const progress = useProgressStore();
		progress.entries = [entry({ id: first!.id, day: '2026-07-27' })];

		expect(nudges.resolvedIds.has(first!.id)).toBe(true);
		expect(nudges.remaining.map((item) => item.id)).not.toContain(first!.id);
	});
});
