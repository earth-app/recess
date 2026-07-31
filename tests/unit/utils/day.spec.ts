import { describe, expect, it } from 'vitest';
import {
	addDays,
	dayKey,
	daysBetween,
	hashString,
	isoWeekKey,
	isWeekend,
	moonAgeFraction,
	moonIllumination,
	moonPhaseFor,
	seasonFor,
	seededRandom,
	seededShuffle,
	timeOfDayFor,
	weekdayTokenFor,
	weekWindow,
	weightedSample
} from '~/utils/day';

describe('dayKey', () => {
	/** the local calendar date of a Date, computed independently of the subject */
	function localDate(date: Date): string {
		return [
			date.getFullYear(),
			String(date.getMonth() + 1).padStart(2, '0'),
			String(date.getDate()).padStart(2, '0')
		].join('-');
	}

	it('is the local calendar date', () => {
		const now = new Date('2026-07-27T14:30:00Z');
		expect(dayKey(now)).toBe(localDate(now));
	});

	/**
	 * The bug this replaced: `toISOString()` gave a UTC bucket while `hour`,
	 * `timeOfDayFor` and the notification times are all local, so an evening resolve
	 * west of UTC landed on tomorrow.
	 */
	it('rolls over at local midnight, not utc midnight', () => {
		const beforeMidnight = new Date(2026, 6, 27, 23, 59, 59);
		const afterMidnight = new Date(2026, 6, 28, 0, 0, 0);

		expect(dayKey(beforeMidnight)).toBe('2026-07-27');
		expect(dayKey(afterMidnight)).toBe('2026-07-28');
	});

	it('keeps a late evening on the day the user is actually living', () => {
		// 20:00 in US Central is already tomorrow in UTC
		const evening = new Date(2026, 6, 27, 20, 0, 0);
		expect(dayKey(evening)).toBe('2026-07-27');
	});

	it('is stable across a dst boundary', () => {
		// us dst ends 2026-11-01; the key must not skip or repeat
		expect(dayKey(new Date(2026, 10, 1, 12, 0, 0))).toBe('2026-11-01');
		expect(dayKey(new Date(2026, 10, 2, 12, 0, 0))).toBe('2026-11-02');
	});

	it('pads single-digit months and days', () => {
		expect(dayKey(new Date(2026, 0, 5, 12, 0, 0))).toBe('2026-01-05');
	});
});

describe('isoWeekKey', () => {
	it('uses iso-8601 monday-start weeks', () => {
		// 2026-01-01 is a thursday, so it belongs to week 01 of 2026
		expect(isoWeekKey(new Date('2026-01-01T12:00:00Z'))).toBe('2026-W01');
	});

	it('keeps a monday and the following sunday in the same week', () => {
		const monday = isoWeekKey(new Date(2026, 6, 27, 0, 0, 0));
		const sunday = isoWeekKey(new Date(2026, 7, 2, 23, 0, 0));
		expect(monday).toBe(sunday);
	});

	it('advances on the next monday', () => {
		expect(isoWeekKey(new Date(2026, 7, 3, 0, 0, 0))).not.toBe(
			isoWeekKey(new Date(2026, 7, 2, 0, 0, 0))
		);
	});

	/**
	 * The week has to contain exactly the seven local day keys it labels; reading UTC
	 * components while `dayKey` reads local ones puts a Sunday evening west of UTC into
	 * the following week.
	 */
	it('agrees with the local day keys it spans', () => {
		const sundayEvening = new Date(2026, 7, 2, 21, 0, 0);
		expect(dayKey(sundayEvening)).toBe('2026-08-02');
		expect(isoWeekKey(sundayEvening)).toBe(isoWeekKey(new Date(2026, 6, 27, 12, 0, 0)));

		const mondayMorning = new Date(2026, 7, 3, 1, 0, 0);
		expect(isoWeekKey(mondayMorning)).not.toBe(isoWeekKey(sundayEvening));
	});

	it('pads single-digit weeks', () => {
		expect(isoWeekKey(new Date('2026-03-02T00:00:00Z'))).toMatch(/^\d{4}-W\d{2}$/);
	});
});

describe('daysBetween', () => {
	it('counts whole days forward', () => {
		expect(daysBetween('2026-07-20', '2026-07-27')).toBe(7);
	});

	it('is negative when the target precedes the source', () => {
		expect(daysBetween('2026-07-27', '2026-07-20')).toBe(-7);
	});

	it('spans a month boundary', () => {
		expect(daysBetween('2026-07-31', '2026-08-01')).toBe(1);
	});

	it('spans a leap day', () => {
		expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2);
	});

	it('returns 0 for unparseable keys rather than NaN', () => {
		expect(daysBetween('nonsense', '2026-07-27')).toBe(0);
	});
});

