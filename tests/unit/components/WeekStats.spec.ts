import { mountSuspended } from '@nuxt/test-utils/runtime';
import { afterEach, describe, expect, it } from 'vitest';
import WeekStats from '~/components/week/Stats.vue';
import { summarizeWeek } from '~/composables/useWeek';
import type { LedgerEntry, StreakDay } from '~/types/context';
import { entry } from '../helpers';

/**
 * The week's three numbers, its points pill, and the streak row above them.
 *
 * This is the only surface that puts a week's totals in front of the user, so the numbers are the
 * contract: which value lands in which slot, and that a week with nothing in it renders real zeros
 * rather than a blank card or arithmetic on `undefined`. The other half is tone - a quiet day is
 * counted, never marked as a failure.
 *
 * The summaries are built by the real `summarizeWeek`, so a change to what a week means fails here
 * rather than drifting past a hand-written literal.
 */

const WEEK = '2026-W31';

type StatsProps = InstanceType<typeof WeekStats>['$props'];
type Wrapper = Awaited<ReturnType<typeof mountSuspended<typeof WeekStats>>>;

let mounted: Wrapper | null = null;

function week(entries: LedgerEntry[] = []) {
	return summarizeWeek(WEEK, entries);
}

async function stats(props: Partial<StatsProps> = {}) {
	mounted = await mountSuspended(WeekStats, {
		props: { summary: props.summary ?? week(), ...props }
	});
	return mounted;
}

/** the three stat cells, each as "<value><label>", in the order they render */
const cells = (w: Wrapper) => w.findAll('.grid > div').map((cell) => cell.text());

/** the trailing week, oldest first; july 2026 starts on a wednesday */
function days(...states: StreakDay['state'][]): StreakDay[] {
	return states.map((state, index) => ({
		day: `2026-07-${String(20 + index).padStart(2, '0')}`,
		state
	}));
}

afterEach(() => {
	mounted?.unmount();
	mounted = null;
});

describe('the three numbers', () => {
	it('pairs each value with its own label, in order', async () => {
		const w = await stats({
			summary: week([
				entry({ id: 'a', category: 'nature', duration_minutes: 10 }),
				entry({ id: 'b', category: 'art', duration_minutes: 15 }),
				entry({ id: 'c', category: 'art' })
			])
		});
		expect(cells(w), 'a value landed in the wrong slot').toEqual([
			'3Nudges',
			'2Categories',
			'25Minutes'
		]);
	});

	it('counts distinct categories rather than entries', async () => {
		const w = await stats({
			summary: week([
				entry({ id: 'a', category: 'home' }),
				entry({ id: 'b', category: 'home' }),
				entry({ id: 'c', category: 'home' })
			])
		});
		expect(cells(w)[1]).toBe('1Categories');
	});

	it('sums only the minutes that were actually declared', async () => {
		const w = await stats({
			summary: week([entry({ id: 'a', duration_minutes: 12 }), entry({ id: 'b' })])
		});
		expect(cells(w)[2], 'an absent duration was added as something').toBe('12Minutes');
	});

	it('renders three zeros for a week with nothing in it', async () => {
		const w = await stats();
		expect(cells(w), 'an empty week rendered a bare card with no numbers').toEqual([
			'0Nudges',
			'0Categories',
			'0Minutes'
		]);
	});

	/**
	 * The failure this guards is arithmetic reaching the dom: a missing duration summed into `NaN`,
	 * or a divide that lands on `Infinity`. There is no server to correct it and no way for the user
	 * to tell it from a real total.
	 */
	it('never puts a NaN, an Infinity or an undefined in front of the user', async () => {
		for (const summary of [week(), week([entry({ id: 'a' })])]) {
			const w = await stats({ summary });
			expect(w.text(), `${summary.resolved} resolved rendered a non-number`).not.toMatch(
				/NaN|Infinity|undefined|null/
			);
			w.unmount();
		}
	});

	// a skip is not a completion, so it moves no number; it is also not punished
	it('leaves a skipped nudge out of every total', async () => {
		const w = await stats({
			summary: week([entry({ id: 'a', outcome: 'skipped', points: 10, duration_minutes: 30 })])
		});
		expect(cells(w)).toEqual(['0Nudges', '0Categories', '0Minutes']);
		expect(w.text()).toContain('0 Points');
	});
});

describe('the points pill', () => {
	it('states the points the week actually banked', async () => {
		const w = await stats({
			summary: week([entry({ id: 'a', points: 5 }), entry({ id: 'b', points: 7 })])
		});
		expect(w.text()).toContain('12 Points');
	});

	it('says zero rather than nothing for an empty week', async () => {
		const w = await stats();
		expect(w.text()).toContain('0 Points');
	});
});

describe('the streak row', () => {
	// a past week has no live streak, so the strip is absent rather than empty
	it('is absent entirely when no days are handed to it', async () => {
		const w = await stats();
		expect(w.find('.sr-only').exists(), 'a past week rendered a streak strip').toBe(false);
	});

	it('renders the trailing week when the days are handed to it', async () => {
		const w = await stats({ days: days('filled', 'filled', 'filled') });
		expect(w.find('.sr-only').text()).toContain('3 days done');
	});

	/**
	 * A half-filled week is the normal case, not a failure. The strip counts the quiet days and
	 * says nothing about them beyond that - there is no missed-day language anywhere in the app.
	 */
	it('calls a day with nothing in it quiet, not missed', async () => {
		const w = await stats({
			summary: week([entry({ id: 'a' }), entry({ id: 'b' }), entry({ id: 'c' })]),
			days: days('filled', 'empty', 'filled', 'empty', 'filled', 'empty', 'empty')
		});
		const summary = w.find('.sr-only').text();
		expect(summary).toContain('3 days done');
		expect(summary).toContain('4 quiet days');
		expect(w.text(), 'a quiet day was framed as a failure').not.toMatch(
			/miss(ed)?|fail(ed)?|lost|broke/i
		);
	});
});

/**
 * The note is the personal-best framing the page computes; the hint is the gap to it. Both arrive
 * as plain strings, so what is testable here is that they render as given and stay tied together.
 *
 * `fresh` is deliberately unasserted: it applies `color-mix(...)`, which happy-dom's style parser
 * drops, so the fresh and plain rows are byte-identical in this environment. That colour belongs to
 * tests/e2e/theme.spec.ts, the same split StreakStrip's translucent fill takes.
 */
describe('the personal-best note', () => {
	it('renders the note and its hint side by side', async () => {
		const w = await stats({
			days: days('filled'),
			note: 'Your Longest Yet',
			noteHint: '2 to Beat your Best'
		});
		expect(w.text()).toContain('Your Longest Yet');
		expect(w.text()).toContain('2 to Beat your Best');
	});

	// the framing is self-referential by construction: whatever it is handed is all that renders
	it('adds no rank or comparison of its own around the note', async () => {
		const w = await stats({ days: days('filled'), note: 'Your Longest Yet' });
		expect(w.find('.flex-wrap').text()).toBe('Your Longest Yet');
	});

	it('drops an orphaned hint rather than showing it alone', async () => {
		const w = await stats({ days: days('filled'), noteHint: '2 to Beat your Best' });
		expect(w.text(), 'a hint rendered with no note to hang it on').not.toContain('to Beat');
	});

	it('renders no note row at all for a past week', async () => {
		const w = await stats({ note: 'Your Longest Yet' });
		expect(w.text(), 'the note needs the streak row, which a past week has not got').not.toContain(
			'Your Longest Yet'
		);
	});
});
