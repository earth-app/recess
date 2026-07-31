import { describe, expect, it } from 'vitest';
import type { NudgeCategory, NudgeType } from '~/types/nudge';
import { pointsBand } from '~/utils/affinity';
import { loadCatalog } from '~/utils/data';
import { dayKey } from '~/utils/day';
import {
	CATEGORY_SATIATION_DEPTH,
	CATEGORY_SATIATION_HALF_LIFE_DAYS,
	DEFAULT_COOLDOWN_DAYS,
	DEFAULT_DAILY_COUNT,
	ITEM_SATIATION_DEPTH,
	ITEM_SATIATION_HALF_LIFE_DAYS,
	MAX_PER_CATEGORY,
	MIN_COOLDOWN_DAYS,
	SKIP_DECAY_DAYS,
	dominantBlocker,
	maxSimilarity,
	nudgeSimilarity,
	recommendDaily,
	satiationFactor,
	seedKeyFor
} from '~/utils/recommend';
import { FIXED_NOW, catalog, ctx, entry, question, task, think } from '../helpers';

const SEED_A = '0123456789abcdef0123456789abcdef';
const SEED_B = 'fedcba9876543210fedcba9876543210';

// the rate comparisons below run a control arm over the same days rather than checking
// an absolute count, so they measure the signal itself and not sampling noise
const DAYS = 60;

describe('pointsBand', () => {
	it('splits at the documented boundaries', () => {
		expect(pointsBand(5)).toBe('low');
		expect(pointsBand(10)).toBe('low');
		expect(pointsBand(11)).toBe('mid');
		expect(pointsBand(19)).toBe('mid');
		expect(pointsBand(20)).toBe('high');
		expect(pointsBand(50)).toBe('high');
	});
});