describe('addDays and weekWindow', () => {
	it('moves backwards with a negative count', () => {
		expect(dayKey(addDays(new Date(2026, 6, 27, 12, 0, 0), -1))).toBe('2026-07-26');
	});

	it('crosses a month boundary', () => {
		expect(dayKey(addDays(new Date(2026, 6, 1, 12, 0, 0), -1))).toBe('2026-06-30');
		expect(dayKey(addDays(new Date(2026, 11, 31, 12, 0, 0), 1))).toBe('2027-01-01');
	});

	/**
	 * A fixed 86_400_000ms step shifts the wall clock by an hour across a DST
	 * transition, which repeats or skips a local day key near midnight.
	 */
	it('steps one calendar day across a dst transition, not 24 hours', () => {
		const beforeSpringForward = new Date(2026, 2, 7, 0, 30, 0);
		expect(dayKey(addDays(beforeSpringForward, 1))).toBe('2026-03-08');
		expect(dayKey(addDays(beforeSpringForward, 2))).toBe('2026-03-09');

		const beforeFallBack = new Date(2026, 9, 31, 0, 30, 0);
		expect(dayKey(addDays(beforeFallBack, 1))).toBe('2026-11-01');
		expect(dayKey(addDays(beforeFallBack, 2))).toBe('2026-11-02');
	});

	it('returns 7 ascending day keys ending today', () => {
		const window = weekWindow(new Date(2026, 6, 27, 12, 0, 0));
		expect(window).toHaveLength(7);
		expect(window[6]).toBe('2026-07-27');
		expect(window[0]).toBe('2026-07-21');
		expect([...window].sort()).toEqual(window);
	});
});

describe('hashString', () => {
	it('is stable for the same input', () => {
		expect(hashString('2026-07-27:en')).toBe(hashString('2026-07-27:en'));
	});

	it('separates near-identical inputs', () => {
		expect(hashString('2026-07-27')).not.toBe(hashString('2026-07-28'));
	});

	it('is always a non-negative integer', () => {
		for (const input of ['', 'a', 'nature.think.first_bird', 'éè']) {
			const hash = hashString(input);
			expect(Number.isInteger(hash)).toBe(true);
			expect(hash).toBeGreaterThanOrEqual(0);
		}
	});
});

describe('seededRandom', () => {
	it('reproduces the same sequence for the same seed', () => {
		const a = seededRandom(1234);
		const b = seededRandom(1234);
		expect([a(), a(), a()]).toEqual([b(), b(), b()]);
	});

	it('diverges for different seeds', () => {
		expect(seededRandom(1)()).not.toBe(seededRandom(2)());
	});

	it('stays inside [0, 1)', () => {
		const rng = seededRandom(99);
		for (let i = 0; i < 200; i++) {
			const value = rng();
			expect(value).toBeGreaterThanOrEqual(0);
			expect(value).toBeLessThan(1);
		}
	});
});

describe('seededShuffle', () => {
	it('keeps every element', () => {
		const input = [1, 2, 3, 4, 5];
		const shuffled = seededShuffle(input, seededRandom(7));
		expect([...shuffled].sort()).toEqual(input);
	});

	it('does not mutate the input', () => {
		const input = [1, 2, 3];
		seededShuffle(input, seededRandom(7));
		expect(input).toEqual([1, 2, 3]);
	});

	it('is reproducible for a given seed', () => {
		expect(seededShuffle([1, 2, 3, 4, 5], seededRandom(11))).toEqual(
			seededShuffle([1, 2, 3, 4, 5], seededRandom(11))
		);
	});

	it('handles empty and single-element inputs', () => {
		expect(seededShuffle([], seededRandom(1))).toEqual([]);
		expect(seededShuffle(['only'], seededRandom(1))).toEqual(['only']);
	});
});

describe('weightedSample', () => {
	it('draws without replacement', () => {
		const picked = weightedSample(['a', 'b', 'c'], () => 1, 3, seededRandom(3));
		expect([...picked].sort()).toEqual(['a', 'b', 'c']);
	});

	it('never returns more than the pool holds', () => {
		expect(weightedSample(['a'], () => 1, 5, seededRandom(3))).toEqual(['a']);
	});

	it('returns nothing from an empty pool', () => {
		expect(weightedSample([], () => 1, 2, seededRandom(3))).toEqual([]);
	});

	it('favours heavier items over many draws', () => {
		let heavy = 0;
		for (let seed = 0; seed < 200; seed++) {
			const [first] = weightedSample(
				['light', 'heavy'],
				(item) => (item === 'heavy' ? 40 : 1),
				1,
				seededRandom(seed)
			);
			if (first === 'heavy') heavy++;
		}
		expect(heavy).toBeGreaterThan(150);
	});

	it('can still pick a zero-weight item so nothing is unreachable', () => {
		const picked = weightedSample(
			['zero', 'other'],
			(i) => (i === 'zero' ? 0 : 1),
			2,
			seededRandom(5)
		);
		expect(picked).toHaveLength(2);
	});
});

