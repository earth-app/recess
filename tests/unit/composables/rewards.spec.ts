import { describe, expect, it } from 'vitest';
import { symbolFor } from '~/composables/useLiveActivity';
import {
	NOTIF_BANDS,
	digestId,
	planDigests,
	reminderId,
	slotDate
} from '~/composables/useLocalNotifications';
import { informationalReward, personalBestFraming } from '~/composables/usePersonalBest';
import {
	TYPE_UNLOCKS,
	UNLOCKS,
	lockedTypesAt,
	newlyUnlocked,
	nextUnlock,
	unlockedAt
} from '~/composables/useUnlocks';
import { encodeWeek } from '~/composables/useWatchBridge';
import { MAX_PAST_WEEKS, summarizeWeek, weeksWithActivity } from '~/composables/useWeek';
import {
	fallbackFeedback,
	fallbackReflection,
	feedbackPrompt,
	reflectionPrompt,
	tidyGenerated
} from '~/composables/useWriting';
import { FIXED_NOW, entry, think } from '../helpers';

describe('personalBestFraming', () => {
	it('invites a start when there is no history', () => {
		expect(personalBestFraming(0, 0)).toMatchObject({
			label: 'Just Getting Started',
			isNew: false
		});
	});

	it('celebrates only an actual new high', () => {
		expect(personalBestFraming(5, 3)).toMatchObject({ label: 'Your Longest Yet', isNew: true });
		expect(personalBestFraming(3, 5).isNew).toBe(false);
	});

	it('names a match without claiming a record', () => {
		expect(personalBestFraming(4, 4)).toMatchObject({ label: 'Matching Your Best', toBeat: 0 });
	});

	it('reports how much is left to beat the best', () => {
		expect(personalBestFraming(3, 5)).toMatchObject({ toBeat: 3 });
	});

	it('appends a unit when given one', () => {
		expect(personalBestFraming(2, 7, { unit: 'days' }).label).toBe('Personal Best: 7 days');
	});

	it('never mentions anyone else', () => {
		for (const [current, best] of [
			[0, 0],
			[1, 0],
			[3, 9],
			[9, 9]
		]) {
			const label = personalBestFraming(current as number, best as number).label.toLowerCase();
			for (const banned of ['rank', 'percentile', 'others', 'average', 'top ']) {
				expect(label, `${label} mentions ${banned}`).not.toContain(banned);
			}
		}
	});
});

describe('informationalReward', () => {
	it('frames an unlock as a new capability', () => {
		expect(informationalReward({ unlocks: ['Get Noticing Nudges'] })).toBe(
			'You Can Now Get Noticing Nudges'
		);
	});

	it('frames growth without a transaction', () => {
		expect(informationalReward({ grew: 'Playground' })).toBe('Your Playground Grew');
	});

	it('never says earned, bought or spent', () => {
		for (const input of [{}, { grew: 'Playground' }, { unlocks: ['Do a Thing'] }]) {
			const text = informationalReward(input).toLowerCase();
			for (const banned of ['earn', 'buy', 'bought', 'spend', 'purchase', 'coin']) {
				expect(text).not.toContain(banned);
			}
		}
	});
});

