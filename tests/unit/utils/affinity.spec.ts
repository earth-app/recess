import { describe, expect, it } from 'vitest';
import type { Nudge, NudgeCategory } from '~/types/nudge';
import {
	AFFINITY_LOGIT_CLAMP,
	AFFINITY_MAX_LOG_ODDS,
	BLEND_K,
	COUNT_DECAY_CEILING,
	FEATURE_GROUP_WEIGHTS,
	INTEREST_PSEUDO_COUNT,
	SKIP_EVIDENCE_WEIGHT,
	affinityFor,
	betaInt,
	buildAffinityModel,
	confidenceBlend,
	countsFrom,
	durationBand,
	featureShapes,
	featuresOf,
	groupedFeatures,
	interestPseudoCounts,
	personalFactors,
	pointsBand,
	posteriorMean
} from '~/utils/affinity';
import { seededRandom } from '~/utils/day';
import { FIXED_NOW, entry, task, think } from '../helpers';

// A constant rng makes betaInt exact: gammaInt(k) is k copies of the same exponential,
// so the ratio collapses to a / (a + b). Every algebraic assertion below leans on that.
const flat = () => 0.5;

function nudge(overrides: Partial<Nudge> = {}): Nudge {
	return think(overrides as Parameters<typeof think>[0]);
}

describe('pointsBand', () => {
	it('splits at the documented boundaries', () => {
		expect(pointsBand(1)).toBe('low');
		expect(pointsBand(10)).toBe('low');
		expect(pointsBand(11)).toBe('mid');
		expect(pointsBand(19)).toBe('mid');
		expect(pointsBand(20)).toBe('high');
	});
});

describe('durationBand', () => {
	it('splits at the documented boundaries', () => {
		expect(durationBand(1)).toBe('short');
		expect(durationBand(10)).toBe('short');
		expect(durationBand(11)).toBe('medium');
		expect(durationBand(44)).toBe('medium');
		expect(durationBand(45)).toBe('long');
		expect(durationBand(240)).toBe('long');
	});
});

describe('groupedFeatures', () => {
	it('keys every arm by its own group', () => {
		const grouped = groupedFeatures(nudge({ tags: ['a', 'b'] }));
		expect(grouped.get('category')).toEqual(['category:nature']);
		expect(grouped.get('tag')).toEqual(['tag:a', 'tag:b']);
	});

	it('leaves out the groups a nudge does not activate', () => {
		const grouped = groupedFeatures(nudge({ tags: [] }));
		expect(grouped.has('tag')).toBe(false);
		expect(grouped.has('duration')).toBe(false);
		expect(grouped.has('validation')).toBe(false);
	});

	it('flattens back to featuresOf in group order', () => {
		const subject = task({ points: 25, duration_minutes: 60, tags: ['x'] });
		expect([...groupedFeatures(subject).values()].flat()).toEqual(featuresOf(subject));
	});
});

describe('featuresOf', () => {
	it('covers an unvalidated nudge with no duration', () => {
		expect(featuresOf(nudge({ points: 5, tags: [] }))).toEqual([
			'category:nature',
			'type:think',
			'points:low'
		]);
	});

	it('omits validation for a think nudge and duration when it is absent', () => {
		const features = featuresOf(nudge({ tags: ['quiet'] }));
		expect(features).not.toContain('validation:confirm');
		expect(features.some((feature) => feature.startsWith('duration:'))).toBe(false);
		expect(features).toContain('tag:quiet');
	});

	it('includes validation and duration when the nudge carries them', () => {
		const features = featuresOf(
			task({ points: 25, duration_minutes: 60, tags: ['reach', 'slow'] })
		);
		expect(features).toEqual([
			'category:people',
			'type:task',
			'validation:confirm',
			'points:high',
			'duration:long',
			'tag:reach',
			'tag:slow'
		]);
	});

	it('bands a mid-length nudge as medium', () => {
		expect(featuresOf(nudge({ duration_minutes: 20 }))).toContain('duration:medium');
	});

	it('emits one arm per tag', () => {
		const features = featuresOf(nudge({ tags: ['a', 'b', 'c'] }));
		expect(features.filter((feature) => feature.startsWith('tag:'))).toEqual([
			'tag:a',
			'tag:b',
			'tag:c'
		]);
	});
});