describe('timeOfDayFor', () => {
	// buckets are local-clock, so construct local times explicitly
	const at = (hour: number) => {
		const d = new Date(2026, 6, 27, hour, 0, 0);
		return timeOfDayFor(d);
	};

	it('splits the day into four buckets', () => {
		expect(at(3)).toBe('night');
		expect(at(6)).toBe('dawn');
		expect(at(12)).toBe('day');
		expect(at(18)).toBe('dusk');
		expect(at(22)).toBe('night');
	});

	it('uses inclusive lower bounds at each boundary', () => {
		expect(at(5)).toBe('dawn');
		expect(at(8)).toBe('day');
		expect(at(17)).toBe('dusk');
		expect(at(20)).toBe('night');
	});
});

describe('weekdayTokenFor and isWeekend', () => {
	it('is monday-indexed', () => {
		expect(weekdayTokenFor(new Date(2026, 6, 27))).toBe('mon');
		expect(weekdayTokenFor(new Date(2026, 6, 26))).toBe('sun');
		expect(weekdayTokenFor(new Date(2026, 6, 25))).toBe('sat');
	});

	it('treats saturday and sunday as the weekend', () => {
		expect(isWeekend(new Date(2026, 6, 25))).toBe(true);
		expect(isWeekend(new Date(2026, 6, 26))).toBe(true);
		expect(isWeekend(new Date(2026, 6, 27))).toBe(false);
	});
});

describe('seasonFor', () => {
	it('buckets northern months', () => {
		expect(seasonFor(new Date(2026, 0, 15))).toBe('winter');
		expect(seasonFor(new Date(2026, 3, 15))).toBe('spring');
		expect(seasonFor(new Date(2026, 6, 15))).toBe('summer');
		expect(seasonFor(new Date(2026, 9, 15))).toBe('autumn');
		expect(seasonFor(new Date(2026, 11, 15))).toBe('winter');
	});

	it('flips below the equator', () => {
		expect(seasonFor(new Date(2026, 6, 15), -33.9)).toBe('winter');
		expect(seasonFor(new Date(2026, 0, 15), -33.9)).toBe('summer');
	});

	it('treats a zero latitude as northern rather than unknown', () => {
		expect(seasonFor(new Date(2026, 6, 15), 0)).toBe('summer');
	});
});

describe('moon', () => {
	it('reports a fraction inside [0, 1)', () => {
		for (const iso of ['2000-01-06T18:14:00Z', '2026-07-27T00:00:00Z', '1999-01-01T00:00:00Z']) {
			const fraction = moonAgeFraction(new Date(iso));
			expect(fraction).toBeGreaterThanOrEqual(0);
			expect(fraction).toBeLessThan(1);
		}
	});

	it('is new at the epoch', () => {
		expect(moonPhaseFor(new Date('2000-01-06T18:14:00Z'))).toBe('new');
		expect(moonIllumination(new Date('2000-01-06T18:14:00Z'))).toBeCloseTo(0, 3);
	});

	it('is full about half a synodic month later', () => {
		const half = new Date(Date.UTC(2000, 0, 6, 18, 14) + 14.765 * 86_400_000);
		expect(moonPhaseFor(half)).toBe('full');
		expect(moonIllumination(half)).toBeGreaterThan(0.99);
	});

	it('keeps illumination inside [0, 1]', () => {
		for (let day = 0; day < 60; day++) {
			const value = moonIllumination(new Date(Date.UTC(2026, 0, 1) + day * 86_400_000));
			expect(value).toBeGreaterThanOrEqual(0);
			expect(value).toBeLessThanOrEqual(1);
		}
	});

	it('returns a known phase name for every day of a cycle', () => {
		const seen = new Set<string>();
		for (let day = 0; day < 30; day++) {
			seen.add(moonPhaseFor(new Date(Date.UTC(2026, 0, 1) + day * 86_400_000)));
		}
		// a full cycle should visit every one of the eight arcs
		expect(seen.size).toBe(8);
	});
});