describe('unlocks', () => {
	it('is ordered by ascending point threshold', () => {
		const thresholds = UNLOCKS.map((u) => u.points);
		expect([...thresholds].sort((a, b) => a - b)).toEqual(thresholds);
	});

	it('reveals nothing at zero points', () => {
		expect(unlockedAt(0)).toEqual([]);
	});

	it('reveals an unlock exactly at its threshold', () => {
		const first = UNLOCKS[0]!;
		expect(unlockedAt(first.points - 1)).toEqual([]);
		expect(unlockedAt(first.points).map((u) => u.id)).toContain(first.id);
	});

	it('reports the next unlock and nothing once everything is revealed', () => {
		expect(nextUnlock(0)?.id).toBe(UNLOCKS[0]!.id);
		const last = UNLOCKS[UNLOCKS.length - 1]!;
		expect(nextUnlock(last.points)).toBeNull();
	});

	it('only reports unlocks actually crossed by a points move', () => {
		const first = UNLOCKS[0]!;
		expect(newlyUnlocked(0, first.points).map((u) => u.id)).toEqual([first.id]);
		expect(newlyUnlocked(first.points, first.points + 1)).toEqual([]);
		expect(newlyUnlocked(0, 0)).toEqual([]);
	});

	it('frames every capability as something you can now do, never a purchase', () => {
		for (const unlock of UNLOCKS) {
			expect(unlock.capability.length).toBeGreaterThan(0);
			for (const banned of ['buy', 'purchase', 'unlock for', 'costs']) {
				expect(unlock.capability.toLowerCase()).not.toContain(banned);
			}
		}
	});

	/**
	 * The gate has to be real, not just announced.
	 *
	 * `lockedTypes` was computed and exported and had no consumer anywhere, so `notice` and
	 * `count` nudges were served from zero points and the app then announced "You Can Now Get
	 * Noticing Nudges" at 150 for something the user had had since the first day.
	 */
	it('locks exactly the gated types at zero points', () => {
		expect(lockedTypesAt(0).sort()).toEqual(['count', 'notice']);
	});

	it('releases each gated type at its own threshold, not before', () => {
		for (const [type, threshold] of Object.entries(TYPE_UNLOCKS)) {
			expect(lockedTypesAt(threshold! - 1), `${type} released early`).toContain(type);
			expect(lockedTypesAt(threshold!), `${type} still locked at its threshold`).not.toContain(
				type
			);
		}
	});

	it('locks nothing once every threshold is passed', () => {
		const highest = Math.max(...Object.values(TYPE_UNLOCKS).map((points) => points!));
		expect(lockedTypesAt(highest)).toEqual([]);
	});

	// every gated type must also be announced, and every announcement about a type must gate
	it('keeps the gate and the announcement in step', () => {
		for (const type of Object.keys(TYPE_UNLOCKS)) {
			expect(
				UNLOCKS.map((unlock) => unlock.id),
				`${type} is gated but never announced`
			).toContain(type);
			expect(UNLOCKS.find((unlock) => unlock.id === type)!.points).toBe(
				TYPE_UNLOCKS[type as keyof typeof TYPE_UNLOCKS]
			);
		}
	});
});

describe('summarizeWeek', () => {
	it('is empty for no entries', () => {
		const summary = summarizeWeek('2026-W31', []);
		expect(summary).toMatchObject({ resolved: 0, minutes: 0, points: 0, isEmpty: true });
	});

	it('counts only resolved entries', () => {
		const summary = summarizeWeek('2026-W31', [
			entry({ id: 'a', points: 10 }),
			entry({ id: 'b', outcome: 'skipped', points: 0 })
		]);
		expect(summary.resolved).toBe(1);
		expect(summary.points).toBe(10);
	});

	it('sums durations and ignores entries without one', () => {
		const summary = summarizeWeek('2026-W31', [
			entry({ id: 'a', duration_minutes: 20 }),
			entry({ id: 'b' })
		]);
		expect(summary.minutes).toBe(20);
	});

	it('orders the category mix by count, then alphabetically', () => {
		const summary = summarizeWeek('2026-W31', [
			entry({ id: 'a', category: 'art' }),
			entry({ id: 'b', category: 'nature' }),
			entry({ id: 'c', category: 'nature' })
		]);
		expect(summary.mix[0]).toMatchObject({ category: 'nature', count: 2 });
	});

	it('collects only entries that left something behind', () => {
		const summary = summarizeWeek('2026-W31', [
			entry({ id: 'a', text: 'what I saw' }),
			entry({ id: 'b', count: 4 }),
			entry({ id: 'c', media: 'media/x.jpg' }),
			entry({ id: 'd' })
		]);
		expect(summary.highlights.map((h) => h.id).sort()).toEqual(['a', 'b', 'c']);
	});

	it('orders highlights newest first', () => {
		const summary = summarizeWeek('2026-W31', [
			entry({ id: 'old', text: 'x', at: FIXED_NOW.getTime() - 1000 }),
			entry({ id: 'new', text: 'y', at: FIXED_NOW.getTime() })
		]);
		expect(summary.highlights[0]?.id).toBe('new');
	});
});