describe('countsFrom', () => {
	const subject = nudge({ id: 'nature.think.subject', tags: ['quiet'] });

	it('counts a completion as one success', () => {
		const counts = countsFrom([entry({ id: subject.id })], [subject]);
		expect(counts.get('category:nature')).toEqual({ successes: 1, failures: 0 });
		expect(counts.get('tag:quiet')).toEqual({ successes: 1, failures: 0 });
	});

	it('weights a skip at a fifth of a completion', () => {
		const counts = countsFrom([entry({ id: subject.id, outcome: 'skipped' })], [subject]);
		expect(counts.get('category:nature')).toEqual({
			successes: 0,
			failures: SKIP_EVIDENCE_WEIGHT
		});
		expect(SKIP_EVIDENCE_WEIGHT).toBe(0.2);
	});

	it('treats every non-skip outcome as a success', () => {
		for (const outcome of ['passed', 'self_attested', 'answered'] as const) {
			const counts = countsFrom([entry({ id: subject.id, outcome })], [subject]);
			expect(counts.get('category:nature')?.successes).toBe(1);
		}
	});

	it('needs five skips to outweigh one completion', () => {
		const entries = [
			entry({ id: subject.id, at: FIXED_NOW.getTime() }),
			...Array.from({ length: 5 }, (_, index) =>
				entry({
					id: subject.id,
					outcome: 'skipped' as const,
					at: FIXED_NOW.getTime() + index + 1
				})
			)
		];
		const counts = countsFrom(entries, [subject]);
		expect(counts.get('category:nature')).toEqual({ successes: 1, failures: 1 });
	});

	it('halves both sides past the ceiling and keeps the ratio', () => {
		const entries = Array.from({ length: COUNT_DECAY_CEILING + 1 }, (_, index) =>
			entry({ id: subject.id, at: FIXED_NOW.getTime() + index })
		);
		const counts = countsFrom(entries, [subject]);
		const slot = counts.get('category:nature');

		expect(slot?.successes).toBeCloseTo((COUNT_DECAY_CEILING + 1) / 2, 10);
		expect(slot?.failures).toBe(0);
		expect((slot?.successes ?? 0) + (slot?.failures ?? 0)).toBeLessThanOrEqual(COUNT_DECAY_CEILING);
	});

	it('preserves the success-to-failure ratio through a halving', () => {
		// interleaved and sized so exactly one halving fires, on the last entry
		const entries = interleaved(subject.id, 5);
		const before = countsFrom(entries, [subject], { ceiling: Number.POSITIVE_INFINITY }).get(
			'category:nature'
		);
		const after = countsFrom(entries, [subject], { ceiling: 5.9 }).get('category:nature');

		expect(before).toEqual({ successes: 5, failures: 1 });
		expect(after).toEqual({ successes: 2.5, failures: 0.5 });

		const ratioOf = (slot?: { successes: number; failures: number }) =>
			(slot?.successes ?? 0) / ((slot?.successes ?? 0) + (slot?.failures ?? 0));
		expect(ratioOf(after)).toBeCloseTo(ratioOf(before), 12);
	});

	it('keeps every shape at or above one after a halving', () => {
		const counts = countsFrom(skipRun(subject.id, 40, 40), [subject], { ceiling: 4 });
		for (const feature of counts.keys()) {
			const { a, b } = featureShapes(counts, feature);
			expect(a).toBeGreaterThanOrEqual(1);
			expect(b).toBeGreaterThanOrEqual(1);
			expect(Number.isInteger(a)).toBe(true);
			expect(Number.isInteger(b)).toBe(true);
		}
	});

	it('does not depend on the order the ledger arrives in', () => {
		const entries = skipRun(subject.id, 30, 20);
		const forwards = countsFrom(entries, [subject], { ceiling: 8 });
		const backwards = countsFrom([...entries].reverse(), [subject], { ceiling: 8 });
		expect(backwards.get('category:nature')).toEqual(forwards.get('category:nature'));
	});

	it('falls back to the entry when the nudge left the catalog', () => {
		const counts = countsFrom([
			entry({ id: 'gone.think.retired', category: 'art', type: 'think', points: 30 })
		]);
		expect(counts.get('category:art')?.successes).toBe(1);
		expect(counts.get('points:high')?.successes).toBe(1);
		// tags live on the nudge, so a missing catalog entry simply carries none
		expect([...counts.keys()].some((key) => key.startsWith('tag:'))).toBe(false);
	});

	it('reads validation and duration off a fallback entry', () => {
		const counts = countsFrom([
			entry({ id: 'gone.task.retired', validation_type: 'photo', duration_minutes: 60 })
		]);
		expect(counts.get('validation:photo')?.successes).toBe(1);
		expect(counts.get('duration:long')?.successes).toBe(1);
	});

	it('starts from the supplied priors', () => {
		const priors = interestPseudoCounts(['nature']);
		const counts = countsFrom([entry({ id: subject.id })], [subject], { priors });
		expect(counts.get('category:nature')?.successes).toBe(INTEREST_PSEUDO_COUNT + 1);
	});
});