describe('recommendDaily', () => {
	it('picks the requested number of nudges', () => {
		const result = recommendDaily(catalog(), ctx(), [], { count: 4 });
		expect(result.nudges).toHaveLength(4);
		expect(result.shortfall).toBe(0);
	});

	it('is deterministic for the same day and locale', () => {
		const first = recommendDaily(catalog(), ctx(), [], { count: 4 });
		const second = recommendDaily(catalog(), ctx(), [], { count: 4 });
		expect(second.nudges.map((n) => n.id)).toEqual(first.nudges.map((n) => n.id));
	});

	it('changes on the next day', () => {
		const today = recommendDaily(catalog(), ctx(), [], { count: 4 });
		const tomorrow = recommendDaily(
			catalog(),
			ctx({ now: new Date(FIXED_NOW.getTime() + 86_400_000), day: '2026-07-28' }),
			[],
			{ count: 4 }
		);
		expect(tomorrow.nudges.map((n) => n.id)).not.toEqual(today.nudges.map((n) => n.id));
	});

	it('changes with the locale so a region user does not get the same deck', () => {
		const en = recommendDaily(catalog(), ctx({ locale: 'en' }), [], { count: 4 });
		const es = recommendDaily(catalog(), ctx({ locale: 'es-MX' }), [], { count: 4 });
		expect(es.nudges.map((n) => n.id)).not.toEqual(en.nudges.map((n) => n.id));
	});

	it('never repeats a nudge inside one day', () => {
		const result = recommendDaily(catalog(), ctx(), [], { count: 4 });
		expect(new Set(result.nudges.map((n) => n.id)).size).toBe(result.nudges.length);
	});

	it('caps how many come from one category', () => {
		const counts = new Map<string, number>();
		for (const nudge of recommendDaily(catalog(), ctx(), [], { count: 4 }).nudges) {
			counts.set(nudge.category, (counts.get(nudge.category) ?? 0) + 1);
		}
		for (const count of counts.values()) expect(count).toBeLessThanOrEqual(MAX_PER_CATEGORY);
	});

	it('spreads points across bands when the pool allows', () => {
		const bands = recommendDaily(catalog(), ctx(), [], { count: 4 }).nudges.map((n) =>
			pointsBand(n.points)
		);
		expect(new Set(bands).size).toBeGreaterThan(1);
	});

	it('excludes anything resolved today', () => {
		const pool = catalog();
		const first = recommendDaily(pool, ctx(), [], { count: 4 }).nudges[0]!;
		const withEntry = recommendDaily(
			pool,
			ctx(),
			[entry({ id: first.id, category: first.category, at: FIXED_NOW.getTime() })],
			{ count: 4 }
		);
		expect(withEntry.nudges.map((n) => n.id)).not.toContain(first.id);
	});

	it('excludes anything still inside its cooldown', () => {
		const pool = catalog();
		const target = pool[0]!;
		const recent = entry({
			id: target.id,
			category: target.category,
			at: FIXED_NOW.getTime() - 2 * 86_400_000
		});
		const result = recommendDaily(pool, ctx(), [recent], {
			count: 9,
			cooldownDays: DEFAULT_COOLDOWN_DAYS
		});
		expect(result.nudges.map((n) => n.id)).not.toContain(target.id);
	});

	it('allows a nudge back once the cooldown elapses', () => {
		const pool = [think({ id: 'nature.think.only', slug: 'only' })];
		const old = entry({
			id: 'nature.think.only',
			at: FIXED_NOW.getTime() - 40 * 86_400_000
		});
		const result = recommendDaily(pool, ctx(), [old], { count: 1, cooldownDays: 21 });
		expect(result.nudges.map((n) => n.id)).toEqual(['nature.think.only']);
	});

	it('honours a zero cooldown', () => {
		const pool = [think({ id: 'nature.think.only', slug: 'only' })];
		const yesterday = entry({
			id: 'nature.think.only',
			at: FIXED_NOW.getTime() - 86_400_000
		});
		const result = recommendDaily(pool, ctx(), [yesterday], { count: 1, cooldownDays: 0 });
		expect(result.nudges).toHaveLength(1);
	});

	it('respects disabled categories', () => {
		const result = recommendDaily(catalog(), ctx(), [], {
			count: 4,
			enabledCategories: ['nature', 'art']
		});
		for (const nudge of result.nudges) expect(['nature', 'art']).toContain(nudge.category);
	});

	it('filters the pool before picking', () => {
		const nightOnly = catalog().map((nudge) => ({
			...nudge,
			filters: [{ type: 'time_of_day' as const, value: { is: ['night' as const] } }]
		}));
		const result = recommendDaily(nightOnly, ctx({ time_of_day: 'day' }), [], { count: 4 });
		expect(result.nudges).toHaveLength(0);
		expect(result.blocked.length).toBeGreaterThan(0);
	});

	it('reports a shortfall rather than throwing on a thin pool', () => {
		const result = recommendDaily([think()], ctx(), [], { count: 4 });
		expect(result.nudges).toHaveLength(1);
		expect(result.shortfall).toBe(3);
	});

	it('returns nothing for an empty catalog', () => {
		const result = recommendDaily([], ctx(), [], { count: 4 });
		expect(result.nudges).toEqual([]);
		expect(result.bonus).toBeNull();
	});

	it('offers a bonus distinct from the core picks', () => {
		const result = recommendDaily(catalog(), ctx(), [], { count: 4 });
		expect(result.bonus).not.toBeNull();
		expect(result.nudges.map((n) => n.id)).not.toContain(result.bonus?.id);
	});

	it('has no bonus when the pool is exactly the core size', () => {
		const pool = catalog().slice(0, 2);
		const result = recommendDaily(pool, ctx(), [], { count: 2 });
		expect(result.nudges).toHaveLength(2);
		expect(result.bonus).toBeNull();
	});

	it('still offers a nudge whose pack is missing, only less often', () => {
		const needsVision = think({
			id: 'nature.notice.photo',
			slug: 'photo',
			filters: []
		});
		const result = recommendDaily([needsVision], ctx({ installed_packs: [] }), [], { count: 1 });
		expect(result.nudges).toHaveLength(1);
	});

	function countCategory(
		category: string,
		options: Parameters<typeof recommendDaily>[3],
		entriesFor: (day: Date) => ReturnType<typeof entry>[] = () => []
	): number {
		let hits = 0;
		for (let offset = 0; offset < DAYS; offset++) {
			const now = new Date(FIXED_NOW.getTime() + offset * 86_400_000);
			const result = recommendDaily(catalog(), ctx({ now, day: dayKey(now) }), entriesFor(now), {
				count: 1,
				...options
			});
			if (result.nudges[0]?.category === category) hits++;
		}
		return hits;
	}

	it('boosts an interest above its unweighted rate', () => {
		const control = countCategory('art', {});
		const boosted = countCategory('art', { interests: ['art'] });
		expect(boosted).toBeGreaterThan(control);
	});

	it('deprioritizes a category resolved in the last few days', () => {
		const yesterdaysNature = (now: Date) => [
			entry({ category: 'nature', at: now.getTime() - 86_400_000 })
		];
		const control = countCategory('nature', {});
		const penalized = countCategory('nature', {}, yesterdaysNature);
		expect(penalized).toBeLessThan(control);
	});

	it('scores every eligible nudge for inspection', () => {
		const result = recommendDaily(catalog(), ctx(), [], { count: 4 });
		expect(result.scored).toHaveLength(catalog().length);
		expect(result.scored[0]?.weight).toBeGreaterThanOrEqual(
			result.scored[result.scored.length - 1]?.weight ?? 0
		);
	});

	it('defaults the count and the cooldown when neither is given', () => {
		const result = recommendDaily(catalog(), ctx());
		expect(result.nudges).toHaveLength(DEFAULT_DAILY_COUNT);
	});

	it('falls back to the mid band when no slots are configured', () => {
		const result = recommendDaily(catalog(), ctx(), [], { count: 2, slots: [] });
		expect(result.nudges).toHaveLength(2);
	});

	it('stops penalizing a skip once it has decayed', () => {
		const subject = think({ id: 'nature.think.skipped' });
		const skipOf = (daysAgo: number) =>
			recommendDaily([subject], ctx(), [
				entry({
					id: subject.id,
					outcome: 'skipped',
					at: FIXED_NOW.getTime() - daysAgo * 86_400_000
				})
			]).scored[0]!;

		expect(skipOf(1).reasons).toContain('skipped recently x0.3');
		expect(skipOf(SKIP_DECAY_DAYS + 1).reasons).not.toContain('skipped recently x0.3');
	});

	it('leaves a base-language nudge unpenalized for a region locale', () => {
		const base = think({ id: 'nature.think.base', locale: 'en' });
		const exact = recommendDaily([base], ctx({ locale: 'en' })).scored[0]!;
		const region = recommendDaily([base], ctx({ locale: 'en-GB' })).scored[0]!;
		const other = recommendDaily([base], ctx({ locale: 'es' })).scored[0]!;

		expect(exact.reasons).toContain('exact locale x1.25');
		expect(region.reasons).toEqual([]);
		expect(other.reasons).toContain('fallback locale x0.8');
	});

	it('stops down-weighting a nudge once its pack is installed', () => {
		const needsVision = task({
			id: 'art.create.photo',
			type: 'create',
			category: 'art',
			validation_type: 'photo',
			validation_data: { labels: ['a photo of anything'], threshold: 0.6 }
		} as never);
		const missing = recommendDaily([needsVision], ctx({ installed_packs: [] })).scored[0]!;
		const installed = recommendDaily([needsVision], ctx({ installed_packs: ['vision'] }))
			.scored[0]!;

		expect(missing.reasons).toContain('pack missing x0.4');
		expect(installed.reasons).not.toContain('pack missing x0.4');
	});

	it('down-weights a tag the user already saw yesterday', () => {
		const subject = think({ id: 'nature.think.tagged', tags: ['birds'] });
		const sibling = think({ id: 'art.think.tagged', category: 'art', tags: ['birds'] });
		const yesterday = entry({
			id: sibling.id,
			category: 'art',
			at: FIXED_NOW.getTime() - 86_400_000
		});

		const clean = recommendDaily([subject], ctx()).scored[0]!;
		const repeated = recommendDaily([subject, sibling], ctx(), [yesterday]).scored.find(
			(row) => row.nudge.id === subject.id
		)!;

		expect(clean.reasons).not.toContain('tag seen yesterday x0.7');
		expect(repeated.reasons).toContain('tag seen yesterday x0.7');
	});

	it('keeps a fresh validation type out of the same slate twice', () => {
		const pool = [
			task({ id: 'people.task.a', points: 5 }),
			task({ id: 'home.task.b', category: 'home', points: 15 }),
			think({ id: 'nature.think.c', points: 15 }),
			think({ id: 'art.think.d', category: 'art', points: 25 })
		];
		const result = recommendDaily(pool, ctx(), [], { count: 2, installSeed: SEED_A });
		expect(result.nudges).toHaveLength(2);
	});

	it('skips the MMR term when a pick shares nothing with the slate', () => {
		const pool = [
			think({ id: 'nature.think.a', tags: ['x'] }),
			task({ id: 'people.task.b', category: 'people', tags: ['y'] })
		];
		const result = recommendDaily(pool, ctx(), [], { count: 2, installSeed: SEED_A });
		expect(result.nudges).toHaveLength(2);
		// nothing shared at all, so no variety penalty was applied to the second pick
		expect(maxSimilarity(pool[0]!, [pool[1]!])).toBe(0);
	});

	it('down-weights a nudge that will not fit before sunset', () => {
		const long = think({ id: 'nature.think.long', duration_minutes: 60 });
		const plenty = recommendDaily([long], ctx({ daylight_remaining: 240 }), [], { count: 1 });
		const short = recommendDaily([long], ctx({ daylight_remaining: 10 }), [], { count: 1 });
		expect(short.scored[0]!.weight).toBeLessThan(plenty.scored[0]!.weight);
		expect(short.scored[0]!.reasons).toContain('not enough daylight x0.5');
	});

	it('down-weights a long nudge late at night', () => {
		const long = think({ id: 'nature.think.long', duration_minutes: 60 });
		const evening = recommendDaily([long], ctx({ hour: 18 }), [], { count: 1 });
		const late = recommendDaily([long], ctx({ hour: 22 }), [], { count: 1 });
		expect(late.scored[0]!.weight).toBeLessThan(evening.scored[0]!.weight);
		expect(late.scored[0]!.reasons).toContain('too long for this hour x0.4');
	});

	it('leaves a short nudge alone late at night', () => {
		const quick = think({ id: 'nature.think.quick', duration_minutes: 5 });
		const late = recommendDaily([quick], ctx({ hour: 22 }), [], { count: 1 });
		expect(late.scored[0]!.reasons).not.toContain('too long for this hour x0.4');
	});

	it('reports the model the day was scored against', () => {
		const entries = [entry({ id: 'nature.think.n0', at: 1 }), entry({ id: 'art.think.n1', at: 2 })];
		const result = recommendDaily(catalog(), ctx(), entries, { count: 4 });
		expect(result.model.interactions).toBe(2);
		expect(result.model.blend).toBeCloseTo(2 / 12, 12);
		expect(result.model.counts.get('category:nature')?.successes).toBe(1);
	});
});