describe('weeksWithActivity', () => {
	it('is empty with no entries', () => {
		expect(weeksWithActivity([])).toEqual([]);
	});

	it('ignores skips', () => {
		expect(weeksWithActivity([entry({ outcome: 'skipped' })])).toEqual([]);
	});

	it('returns newest first and caps the archive', () => {
		const entries = Array.from({ length: 30 }, (_, i) =>
			entry({ id: `n${i}`, at: FIXED_NOW.getTime() - i * 7 * 86_400_000 })
		);
		const weeks = weeksWithActivity(entries);
		expect(weeks.length).toBeLessThanOrEqual(MAX_PAST_WEEKS);
		expect([...weeks].sort().reverse()).toEqual(weeks);
	});
});

describe('writing fallbacks', () => {
	it('has a distinct line per category, none of it generic praise', () => {
		const lines = new Set<string>();
		for (const category of [
			'people',
			'adventure',
			'home',
			'learn',
			'cooking',
			'nature',
			'errands',
			'exercise',
			'art'
		] as const) {
			const line = fallbackFeedback(think({ category }));
			lines.add(line);
			for (const banned of ['great job', 'well done', 'amazing', 'awesome', 'congratulations']) {
				expect(line.toLowerCase()).not.toContain(banned);
			}
			expect(line).not.toContain('!');
		}
		expect(lines.size).toBe(9);
	});

	it('describes an empty week without scolding', () => {
		const line = fallbackReflection([]);
		expect(line.length).toBeGreaterThan(0);
		for (const banned of ['should', 'failed', 'missed out', 'try harder']) {
			expect(line.toLowerCase()).not.toContain(banned);
		}
	});

	it('notices a single-day week', () => {
		const entries = [entry({ id: 'a' }), entry({ id: 'b' })];
		expect(fallbackReflection(entries)).toContain('one day');
	});

	it('notices a single-category week', () => {
		const entries = [
			entry({ id: 'a', at: FIXED_NOW.getTime() }),
			entry({ id: 'b', at: FIXED_NOW.getTime() - 86_400_000 })
		];
		expect(fallbackReflection(entries).toLowerCase()).toContain('single-minded');
	});
});

describe('tidyGenerated', () => {
	it('returns null for nothing usable', () => {
		expect(tidyGenerated(null, 100)).toBeNull();
		expect(tidyGenerated('', 100)).toBeNull();
		expect(tidyGenerated('   ', 100)).toBeNull();
	});

	it('strips wrapping quotes and collapses whitespace', () => {
		expect(tidyGenerated('  "a  line   here"  ', 100)).toBe('a line here');
	});

	it('drops a restated instruction preamble', () => {
		expect(tidyGenerated("Sure! Here's a line: the bread was flat", 100)).toBe(
			'the bread was flat'
		);
	});

	it('leaves a short line alone', () => {
		expect(tidyGenerated('short enough', 100)).toBe('short enough');
	});

	it('cuts at a sentence boundary when one fits', () => {
		const raw = 'First sentence here. Second sentence that runs on and on and on for a while.';
		const result = tidyGenerated(raw, 30);
		expect(result).toBe('First sentence here.');
	});

	it('ellipsizes when no boundary fits', () => {
		const result = tidyGenerated('a'.repeat(200), 40);
		expect(result?.endsWith('...')).toBe(true);
		expect(result!.length).toBeLessThanOrEqual(43);
	});
});

describe('writing prompts', () => {
	it('includes the nudge and forbids generic praise', () => {
		const prompt = feedbackPrompt(think({ prompt: 'Watch a bird' }), 'I saw a crow');
		expect(prompt).toContain('Watch a bird');
		expect(prompt).toContain('I saw a crow');
		expect(prompt.toLowerCase()).toContain('no exclamation marks');
		expect(prompt.toLowerCase()).toContain('generic praise');
	});

	it('says so when nothing was written', () => {
		expect(feedbackPrompt(think(), null)).toContain('did not write anything');
	});

	it('summarizes the week without leaking points or streaks into the ask', () => {
		const prompt = reflectionPrompt([entry({ id: 'a' }), entry({ id: 'b' })]);
		expect(prompt).toContain('2 nudges');
		expect(prompt.toLowerCase()).toContain('do not mention points');
	});
});