function skipRun(id: string, completions: number, skips: number) {
	const entries = [];
	for (let index = 0; index < completions; index++) {
		entries.push(entry({ id, at: FIXED_NOW.getTime() + index }));
	}
	for (let index = 0; index < skips; index++) {
		entries.push(
			entry({ id, outcome: 'skipped' as const, at: FIXED_NOW.getTime() + completions + index })
		);
	}
	return entries;
}

/** one completion then one skip, `pairs` times */
function interleaved(id: string, pairs: number) {
	const entries = [];
	for (let index = 0; index < pairs; index++) {
		entries.push(entry({ id, at: FIXED_NOW.getTime() + index * 2 }));
		entries.push(
			entry({ id, outcome: 'skipped' as const, at: FIXED_NOW.getTime() + index * 2 + 1 })
		);
	}
	return entries;
}

describe('featureShapes', () => {
	it('is Beta(1, 1) for an arm with no evidence', () => {
		expect(featureShapes(new Map(), 'category:nature')).toEqual({ a: 1, b: 1 });
		expect(posteriorMean(new Map(), 'category:nature')).toBe(0.5);
	});

	it('rounds fractional skip evidence to an integer shape', () => {
		const counts = new Map([['tag:x', { successes: 2, failures: 0.6 }]]);
		expect(featureShapes(counts, 'tag:x')).toEqual({ a: 3, b: 2 });
	});
});

describe('betaInt', () => {
	it('lands within tolerance of a / (a + b) over 10k seeded draws', () => {
		const cases: [number, number][] = [
			[1, 1],
			[4, 1],
			[2, 5],
			[9, 3]
		];

		for (const [a, b] of cases) {
			const rng = seededRandom(1234);
			let total = 0;
			for (let draw = 0; draw < 10_000; draw++) total += betaInt(a, b, rng);
			expect(total / 10_000).toBeCloseTo(a / (a + b), 2);
		}
	});

	it('returns the same value for the same seed', () => {
		const first = betaInt(3, 2, seededRandom(99));
		const second = betaInt(3, 2, seededRandom(99));
		expect(second).toBe(first);
	});

	it('differs for a different seed', () => {
		expect(betaInt(3, 2, seededRandom(99))).not.toBe(betaInt(3, 2, seededRandom(100)));
	});

	it('stays strictly inside 0 and 1', () => {
		const rng = seededRandom(7);
		for (let draw = 0; draw < 2000; draw++) {
			const value = betaInt(2, 3, rng);
			expect(value).toBeGreaterThan(0);
			expect(value).toBeLessThan(1);
		}
	});

	it('collapses to the shape mean under a constant rng', () => {
		expect(betaInt(3, 1, flat)).toBeCloseTo(0.75, 12);
		expect(betaInt(1, 3, flat)).toBeCloseTo(0.25, 12);
	});

	it('clamps a non-integer or sub-one shape rather than losing exactness', () => {
		expect(betaInt(0, 0, flat)).toBeCloseTo(0.5, 12);
		expect(betaInt(3.4, 1.4, flat)).toBeCloseTo(0.75, 12);
	});

	it('falls back to the median when every uniform comes back degenerate', () => {
		expect(betaInt(2, 2, () => 0)).toBe(0.5);
	});
});

