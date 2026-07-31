import { describe, expect, it } from 'vitest';
import type { StreakState } from '~/types/context';
import { dayKey } from '~/utils/day';
import { activeDays, streakFrom, streakLabel, streakLabelKey, streakWeek } from '~/utils/streak';
import { entry, FIXED_NOW } from '../helpers';

/** ledger entries on the given day offsets back from FIXED_NOW */
function onDays(...offsets: number[]) {
	return offsets.map((offset, index) =>
		entry({ id: `nature.think.d${index}`, at: FIXED_NOW.getTime() - offset * 86_400_000 })
	);
}

describe('activeDays', () => {
	it('counts a resolved day once no matter how many nudges', () => {
		const at = FIXED_NOW.getTime();
		const days = activeDays([entry({ at }), entry({ id: 'other', at })]);
		expect(days.size).toBe(1);
	});

	it('ignores skips', () => {
		expect(activeDays([entry({ outcome: 'skipped' })]).size).toBe(0);
	});

	it('counts a self-attested day', () => {
		expect(activeDays([entry({ outcome: 'self_attested' })]).size).toBe(1);
	});
});

describe('streakFrom', () => {
	it('is zero with no history', () => {
		const state = streakFrom([], FIXED_NOW);
		expect(state.current).toBe(0);
		expect(state.longest).toBe(0);
		expect(state.paused).toBe(false);
	});

	it('counts consecutive days', () => {
		expect(streakFrom(onDays(0, 1, 2, 3), FIXED_NOW).current).toBe(4);
	});

	it('does not treat an unfinished today as a miss', () => {
		const state = streakFrom(onDays(1, 2, 3), FIXED_NOW);
		expect(state.current).toBe(3);
		expect(state.paused).toBe(false);
	});

	it('absorbs one missed day with a grace day', () => {
		// active today, yesterday missing, then three more
		const state = streakFrom(onDays(0, 2, 3, 4), FIXED_NOW);
		expect(state.current).toBe(4);
		expect(state.grace_used).toBe(1);
		expect(state.paused).toBe(false);
	});

	it('pauses rather than resetting after a second miss in the window', () => {
		// two gaps inside one 7-day window
		const state = streakFrom(onDays(0, 2, 4), FIXED_NOW);
		expect(state.paused).toBe(true);
		// the run up to the second miss is kept, never zeroed
		expect(state.current).toBeGreaterThan(0);
	});

	it('never returns a negative or zero current after real activity', () => {
		const state = streakFrom(onDays(0), FIXED_NOW);
		expect(state.current).toBe(1);
	});

	it('reports the longest run even when the current one is shorter', () => {
		// a five-day run three weeks ago, one day today
		const old = onDays(20, 21, 22, 23, 24);
		const today = onDays(0);
		const state = streakFrom([...old, ...today], FIXED_NOW);
		expect(state.longest).toBeGreaterThanOrEqual(5);
		expect(state.current).toBe(1);
	});

	it('reports longest as at least the current run', () => {
		const state = streakFrom(onDays(0, 1, 2, 3, 4, 5), FIXED_NOW);
		expect(state.longest).toBeGreaterThanOrEqual(state.current);
	});

	it('is unaffected by a local dst shift because day keys are utc', () => {
		// straddle the 2026-11-01 us dst end
		const base = new Date('2026-11-02T12:00:00Z');
		const entries = [0, 1, 2].map((offset, index) =>
			entry({ id: `d${index}`, at: base.getTime() - offset * 86_400_000 })
		);
		expect(streakFrom(entries, base).current).toBe(3);
	});

	it('handles a long unbroken history without running away', () => {
		const entries = Array.from({ length: 120 }, (_, i) =>
			entry({ id: `d${i}`, at: FIXED_NOW.getTime() - i * 86_400_000 })
		);
		const state = streakFrom(entries, FIXED_NOW);
		expect(state.current).toBe(120);
		expect(state.paused).toBe(false);
	});

	it('ignores skip-only days when walking back', () => {
		const entries = [
			...onDays(0, 1),
			entry({ id: 'skipped', outcome: 'skipped', at: FIXED_NOW.getTime() - 2 * 86_400_000 })
		];
		const state = streakFrom(entries, FIXED_NOW);
		// a skip-only day is outside the active history, not a gap inside it, so the
		// walk stops at the earliest active day and no grace is spent
		expect(state.current).toBe(2);
		expect(state.grace_used).toBe(0);
	});

	it('spends grace on a genuine gap between two active days', () => {
		const entries = [
			...onDays(0, 1),
			entry({ id: 'older', at: FIXED_NOW.getTime() - 3 * 86_400_000 })
		];
		const state = streakFrom(entries, FIXED_NOW);
		expect(state.current).toBe(3);
		expect(state.grace_used).toBe(1);
	});
});