describe('symbolFor', () => {
	it('maps every category to an SF Symbol, since mdi means nothing natively', () => {
		const symbols = (
			[
				'people',
				'adventure',
				'home',
				'learn',
				'cooking',
				'nature',
				'errands',
				'exercise',
				'art'
			] as const
		).map(symbolFor);
		for (const symbol of symbols) {
			expect(symbol).not.toContain('mdi:');
			expect(symbol.length).toBeGreaterThan(0);
		}
	});

	it('falls back for an unknown category', () => {
		expect(symbolFor('spaceships')).toBe('sparkles');
	});
});

describe('encodeWeek', () => {
	it('encodes one character per day', () => {
		expect(
			encodeWeek([{ state: 'filled' }, { state: 'grace' }, { state: 'empty' }, { state: 'future' }])
		).toBe('fge-');
	});

	it('falls back to empty for an unknown state', () => {
		expect(encodeWeek([{ state: 'nonsense' }])).toBe('e');
	});
});

describe('notification scheduling', () => {
	it('keeps the id bands disjoint and inside the 32-bit signed range', () => {
		const digest = digestId('morning', '2026-07-27:morning');
		const reminder = reminderId('nature.think.example');

		expect(digest).toBeGreaterThanOrEqual(NOTIF_BANDS.DIGEST_BASE);
		expect(digest).toBeLessThan(NOTIF_BANDS.DIGEST_END);
		expect(reminder).toBeGreaterThanOrEqual(NOTIF_BANDS.REMINDER_BASE);
		expect(reminder).toBeLessThan(NOTIF_BANDS.REMINDER_END);
		expect(digest).toBeLessThan(2_147_483_647);
		expect(reminder).toBeLessThan(2_147_483_647);
	});

	it('is stable for the same inputs', () => {
		expect(digestId('morning', 'k')).toBe(digestId('morning', 'k'));
		expect(reminderId('a')).toBe(reminderId('a'));
	});

	it('places a slot at the requested local time', () => {
		const at = slotDate(new Date(2026, 6, 27, 3, 0), '08:30');
		expect(at.getHours()).toBe(8);
		expect(at.getMinutes()).toBe(30);
	});

	const times = { morning: '08:30', midday: '13:00', evening: '18:30' };
	const copy = (slot: string, count: number) => ({ title: slot, body: `${count} left` });

	it('plans a rolling window of one-shots', () => {
		const plans = planDigests({
			now: new Date(2026, 6, 27, 6, 0),
			times,
			remainingToday: 4,
			dailyCount: 4,
			copy,
			daysAhead: 2
		});
		// 3 today (all still ahead at 06:00) plus 3 tomorrow
		expect(plans).toHaveLength(6);
	});

	it('skips slots that have already passed today', () => {
		const plans = planDigests({
			now: new Date(2026, 6, 27, 14, 0),
			times,
			remainingToday: 2,
			dailyCount: 4,
			copy,
			daysAhead: 1
		});
		expect(plans.map((p) => p.slot)).toEqual(['evening']);
	});

	it('skips today entirely once the day is complete', () => {
		const plans = planDigests({
			now: new Date(2026, 6, 27, 6, 0),
			times,
			remainingToday: 0,
			dailyCount: 4,
			copy,
			daysAhead: 1
		});
		expect(plans).toEqual([]);
	});

	it('assumes a full slate for future days', () => {
		const plans = planDigests({
			now: new Date(2026, 6, 27, 23, 0),
			times,
			remainingToday: 0,
			dailyCount: 4,
			copy,
			daysAhead: 2
		});
		expect(plans).toHaveLength(3);
		expect(plans.every((p) => p.body === '4 left')).toBe(true);
	});

	it('gives every plan a unique id', () => {
		const plans = planDigests({
			now: new Date(2026, 6, 27, 6, 0),
			times,
			remainingToday: 4,
			dailyCount: 4,
			copy,
			daysAhead: 5
		});
		expect(new Set(plans.map((p) => p.id)).size).toBe(plans.length);
	});

	it('only ever schedules into the future', () => {
		const now = new Date(2026, 6, 27, 12, 0);
		const plans = planDigests({ now, times, remainingToday: 4, dailyCount: 4, copy, daysAhead: 3 });
		for (const plan of plans) expect(plan.at.getTime()).toBeGreaterThan(now.getTime());
	});
});