describe('affinityFor', () => {
	it('is zero when no arm carries evidence', () => {
		expect(affinityFor(nudge(), new Map(), flat)).toBe(0);
	});

	it('is positive for a liked category and negative for a skipped one', () => {
		const liked = nudge({ id: 'nature.think.a' });
		const counts = countsFrom(
			[
				entry({ id: liked.id, at: 1 }),
				entry({ id: liked.id, at: 2 }),
				entry({ id: liked.id, at: 3 })
			],
			[liked]
		);
		expect(affinityFor(liked, counts, flat)).toBeGreaterThan(0);

		const skipped = countsFrom(
			Array.from({ length: 15 }, (_, index) =>
				entry({ id: liked.id, outcome: 'skipped' as const, at: index })
			),
			[liked]
		);
		expect(affinityFor(liked, skipped, flat)).toBeLessThan(0);
	});

	it('averages the tag group instead of summing it', () => {
		const one = nudge({ id: 'nature.think.one', tags: ['t0'] });
		const five = nudge({ id: 'nature.think.five', tags: ['t0', 't1', 't2', 't3', 't4'] });

		// identical per-tag evidence, so the only difference is how many tags there are
		const counts = new Map(
			['t0', 't1', 't2', 't3', 't4'].map((tag) => [`tag:${tag}`, { successes: 4, failures: 1 }])
		);

		expect(affinityFor(five, counts, flat)).toBeCloseTo(affinityFor(one, counts, flat), 12);
	});

	it('saturates at the total clamp rather than growing with the group count', () => {
		const loud = task({
			id: 'people.task.loud',
			points: 25,
			duration_minutes: 60,
			tags: ['a', 'b', 'c']
		});
		const counts = new Map(
			featuresOf(loud).map((feature) => [feature, { successes: 400, failures: 0 }])
		);
		expect(affinityFor(loud, counts, flat)).toBe(AFFINITY_MAX_LOG_ODDS);

		const hated = new Map(
			featuresOf(loud).map((feature) => [feature, { successes: 0, failures: 400 }])
		);
		expect(affinityFor(loud, hated, flat)).toBe(-AFFINITY_MAX_LOG_ODDS);
	});

	it('caps a single arm before it reaches the total clamp', () => {
		const subject = nudge({ id: 'nature.think.solo', tags: [] });
		const counts = new Map([['category:nature', { successes: 4000, failures: 0 }]]);
		// one arm at the per-arm clamp, times its group weight, so it cannot saturate alone
		expect(affinityFor(subject, counts, flat)).toBeCloseTo(
			AFFINITY_LOGIT_CLAMP * (FEATURE_GROUP_WEIGHTS.category as number),
			12
		);
	});

	it('weighs an evidence-rich nudge above one that only shares a weak arm', () => {
		const nature = nudge({ id: 'nature.think.a', tags: ['quiet'] });
		const art = nudge({ id: 'art.think.b', category: 'art', tags: ['loud'] });
		const counts = countsFrom(
			[1, 2, 3, 4].map((at) => entry({ id: nature.id, at })),
			[nature]
		);
		expect(affinityFor(nature, counts, flat)).toBeGreaterThan(affinityFor(art, counts, flat));
		expect(affinityFor(art, counts, flat)).toBeGreaterThan(0);
	});

	it('treats a missing or unusable group weight as no contribution', () => {
		const subject = nudge({ id: 'nature.think.w', tags: [] });
		const counts = new Map([['category:nature', { successes: 8, failures: 0 }]]);
		expect(affinityFor(subject, counts, flat, { groups: { category: undefined } })).toBe(0);
		expect(affinityFor(subject, counts, flat, { groups: { category: Number.NaN } })).toBe(0);
	});

	it('replays exactly from the same seed and diverges from another', () => {
		const subject = nudge({ tags: ['quiet'] });
		const counts = countsFrom([entry({ id: subject.id })], [subject]);
		expect(affinityFor(subject, counts, seededRandom(5))).toBe(
			affinityFor(subject, counts, seededRandom(5))
		);
		expect(affinityFor(subject, counts, seededRandom(5))).not.toBe(
			affinityFor(subject, counts, seededRandom(6))
		);
	});
});

describe('confidenceBlend', () => {
	it('is exactly zero with no interactions', () => {
		expect(confidenceBlend(0)).toBe(0);
		expect(confidenceBlend(-4)).toBe(0);
	});

	it('reaches half strength at K interactions', () => {
		expect(confidenceBlend(BLEND_K)).toBeCloseTo(0.5, 12);
		expect(BLEND_K).toBe(10);
	});

	it('rises monotonically toward one', () => {
		let previous = 0;
		for (const n of [1, 5, 10, 40, 200, 2000]) {
			const blend = confidenceBlend(n);
			expect(blend).toBeGreaterThan(previous);
			expect(blend).toBeLessThan(1);
			previous = blend;
		}
	});

	it('treats an infinite K as the learned layer switched off', () => {
		expect(confidenceBlend(500, Number.POSITIVE_INFINITY)).toBe(0);
	});

	it('treats a zero K as full confidence once anything happened', () => {
		expect(confidenceBlend(1, 0)).toBe(1);
	});
});