describe('streakWeek', () => {
	it('returns 7 ascending days ending today', () => {
		const week = streakFrom(onDays(0, 1), FIXED_NOW).week;
		expect(week).toHaveLength(7);
		expect(week[6]?.day).toBe(dayKey(FIXED_NOW));
		expect([...week.map((d) => d.day)].sort()).toEqual(week.map((d) => d.day));
	});

	it('marks active days filled and the rest empty', () => {
		const week = streakFrom(onDays(0, 1), FIXED_NOW).week;
		expect(week[6]?.state).toBe('filled');
		expect(week[5]?.state).toBe('filled');
		expect(week[0]?.state).toBe('empty');
	});

	it('marks a covered miss as grace, not empty', () => {
		const week = streakFrom(onDays(0, 2, 3), FIXED_NOW).week;
		const yesterday = week[5];
		expect(yesterday?.state).toBe('grace');
	});

	it('builds directly from a day set', () => {
		const active = new Set([dayKey(FIXED_NOW)]);
		const week = streakWeek(active, FIXED_NOW, new Set());
		expect(week.filter((d) => d.state === 'filled')).toHaveLength(1);
	});
});

describe('streakLabel', () => {
	it('invites a start at zero', () => {
		expect(streakLabel(streakFrom([], FIXED_NOW))).toBe('Start Something Today');
	});

	it('names day one', () => {
		expect(streakLabel(streakFrom(onDays(0), FIXED_NOW))).toBe('Day One');
	});

	it('describes a paused streak as resting, never as lost', () => {
		const label = streakLabel(streakFrom(onDays(0, 2, 4), FIXED_NOW));
		expect(label).toContain('Resting');
		expect(label.toLowerCase()).not.toContain('lost');
		expect(label.toLowerCase()).not.toContain('broke');
	});

	it('celebrates a personal best self-referentially', () => {
		expect(streakLabel(streakFrom(onDays(0, 1, 2, 3), FIXED_NOW))).toContain('Your Longest Yet');
	});
});

describe('streakLabelKey', () => {
	/**
	 * The App Group snapshot the Watch reads was written in English regardless of
	 * locale. The rules live in the util, the wording in i18n, and these assert the two
	 * cannot drift apart silently.
	 */
	it('names a key for every state the English fallback covers', () => {
		const base = { longest: 9, graceUsed: 0, week: [] } as unknown as StreakState;

		expect(streakLabelKey({ ...base, current: 0, paused: false }).key).toBe('today.streakNone');
		expect(streakLabelKey({ ...base, current: 1, paused: false }).key).toBe('today.streakDayOne');
		expect(streakLabelKey({ ...base, current: 4, paused: false }).key).toBe('today.streakDays');
		expect(streakLabelKey({ ...base, current: 5, paused: true }).key).toBe('today.streakResting');
		expect(streakLabelKey({ ...base, current: 9, longest: 9, paused: false }).key).toBe(
			'today.streakLongest'
		);
	});

	it('carries the count so a pluralised string can use it', () => {
		const state = { current: 6, longest: 9, paused: false } as unknown as StreakState;
		expect(streakLabelKey(state).count).toBe(6);
	});

	it('branches identically to the English fallback', () => {
		const cases = [
			{ current: 0, longest: 0, paused: false },
			{ current: 1, longest: 1, paused: false },
			{ current: 3, longest: 8, paused: false },
			{ current: 4, longest: 4, paused: false },
			{ current: 2, longest: 5, paused: true }
		] as unknown as StreakState[];

		// a mismatch here means the watch and the app would describe the same streak
		// differently, which is exactly the drift the split was meant to prevent
		const KEY_TO_ENGLISH: Record<string, (state: StreakState) => string> = {
			'today.streakNone': () => 'Start Something Today',
			'today.streakDayOne': () => 'Day One',
			'today.streakDays': (state) => `${state.current} Days`,
			'today.streakResting': (state) => `${state.current} Days, Resting`,
			'today.streakLongest': (state) => `${state.current} Days, Your Longest Yet`
		};

		for (const state of cases) {
			const mapped = KEY_TO_ENGLISH[streakLabelKey(state).key];
			expect(mapped).toBeDefined();
			expect(mapped?.(state)).toBe(streakLabel(state));
		}
	});
});