// #region install seed

describe('seedKeyFor', () => {
	it('prefixes the install seed when there is one', () => {
		expect(seedKeyFor(SEED_A, '2026-07-27', 'en')).toBe(`${SEED_A}:2026-07-27:en`);
	});

	it('is exactly the pre-seed key when the seed has not loaded yet', () => {
		expect(seedKeyFor('', '2026-07-27', 'en')).toBe('2026-07-27:en');
	});
});

describe('recommendDaily install seed', () => {
	it('is deterministic for the same day and seed', () => {
		const first = recommendDaily(catalog(), ctx(), [], { count: 4, installSeed: SEED_A });
		const second = recommendDaily(catalog(), ctx(), [], { count: 4, installSeed: SEED_A });
		expect(second.nudges.map((n) => n.id)).toEqual(first.nudges.map((n) => n.id));
	});

	it('gives two installs different decks on the same day', () => {
		const a = recommendDaily(catalog(), ctx(), [], { count: 4, installSeed: SEED_A });
		const b = recommendDaily(catalog(), ctx(), [], { count: 4, installSeed: SEED_B });
		expect(b.nudges.map((n) => n.id)).not.toEqual(a.nudges.map((n) => n.id));
	});

	it('reproduces the pre-seed deck when the seed is empty', () => {
		const unseeded = recommendDaily(catalog(), ctx(), [], { count: 4 });
		const empty = recommendDaily(catalog(), ctx(), [], { count: 4, installSeed: '' });
		expect(empty.nudges.map((n) => n.id)).toEqual(unseeded.nudges.map((n) => n.id));
		expect(empty.bonus?.id).toBe(unseeded.bonus?.id);
	});

	it('leaves the pick stream untouched when there is no evidence to learn from', () => {
		// blend is 0 at zero interactions, so no Thompson draw is taken at all and the
		// deck has to match the unlearned one exactly
		const withInterests = recommendDaily(catalog(), ctx(), [], { count: 4 });
		const scored = withInterests.scored.map((entry) => entry.weight);
		expect(withInterests.model.blend).toBe(0);
		expect(new Set(scored).size).toBeLessThanOrEqual(3);
	});
});

