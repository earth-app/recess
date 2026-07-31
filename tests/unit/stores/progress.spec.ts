import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LedgerEntry, NudgeOutcome } from '~/types/context';
import { NUDGE_CATEGORIES } from '~/types/nudge';

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

import { summarizeWeek, weeksWithActivity } from '~/composables/useWeek';
import {
	MAX_LEDGER_ENTRIES,
	parseSnapshot,
	PROGRESS_KEY,
	useProgressStore
} from '~/stores/progress';
import { dayKey, isoWeekKey } from '~/utils/day';
import { streakFrom } from '~/utils/streak';
import { entry, task, think } from '../helpers';

/** a raw stored entry, so a case can be as malformed as storage allows */
function raw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id: 'nature.think.example',
		category: 'nature',
		type: 'think',
		outcome: 'passed',
		points: 5,
		at: Date.UTC(2026, 6, 27, 12),
		day: '2026-07-27',
		...overrides
	};
}

function stored(entries: unknown[], rest: Record<string, unknown> = {}) {
	return { entries, points: 0, bests: {}, ...rest };
}

function seed(key: string, value: unknown) {
	store.set(key, JSON.stringify(value));
}

/** local noon on a given calendar day, so the assertions do not depend on the tz */
function noon(year: number, month: number, day: number): Date {
	return new Date(year, month - 1, day, 12);
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
 * The ledger is the only copy of the user's history and there is no server to
 * repair it, so the parser has to tolerate a partly corrupt blob without either
 * losing the good entries or admitting a bad one. Everything downstream - points,
 * the week summary, the streak, the Playground - is derived from what it returns.
 */
describe('parseSnapshot', () => {
	it('returns an empty snapshot for anything that is not a record', () => {
		for (const bad of [null, undefined, 'not json at all', 42, true]) {
			expect(parseSnapshot(bad), String(bad)).toEqual({ entries: [], points: 0, bests: {} });
		}
	});

	it('survives entries that is not an array', () => {
		expect(parseSnapshot({ entries: 'nope', points: 99 }).entries).toEqual([]);
	});

	it('keeps a well-formed ledger, oldest first', () => {
		const snapshot = parseSnapshot(
			stored([
				raw({ id: 'b', at: 3000, day: '2026-07-27' }),
				raw({ id: 'a', at: 1000, day: '2026-07-26' })
			])
		);

		expect(snapshot.entries.map((item) => item.id)).toEqual(['a', 'b']);
	});

	it('recomputes points from the ledger rather than trusting the stored total', () => {
		const snapshot = parseSnapshot(
			stored([raw({ points: 5 }), raw({ id: 'other', points: 10 })], { points: 9999 })
		);

		expect(snapshot.points).toBe(15);
	});

	it('accepts every declared category', () => {
		const snapshot = parseSnapshot(
			stored(NUDGE_CATEGORIES.map((category, index) => raw({ id: `n${index}`, category })))
		);

		expect(snapshot.entries.length).toBe(NUDGE_CATEGORIES.length);
	});

	it('drops an entry whose category is not a real category', () => {
		const snapshot = parseSnapshot(
			stored([raw(), raw({ id: 'spaceships.think.x', category: 'spaceships' })])
		);

		expect(snapshot.entries.map((item) => item.category)).toEqual(['nature']);
	});

	it('accepts all four outcomes, including a zero-point skip', () => {
		const outcomes: NudgeOutcome[] = ['passed', 'self_attested', 'answered', 'skipped'];
		const snapshot = parseSnapshot(
			stored(
				outcomes.map((outcome, index) =>
					raw({ id: `n${index}`, outcome, points: outcome === 'skipped' ? 0 : 5 })
				)
			)
		);

		expect(snapshot.entries.map((item) => item.outcome)).toEqual(outcomes);
		expect(snapshot.points).toBe(15);
	});

	it('drops an entry whose outcome is not a real outcome', () => {
		const snapshot = parseSnapshot(stored([raw(), raw({ id: 'x', outcome: 'cheated' })]));
		expect(snapshot.entries.map((item) => item.id)).toEqual(['nature.think.example']);
	});

	it('does not accept an outcome that only exists on Object.prototype', () => {
		expect(parseSnapshot(stored([raw({ outcome: 'toString' })])).entries).toEqual([]);
		expect(parseSnapshot(stored([raw({ outcome: 'constructor' })])).entries).toEqual([]);
	});

	it('requires an id', () => {
		expect(parseSnapshot(stored([raw({ id: undefined }), raw({ id: 42 })])).entries).toEqual([]);
	});

	/**
	 * `isoWeekKey(new Date(Number.NaN))` returns the string `NaN-WNaN`, which then
	 * renders as a week label in the Week tab's past-weeks list.
	 */
	it('drops a NaN timestamp, which would otherwise label a week NaN-WNaN', () => {
		const snapshot = parseSnapshot(stored([raw(), raw({ id: 'x', at: Number.NaN })]));

		expect(snapshot.entries.length).toBe(1);
		expect(isoWeekKey(new Date(Number.NaN))).toBe('NaN-WNaN');
		expect(weeksWithActivity(snapshot.entries)).not.toContain('NaN-WNaN');
	});

	it('drops NaN points, which the week summary adds straight into its total', () => {
		const snapshot = parseSnapshot(
			stored([raw({ points: 5 }), raw({ id: 'x', points: Number.NaN })])
		);

		expect(snapshot.points).toBe(5);
		expect(summarizeWeek('2026-W31', snapshot.entries).points).toBe(5);
	});

	it('drops Infinity as well as NaN', () => {
		expect(
			parseSnapshot(
				stored([
					raw({ id: 'a', at: Number.POSITIVE_INFINITY }),
					raw({ id: 'b', points: Number.NEGATIVE_INFINITY })
				])
			).entries
		).toEqual([]);
	});

	it('does not mistake a numeric string for a number', () => {
		expect(parseSnapshot(stored([raw({ at: '1000' }), raw({ points: '5' })])).entries).toEqual([]);
	});

	/**
	 * `streak.ts` sorts the ledger's `day` values and measures gaps with
	 * `daysBetween`, which returns 0 for an unparseable key - so one malformed day
	 * sorted into the middle of a run restarts the count and shortens the longest
	 * streak the user is shown.
	 */
	it('drops a malformed day key, which would truncate the recorded longest streak', () => {
		const clean = Array.from({ length: 10 }, (_, index) =>
			raw({ id: `n${index}`, day: `2026-07-${String(index + 1).padStart(2, '0')}`, at: index + 1 })
		);
		// an iso timestamp where a day key belongs; it sorts into the middle of the run,
		// and `daysBetween` reads the gap on either side of it as 0, restarting the count
		const corrupt = raw({ id: 'x', day: '2026-07-05T00:00:00Z' });

		const snapshot = parseSnapshot(stored([...clean, corrupt]));
		expect(streakFrom(snapshot.entries, noon(2026, 7, 24)).longest).toBe(10);
		expect(snapshot.entries.length).toBe(clean.length);
	});

	it('rejects every near-miss day format', () => {
		for (const day of [
			'2026-7-4',
			'26-07-04',
			'2026-07-04T00:00:00Z',
			'yesterday',
			'',
			'20260704'
		]) {
			expect(parseSnapshot(stored([raw({ day })])).entries, day).toEqual([]);
		}
	});

	it('keeps only finite bests', () => {
		const snapshot = parseSnapshot(
			stored([], { bests: { streak: 7, 'category:nature': Number.NaN, junk: 'nope' } })
		);

		expect(snapshot.bests).toEqual({ streak: 7 });
	});

	it('ignores a bests map that is not an object', () => {
		expect(parseSnapshot(stored([], { bests: 'nope' })).bests).toEqual({});
	});
});

describe('useProgressStore.load', () => {
	it('keeps the good entries out of a partly corrupt blob', async () => {
		seed(
			PROGRESS_KEY,
			stored([raw({ id: 'a', points: 5 }), 'garbage', null, raw({ id: 'b', at: Number.NaN })], {
				bests: { streak: 4 }
			})
		);

		const progress = useProgressStore();
		await progress.load();

		expect(progress.entries.map((item) => item.id)).toEqual(['a']);
		expect(progress.points).toBe(5);
		expect(progress.bests).toEqual({ streak: 4 });
		expect(progress.ready).toBe(true);
	});

	it('starts empty when the blob is not json at all', async () => {
		store.set(PROGRESS_KEY, 'not json at all');

		const progress = useProgressStore();
		await progress.load();

		expect(progress.entries).toEqual([]);
		expect(progress.points).toBe(0);
	});

	it('reads storage once', async () => {
		const progress = useProgressStore();
		await progress.load();
		const calls = prefsGet.mock.calls.length;

		await progress.load();
		expect(prefsGet.mock.calls.length).toBe(calls);
	});
});

describe('useProgressStore.record', () => {
	/** whatever `record` writes has to survive its own parser, or a relaunch loses it */
	it('writes an entry its own parser keeps', async () => {
		const progress = useProgressStore();
		await progress.record({ nudge: think(), outcome: 'passed', points: 5 });

		const reparsed = parseSnapshot(JSON.parse(String(store.get(PROGRESS_KEY))));
		expect(reparsed.entries.map((item) => item.id)).toEqual(['nature.think.example']);
		expect(reparsed.points).toBe(5);
	});

	it('carries the validation type and duration of a nudge that has them', async () => {
		const progress = useProgressStore();
		const recorded = await progress.record({
			nudge: task({ duration_minutes: 20 }),
			outcome: 'self_attested',
			points: 10,
			score: 0.82
		});

		expect(recorded.validation_type).toBe('confirm');
		expect(recorded.duration_minutes).toBe(20);
		expect(recorded.score).toBe(0.82);
	});

	it('takes the day and the timestamp from an explicit now', async () => {
		const now = noon(2026, 7, 4);
		const progress = useProgressStore();
		const recorded = await progress.record({
			nudge: think(),
			outcome: 'passed',
			points: 5,
			now
		});

		expect(recorded.at).toBe(now.getTime());
		expect(recorded.day).toBe('2026-07-04');
		expect(parseSnapshot(JSON.parse(String(store.get(PROGRESS_KEY)))).entries.length).toBe(1);
	});

	it('marks the nudge resolved today and keeps its completion timestamp', async () => {
		const progress = useProgressStore();
		const recorded = await progress.record({ nudge: think(), outcome: 'passed', points: 5 });

		expect(progress.resolvedToday.map((item) => item.id)).toEqual(['nature.think.example']);
		expect(progress.skippedToday).toEqual([]);
		expect(progress.completions['nature.think.example']).toBe(recorded.at);
	});

	it('scores a skip at zero and keeps it out of the completions map', async () => {
		const progress = useProgressStore();
		await progress.record({ nudge: think(), outcome: 'skipped', points: 5 });

		expect(progress.points).toBe(0);
		expect(progress.completions).toEqual({});
		expect(progress.skippedToday.length).toBe(1);
	});

	it('rounds and floors the points it is handed', async () => {
		const progress = useProgressStore();
		await progress.record({ nudge: think(), outcome: 'passed', points: 4.6 });
		await progress.record({
			nudge: think({ id: 'nature.think.b' }),
			outcome: 'passed',
			points: -3
		});

		expect(progress.entries.map((item) => item.points)).toEqual([5, 0]);
	});

	it('caps the ledger and drops the oldest entries', async () => {
		const progress = useProgressStore();
		progress.ready = true;
		progress.entries = Array.from({ length: MAX_LEDGER_ENTRIES }, (_, index) =>
			entry({ id: `n${index}`, at: index + 1 })
		);

		await progress.record({
			nudge: think({ id: 'nature.think.newest' }),
			outcome: 'passed',
			points: 1
		});

		expect(progress.entries.length).toBe(MAX_LEDGER_ENTRIES);
		expect(progress.entries[0]?.id).toBe('n1');
		expect(progress.entries.at(-1)?.id).toBe('nature.think.newest');
	});

	it('records a per-category best from the ledger, not from a written number', async () => {
		const progress = useProgressStore();
		await progress.record({ nudge: think(), outcome: 'passed', points: 5 });

		expect(progress.bests['category:nature']).toBe(1);
		expect(progress.bests.streak).toBeGreaterThanOrEqual(1);
	});
});

describe('useProgressStore edits', () => {
	async function withToday(): Promise<ReturnType<typeof useProgressStore>> {
		const today = dayKey();
		seed(
			PROGRESS_KEY,
			stored([
				raw({ id: 'a', day: today, at: Date.now() - 1000 }),
				raw({ id: 'a', day: today, at: Date.now() }),
				raw({ id: 'b', day: '2026-01-01', at: Date.UTC(2026, 0, 1, 12) })
			])
		);

		const progress = useProgressStore();
		await progress.load();
		return progress;
	}

	it('undoes only the most recent entry for a nudge today', async () => {
		const progress = await withToday();

		expect(await progress.undoToday('a')).toBe(true);
		expect(progress.entries.filter((item) => item.id === 'a').length).toBe(1);
		expect(await progress.undoToday('missing')).toBe(false);
	});

	it('resets today without touching history', async () => {
		const progress = await withToday();
		await progress.resetToday();

		expect(progress.entries.map((item) => item.id)).toEqual(['b']);
	});

	it('wipes everything, including bests', async () => {
		const progress = await withToday();
		progress.bests = { streak: 9 };
		await progress.wipe();

		expect(progress.entries).toEqual([]);
		expect(progress.bests).toEqual({});
		expect(JSON.parse(String(store.get(PROGRESS_KEY))).entries).toEqual([]);
	});

	it('groups entries into their iso week', async () => {
		const progress = await withToday();
		const week = isoWeekKey(new Date());

		expect(progress.entriesForWeek(week).map((item) => item.id)).toEqual(['a', 'a']);
	});

	it('only counts a new high as a best', () => {
		const progress = useProgressStore();

		expect(progress.recordBest('streak', 3)).toBe(true);
		expect(progress.recordBest('streak', 2)).toBe(false);
		expect(progress.recordBest('streak', 3)).toBe(false);
		expect(progress.bests.streak).toBe(3);
	});

	it('exports a blob its own parser can read back', async () => {
		const progress = await withToday();
		const exported = JSON.parse(progress.exportJson()) as { entries: LedgerEntry[] };

		expect(parseSnapshot(exported).entries.length).toBe(3);
	});
});