describe('interestPseudoCounts', () => {
	it('is three successes and nothing else per interest', () => {
		const counts = interestPseudoCounts(['art', 'nature']);
		expect(counts.get('category:art')).toEqual({ successes: 3, failures: 0 });
		expect(counts.get('category:nature')).toEqual({ successes: 3, failures: 0 });
		expect(counts.size).toBe(2);
		expect(INTEREST_PSEUDO_COUNT).toBe(3);
	});

	it('is empty when the strength is switched off', () => {
		expect(interestPseudoCounts(['art'], 0).size).toBe(0);
	});

	it('loses influence as real evidence accumulates', () => {
		const artNudges: Nudge[] = [0, 1, 2].map((index) =>
			nudge({ id: `art.think.n${index}`, category: 'art' as NudgeCategory })
		);
		const shareOf = (entries: ReturnType<typeof entry>[]) => {
			const model = buildAffinityModel(entries, artNudges, { interests: ['art'] });
			return posteriorMean(model.counts, 'category:art');
		};

		const priorOnly = shareOf([]);
		// the interest alone reads as three completions and nothing against it
		expect(priorOnly).toBeCloseTo(4 / 5, 12);

		const someSkips = shareOf(
			Array.from({ length: 25 }, (_, index) =>
				entry({ id: 'art.think.n0', category: 'art', outcome: 'skipped' as const, at: index })
			)
		);
		const manySkips = shareOf(
			Array.from({ length: 100 }, (_, index) =>
				entry({ id: 'art.think.n0', category: 'art', outcome: 'skipped' as const, at: index })
			)
		);

		expect(someSkips).toBeLessThan(priorOnly);
		expect(manySkips).toBeLessThan(someSkips);
		// the +3 never disappears, it is just outvoted
		expect(manySkips).toBeGreaterThan(0);
		expect(manySkips).toBeLessThan(0.35);
	});
});

describe('buildAffinityModel', () => {
	it('counts onboarding interests toward the blend', () => {
		const model = buildAffinityModel([], [], { interests: ['art'] });
		expect(model.interactions).toBe(INTEREST_PSEUDO_COUNT);
		expect(model.blend).toBeCloseTo(3 / 13, 12);
	});

	it('has no evidence and no confidence on a fresh install', () => {
		const model = buildAffinityModel([], []);
		expect(model.interactions).toBe(0);
		expect(model.blend).toBe(0);
		expect(model.counts.size).toBe(0);
	});
});

describe('personalFactors', () => {
	const pool = [
		nudge({ id: 'nature.think.a', tags: ['quiet'] }),
		nudge({ id: 'art.think.b', category: 'art', tags: ['loud'] })
	];

	it('is exactly the identity at zero interactions', () => {
		const model = buildAffinityModel([], pool);
		const rng = seededRandom(1);
		const factors = personalFactors(pool, model, rng);

		expect(factors.size).toBe(0);
		for (const item of pool) expect(factors.get(item.id) ?? 1).toBe(1);
		// no draws were taken, so the pick stream is byte-identical to the unlearned one
		expect(rng()).toBe(seededRandom(1)());
	});

	it('lifts a nudge whose features have been completed', () => {
		const entries = [
			entry({ id: 'nature.think.a', at: 1 }),
			entry({ id: 'nature.think.a', at: 2 }),
			entry({ id: 'nature.think.a', at: 3 }),
			entry({ id: 'nature.think.a', at: 4 })
		];
		const model = buildAffinityModel(entries, pool);
		const factors = personalFactors(pool, model, flat);

		expect(factors.get('nature.think.a')).toBeGreaterThan(1);
		// art only shares the type and points arms, so it lifts less
		expect(factors.get('art.think.b')).toBeGreaterThan(1);
		expect(factors.get('art.think.b')).toBeLessThan(factors.get('nature.think.a') as number);
	});

	it('replays from the same seed', () => {
		const model = buildAffinityModel([entry({ id: 'nature.think.a' })], pool);
		const first = personalFactors(pool, model, seededRandom(42));
		const second = personalFactors(pool, model, seededRandom(42));
		expect([...second]).toEqual([...first]);
	});
});