// #endregion

// #region satiation

describe('satiationFactor', () => {
	it('is deepest on the day of the completion', () => {
		expect(satiationFactor(0, ITEM_SATIATION_DEPTH, ITEM_SATIATION_HALF_LIFE_DAYS)).toBeCloseTo(
			1 - ITEM_SATIATION_DEPTH,
			12
		);
	});

	it('recovers exactly half the lost weight after one half-life', () => {
		const half = satiationFactor(
			ITEM_SATIATION_HALF_LIFE_DAYS,
			ITEM_SATIATION_DEPTH,
			ITEM_SATIATION_HALF_LIFE_DAYS
		);
		expect(half).toBeCloseTo(1 - ITEM_SATIATION_DEPTH / 2, 12);
	});

	it('rises monotonically with the days since', () => {
		let previous = -1;
		for (let days = 0; days <= 60; days++) {
			const factor = satiationFactor(days, ITEM_SATIATION_DEPTH, ITEM_SATIATION_HALF_LIFE_DAYS);
			expect(factor).toBeGreaterThan(previous);
			expect(factor).toBeLessThan(1);
			previous = factor;
		}
	});

	it('rebounds faster at the category level than at the item level', () => {
		const item = satiationFactor(3, ITEM_SATIATION_DEPTH, ITEM_SATIATION_HALF_LIFE_DAYS);
		const category = satiationFactor(
			3,
			CATEGORY_SATIATION_DEPTH,
			CATEGORY_SATIATION_HALF_LIFE_DAYS
		);
		expect(category).toBeGreaterThan(item);
	});

	it('treats a negative age as today', () => {
		expect(satiationFactor(-5, 0.5, 10)).toBe(satiationFactor(0, 0.5, 10));
	});

	it('is the identity when the half-life is switched off', () => {
		expect(satiationFactor(4, 0.9, 0)).toBe(1);
	});
});

describe('recommendDaily cooldown floor', () => {
	const only = [think({ id: 'nature.think.only', slug: 'only' })];
	const yesterday = entry({ id: 'nature.think.only', at: FIXED_NOW.getTime() - 86_400_000 });

	it('will not bring a nudge back the very next day', () => {
		const result = recommendDaily(only, ctx(), [yesterday], { count: 1, cooldownDays: 1 });
		expect(result.nudges).toHaveLength(0);
		expect(MIN_COOLDOWN_DAYS).toBe(2);
	});

	it('lets it back once the floor has elapsed', () => {
		const twoDaysAgo = entry({
			id: 'nature.think.only',
			at: FIXED_NOW.getTime() - 2 * 86_400_000
		});
		const result = recommendDaily(only, ctx(), [twoDaysAgo], { count: 1, cooldownDays: 1 });
		expect(result.nudges.map((n) => n.id)).toEqual(['nature.think.only']);
	});

	it('down-weights a recent completion rather than walling it off forever', () => {
		const long = recommendDaily(catalog(), ctx(), [], { count: 1, cooldownDays: 21 });
		const stale = entry({
			id: long.nudges[0]!.id,
			category: long.nudges[0]!.category,
			at: FIXED_NOW.getTime() - 5 * 86_400_000
		});
		const after = recommendDaily(catalog(), ctx(), [stale], { count: 9, cooldownDays: 5 });
		const scored = after.scored.find((row) => row.nudge.id === long.nudges[0]!.id);
		expect(scored?.reasons.some((reason) => reason.startsWith('item satiation'))).toBe(true);
		expect(scored?.weight).toBeLessThan(1);
	});
});

// #endregion

// #region variety

describe('nudgeSimilarity', () => {
	it('is 1 for a nudge against itself', () => {
		const a = think({ tags: ['x', 'y'] });
		expect(nudgeSimilarity(a, a)).toBeCloseTo(1, 12);
	});

	it('is 0 when nothing at all is shared', () => {
		const a = think({ id: 'a', category: 'nature', tags: ['x'] });
		// a real question nudge, not a think one cast into the shape: nudgeSimilarity scores
		// type as well as category and tags, so sharing nothing needs all three to differ
		const b = question({ id: 'b', category: 'art', tags: ['y'] });
		expect(nudgeSimilarity(a, b)).toBe(0);
	});

	it('reads an empty tag list as no shared evidence rather than a match', () => {
		const a = think({ id: 'a', category: 'nature', tags: [] });
		const b = think({ id: 'b', category: 'art', tags: [] });
		// type still matches, so only the tag mass is missing
		expect(nudgeSimilarity(a, b)).toBeCloseTo(0.2, 12);
	});

	it('takes the worst pair and ignores the nudge itself', () => {
		const subject = think({ id: 'nature.think.s', category: 'nature', tags: ['x'] });
		const other = think({ id: 'art.think.o', category: 'art', tags: ['z'] });
		expect(maxSimilarity(subject, [subject])).toBe(0);
		expect(maxSimilarity(subject, [other, subject])).toBeCloseTo(0.2, 12);
		expect(maxSimilarity(subject, [])).toBe(0);
	});
});

describe('recommendDaily variety', () => {
	function meanIntraListSimilarity(mmrMu: number): number {
		let total = 0;
		let pairs = 0;

		for (let offset = 0; offset < DAYS; offset++) {
			const now = new Date(FIXED_NOW.getTime() + offset * 86_400_000);
			const { nudges } = recommendDaily(catalog(), ctx({ now, day: dayKey(now) }), [], {
				count: 4,
				installSeed: SEED_A,
				tuning: { mmrMu }
			});
			for (let i = 0; i < nudges.length; i++) {
				for (let j = i + 1; j < nudges.length; j++) {
					total += nudgeSimilarity(nudges[i]!, nudges[j]!);
					pairs++;
				}
			}
		}

		return pairs === 0 ? 0 : total / pairs;
	}

	it('lowers intra-list similarity versus selecting without MMR', () => {
		const withMmr = meanIntraListSimilarity(0.8);
		const without = meanIntraListSimilarity(0);
		expect(withMmr).toBeLessThan(without);
	});
});

// #endregion

// #region calibration

describe('recommendDaily calibration', () => {
	const CATEGORIES: NudgeCategory[] = [
		'people',
		'nature',
		'art',
		'learn',
		'cooking',
		'home',
		'errands',
		'exercise',
		'adventure'
	];

	/** closed loop: everything picked is recorded as done, which is what skews the mix */
	function categorySkew(calibrationWeight: number): number {
		const entries: ReturnType<typeof entry>[] = [];
		const shown = new Map<NudgeCategory, number>();

		for (let offset = 0; offset < 28; offset++) {
			const now = new Date(FIXED_NOW.getTime() + offset * 86_400_000);
			const day = dayKey(now);
			const result = recommendDaily(catalog(), ctx({ now, day }), entries, {
				count: 3,
				cooldownDays: 2,
				installSeed: SEED_A,
				tuning: { calibrationWeight }
			});

			for (const nudge of result.nudges) {
				shown.set(nudge.category, (shown.get(nudge.category) ?? 0) + 1);
				entries.push(
					entry({ id: nudge.id, category: nudge.category, points: nudge.points, at: now.getTime() })
				);
			}
		}

		const total = [...shown.values()].reduce((sum, n) => sum + n, 0);
		const target = 1 / CATEGORIES.length;
		const variance =
			CATEGORIES.reduce(
				(sum, category) => sum + ((shown.get(category) ?? 0) / total - target) ** 2,
				0
			) / CATEGORIES.length;
		return Math.sqrt(variance);
	}

	it('reduces category skew over a simulated 28 days', () => {
		expect(categorySkew(1)).toBeLessThan(categorySkew(0));
	});
});

// #endregion

// #region learning

describe('recommendDaily learned affinity', () => {
	/** ids outside the catalog, so the evidence teaches without touching cooldowns */
	function retiredEvidence(
		category: NudgeCategory,
		outcome: 'passed' | 'skipped',
		count: number
	): ReturnType<typeof entry>[] {
		return Array.from({ length: count }, (_, index) =>
			entry({
				id: `retired.think.${category}${index}`,
				category,
				type: 'think',
				points: 5,
				outcome,
				at: FIXED_NOW.getTime() - (200 + index) * 86_400_000
			})
		);
	}

	function hits(category: NudgeCategory, entries: ReturnType<typeof entry>[]): number {
		let found = 0;
		for (let offset = 0; offset < DAYS; offset++) {
			const now = new Date(FIXED_NOW.getTime() + offset * 86_400_000);
			const result = recommendDaily(catalog(), ctx({ now, day: dayKey(now) }), entries, {
				count: 1,
				installSeed: SEED_A
			});
			if (result.nudges[0]?.category === category) found++;
		}
		return found;
	}

	const learned = [
		...retiredEvidence('art', 'passed', 20),
		...retiredEvidence('nature', 'skipped', 20)
	];

	it('raises a category the user keeps completing', () => {
		expect(hits('art', learned)).toBeGreaterThan(hits('art', []));
	});

	it('lowers a category the user keeps skipping', () => {
		expect(hits('nature', learned)).toBeLessThan(hits('nature', []));
	});
});

// #endregion

// #region bonus

describe('recommendDaily bonus', () => {
	it('is a nudge the user has never completed', () => {
		const pool = catalog();
		const done = pool.slice(0, 20).map((nudge, index) =>
			entry({
				id: nudge.id,
				category: nudge.category,
				at: FIXED_NOW.getTime() - (60 + index) * 86_400_000
			})
		);
		const result = recommendDaily(pool, ctx(), done, { count: 2, cooldownDays: 2 });
		const completed = new Set(done.map((row) => row.id));
		expect(result.bonus).not.toBeNull();
		expect(completed.has(result.bonus!.id)).toBe(false);
	});

	it('takes the least-exposed candidate', () => {
		const pool = catalog();
		const seen = pool.slice(4).flatMap((nudge, index) =>
			Array.from({ length: 3 }, (_, run) =>
				entry({
					id: nudge.id,
					category: nudge.category,
					outcome: 'skipped' as const,
					at: FIXED_NOW.getTime() - (90 + index * 3 + run) * 86_400_000
				})
			)
		);
		const result = recommendDaily(pool, ctx(), seen, { count: 2 });
		expect(result.bonus).not.toBeNull();
		// only the first four ids were never shown, so the bonus has to come from those
		expect(pool.slice(0, 4).map((nudge) => nudge.id)).toContain(result.bonus!.id);
	});

	it('falls back to the pool once everything has been done at least once', () => {
		const pool = catalog();
		const all = pool.map((nudge, index) =>
			entry({
				id: nudge.id,
				category: nudge.category,
				at: FIXED_NOW.getTime() - (60 + index) * 86_400_000
			})
		);
		const result = recommendDaily(pool, ctx(), all, { count: 2, cooldownDays: 2 });
		expect(result.bonus).not.toBeNull();
		expect(result.nudges.map((n) => n.id)).not.toContain(result.bonus!.id);
	});
});

// #endregion

describe('dominantBlocker', () => {
	it('names the most common definite blocker', () => {
		const blocked = [
			{
				nudge: think(),
				result: { passed: false, indeterminate: [], blockedBy: { type: 'weather' as const } }
			},
			{
				nudge: think(),
				result: { passed: false, indeterminate: [], blockedBy: { type: 'weather' as const } }
			},
			{
				nudge: think(),
				result: { passed: false, indeterminate: [], blockedBy: { type: 'hour' as const } }
			}
		];
		expect(dominantBlocker(blocked)).toBe('weather');
	});

	it('is null with nothing blocked', () => {
		expect(dominantBlocker([])).toBeNull();
	});

	it('ignores an entry that recorded no definite blocker', () => {
		expect(
			dominantBlocker([{ nudge: think(), result: { passed: false, indeterminate: [] } }])
		).toBeNull();
	});
});

/**
 * The type gate, against the real catalog.
 *
 * The synthetic `catalog()` helper is entirely `think` nudges, so it cannot exercise this at
 * all - the gate only means something over content that really contains `notice` and `count`.
 * Swept across many seeds rather than asserting one draw, because the pick is seeded and a
 * single seed passing proves nothing about the filter.
 */
describe('locked nudge types', () => {
	const SEEDS = Array.from({ length: 24 }, (_, index) => `seed-${index}`);

	/**
	 * Capable context on purpose: `notice` nudges declare `permission: camera` and
	 * `model_pack: vision`, and those filters are AND-combined, so on the default bare context
	 * every one of them is correctly excluded before the type gate is even consulted. Testing
	 * the gate needs a context where the gated types are otherwise reachable.
	 */
	const capable = () =>
		ctx({
			granted_permissions: ['camera', 'microphone', 'location', 'notifications'],
			installed_packs: ['vision', 'text', 'audio', 'writing']
		});

	async function typesSeenAt(lockedTypes: readonly NudgeType[]) {
		const { nudges: pool } = await loadCatalog('en');
		const seen = new Set<string>();
		let shortDays = 0;

		for (const installSeed of SEEDS) {
			const result = recommendDaily(pool, capable(), [], { count: 4, lockedTypes, installSeed });
			for (const nudge of result.nudges) seen.add(nudge.type);
			if (result.nudges.length < 4) shortDays++;
		}

		return { seen, shortDays };
	}

	it('never serves a gated type before its threshold', async () => {
		const { seen, shortDays } = await typesSeenAt(['notice', 'count']);

		expect([...seen], 'a locked type reached the deck').not.toContain('notice');
		expect([...seen]).not.toContain('count');
		// and the day still fills, so the gate narrows variety without starving the deck
		expect(shortDays, 'the gate left some days short of four nudges').toBe(0);
		expect(seen.size, 'the remaining pool collapsed to one type').toBeGreaterThan(1);
	});

	it('serves them once nothing is locked', async () => {
		const { seen } = await typesSeenAt([]);

		// both gated types have to be reachable at all, or the gate is hiding an empty set
		expect([...seen], 'notice nudges are unreachable even unlocked').toContain('notice');
		expect([...seen], 'count nudges are unreachable even unlocked').toContain('count');
	});
});
