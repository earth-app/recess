import { describe, expect, it } from 'vitest';
import type { NudgeCategory } from '~/types/nudge';
import { seededRandom } from '~/utils/day';
import type { SceneTraits, SceneTuple } from '~/utils/playground';
import {
	BIOME_THRESHOLDS,
	buildScene,
	categoryColorToken,
	clampExportScale,
	DEFAULT_ELEMENT_LIMIT,
	deriveTraits,
	EXPORT_MAX_EDGE,
	EXPORT_MAX_SCALE,
	horizonFor,
	LAYOUT_GRAMMAR_WEIGHTS,
	LAYOUT_GRAMMARS,
	MOON_TERMINATOR_STEPS,
	moonTerminatorPoints,
	MOTIF_WEIGHTS,
	MOTIFS,
	nextBiome,
	PALETTE_FAMILIES,
	PALETTE_FAMILY_WEIGHTS,
	placeElement,
	playgroundFileName,
	RESOLUTION_PRESETS,
	resolutionTarget,
	SCENE_SCHEMA_VERSION,
	scenePalette,
	sceneTupleFromLedger,
	SOCIAL_PRESETS,
	socialTarget,
	SPECIES,
	SPECIES_SKINS,
	unlockedBiomes,
	weightedChoice
} from '~/utils/playground';
import { sceneToSvg } from '~/utils/playground-render';
import { entry, FIXED_NOW } from '../helpers';

const SEED_A = '0123456789abcdef0123456789abcdef';
const SEED_B = 'fedcba9876543210fedcba9876543210';

function traits(overrides: Partial<SceneTraits> = {}): SceneTraits {
	return {
		paletteFamily: 'meadow',
		layoutGrammar: 'scatter',
		speciesSkin: 0,
		horizon: 0.62,
		lightAngle: 12,
		motif: 'none',
		...overrides
	};
}

function tuple(overrides: Partial<SceneTuple> = {}): SceneTuple {
	return {
		schemaVersion: SCENE_SCHEMA_VERSION,
		seed: SEED_A,
		traits: traits(),
		categories: [],
		startIndex: 0,
		points: 0,
		timeOfDay: 'day',
		season: 'summer',
		moonPhase: 'full',
		moonIllumination: 1,
		...overrides
	};
}

function categories(count: number, category: NudgeCategory = 'nature'): NudgeCategory[] {
	return Array.from({ length: count }, () => category);
}

/** deterministic seed corpus, so the distribution assertions below never flake */
function seedCorpus(count: number): string[] {
	return Array.from({ length: count }, (_, i) => `seed-${i.toString(16).padStart(8, '0')}`);
}

describe('unlockedBiomes', () => {
	it('always includes the meadow', () => {
		expect(unlockedBiomes(0)).toEqual(['meadow']);
	});

	it('unlocks in ascending order as points grow', () => {
		expect(unlockedBiomes(BIOME_THRESHOLDS.grove)).toContain('grove');
		expect(unlockedBiomes(BIOME_THRESHOLDS.pond)).toContain('pond');
		expect(unlockedBiomes(BIOME_THRESHOLDS.ridge)).toEqual(['meadow', 'grove', 'pond', 'ridge']);
	});

	it('does not unlock one point early', () => {
		expect(unlockedBiomes(BIOME_THRESHOLDS.grove - 1)).not.toContain('grove');
	});
});

describe('nextBiome', () => {
	it('reports the next threshold and the gap', () => {
		expect(nextBiome(0)).toEqual({ biome: 'grove', remaining: BIOME_THRESHOLDS.grove });
	});

	it('is null once everything is unlocked', () => {
		expect(nextBiome(BIOME_THRESHOLDS.ridge)).toBeNull();
	});
});

describe('categoryColorToken', () => {
	it('gives every category its own accent alias', () => {
		const tokens = (
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
		).map(categoryColorToken);
		expect(new Set(tokens).size).toBe(tokens.length);
		for (const token of tokens) expect(token.startsWith('@')).toBe(true);
	});
});

describe('weightedChoice', () => {
	it('walks the cumulative table in declaration order', () => {
		const items = ['a', 'b', 'c'] as const;
		const weights = { a: 50, b: 30, c: 20 };
		expect(weightedChoice(items, weights, 0)).toBe('a');
		expect(weightedChoice(items, weights, 0.49)).toBe('a');
		expect(weightedChoice(items, weights, 0.5)).toBe('b');
		expect(weightedChoice(items, weights, 0.79)).toBe('b');
		expect(weightedChoice(items, weights, 0.8)).toBe('c');
		expect(weightedChoice(items, weights, 0.999_999)).toBe('c');
	});

	it('clamps a roll outside 0..1 rather than falling off the table', () => {
		const items = ['a', 'b'] as const;
		const weights = { a: 1, b: 1 };
		expect(weightedChoice(items, weights, -3)).toBe('a');
		expect(weightedChoice(items, weights, 4)).toBe('b');
	});

	it('falls back to the first item when every weight is zero', () => {
		expect(weightedChoice(['a', 'b'] as const, { a: 0, b: 0 }, 0.7)).toBe('a');
	});

	it('never returns an item the table does not list', () => {
		for (const roll of [0, 0.1, 0.33, 0.5, 0.67, 0.9, 0.9999]) {
			expect(PALETTE_FAMILIES).toContain(
				weightedChoice(PALETTE_FAMILIES, PALETTE_FAMILY_WEIGHTS, roll)
			);
		}
	});
});

describe('deriveTraits', () => {
	it('is deterministic for a seed', () => {
		expect(deriveTraits(SEED_A)).toEqual(deriveTraits(SEED_A));
	});

	it('stays inside every declared range', () => {
		for (const seed of seedCorpus(120)) {
			const derived = deriveTraits(seed);
			expect(PALETTE_FAMILIES).toContain(derived.paletteFamily);
			expect(LAYOUT_GRAMMARS).toContain(derived.layoutGrammar);
			expect(MOTIFS).toContain(derived.motif);
			expect(derived.speciesSkin).toBeGreaterThanOrEqual(0);
			expect(derived.speciesSkin).toBeLessThan(SPECIES_SKINS);
			expect(derived.horizon).toBeGreaterThanOrEqual(0.55);
			expect(derived.horizon).toBeLessThanOrEqual(0.75);
			expect(derived.lightAngle).toBeGreaterThanOrEqual(-35);
			expect(derived.lightAngle).toBeLessThanOrEqual(35);
		}
	});

	it('changes structure across seeds, not just a hue', () => {
		const corpus = seedCorpus(300).map((seed) => deriveTraits(seed));
		// the point of drawing structure first: the grammar and the family both move
		expect(new Set(corpus.map((it) => it.layoutGrammar)).size).toBe(LAYOUT_GRAMMARS.length);
		expect(new Set(corpus.map((it) => it.paletteFamily)).size).toBe(PALETTE_FAMILIES.length);
		expect(new Set(corpus.map((it) => it.motif)).size).toBe(MOTIFS.length);
		expect(new Set(corpus.map((it) => it.speciesSkin)).size).toBe(SPECIES_SKINS);
		expect(new Set(corpus.map((it) => Math.round(it.horizon * 100))).size).toBeGreaterThan(10);
	});

	it('honours the rarity tiers', () => {
		const corpus = seedCorpus(600).map((seed) => deriveTraits(seed));
		const count = <T extends string>(values: T[], of: T) =>
			values.filter((value) => value === of).length;

		const families = corpus.map((it) => it.paletteFamily);
		expect(count(families, 'meadow')).toBeGreaterThan(count(families, 'sandstone'));
		expect(count(families, 'sandstone')).toBeGreaterThan(count(families, 'moonlit'));

		const grammars = corpus.map((it) => it.layoutGrammar);
		expect(count(grammars, 'scatter')).toBeGreaterThan(count(grammars, 'ridge'));
		expect(count(grammars, 'ridge')).toBeGreaterThan(count(grammars, 'spiral'));
	});

	it('re-keys when the schema version moves', () => {
		expect(deriveTraits(SEED_A, 1)).not.toEqual(deriveTraits(SEED_A, 2));
	});

	it('still produces a usable table for the pre-load empty seed', () => {
		const derived = deriveTraits('');
		expect(PALETTE_FAMILIES).toContain(derived.paletteFamily);
		expect(LAYOUT_GRAMMARS).toContain(derived.layoutGrammar);
	});

	it('sums each weight table to 100, so a weight reads as a percentage', () => {
		const total = (weights: Record<string, number>) =>
			Object.values(weights).reduce((sum, weight) => sum + weight, 0);
		expect(total(PALETTE_FAMILY_WEIGHTS)).toBe(100);
		expect(total(LAYOUT_GRAMMAR_WEIGHTS)).toBe(100);
		expect(total(MOTIF_WEIGHTS)).toBe(100);
	});
});

describe('placeElement', () => {
	it('keeps every grammar inside the frame', () => {
		for (const grammar of LAYOUT_GRAMMARS) {
			for (let index = 0; index < 200; index++) {
				const spot = placeElement(grammar, index, seededRandom(index + 1));
				expect(spot.x).toBeGreaterThanOrEqual(0);
				expect(spot.x).toBeLessThanOrEqual(1);
				expect(spot.depth).toBeGreaterThanOrEqual(0);
				expect(spot.depth).toBeLessThanOrEqual(1);
			}
		}
	});

	it('gives each grammar its own picture, not one function with knobs', () => {
		const signature = (grammar: (typeof LAYOUT_GRAMMARS)[number]) =>
			Array.from({ length: 24 }, (_, index) => {
				const spot = placeElement(grammar, index, seededRandom(index + 1));
				return `${spot.x.toFixed(3)},${spot.depth.toFixed(3)}`;
			}).join('|');

		const signatures = LAYOUT_GRAMMARS.map(signature);
		expect(new Set(signatures).size).toBe(LAYOUT_GRAMMARS.length);
	});

	it('lays terrace out on four discrete shelves', () => {
		const depths = Array.from({ length: 40 }, (_, index) =>
			Math.round(placeElement('terrace', index, seededRandom(index + 1)).depth * 10)
		);
		expect(new Set(depths).size).toBeLessThanOrEqual(8);
	});

	it('leaves the middle of a clearing open', () => {
		const middle = Array.from({ length: 120 }, (_, index) =>
			placeElement('clearing', index, seededRandom(index + 1))
		).filter((spot) => Math.hypot(spot.x - 0.5, spot.depth - 0.5) < 0.24);
		expect(middle).toHaveLength(0);
	});

	it('grows spiral outward, so newer work rings older work', () => {
		const radius = (index: number) => {
			const spot = placeElement('spiral', index, seededRandom(index + 1));
			return Math.hypot(spot.x - 0.5, spot.depth - 0.5);
		};
		expect(radius(80)).toBeGreaterThan(radius(4));
	});
});

describe('horizonFor', () => {
	it('keeps the trait horizon on a landscape frame', () => {
		expect(horizonFor(0.68, { width: 640, height: 360 })).toBe(0.68);
		expect(horizonFor(0.68, { width: 1200, height: 630 })).toBe(0.68);
	});

	it('pulls the ground line up on a portrait frame', () => {
		const story = horizonFor(0.72, { width: 1080, height: 1920 });
		expect(story).toBeLessThan(0.6);
		expect(story).toBeGreaterThan(0.5);
	});

	it('leaves a usable ground band at every preset aspect', () => {
		for (const box of [
			{ width: 360, height: 260 },
			{ width: 1080, height: 1080 },
			{ width: 1080, height: 1920 },
			{ width: 1200, height: 630 }
		]) {
			for (const horizon of [0.55, 0.65, 0.75]) {
				const line = horizonFor(horizon, box);
				expect((1 - line) * box.height).toBeGreaterThan(box.height * 0.24);
			}
		}
	});
});

describe('buildScene', () => {
	it('is empty with no history', () => {
		const scene = buildScene(tuple());
		expect(scene.elements).toEqual([]);
		expect(scene.surprise).toBeNull();
	});

	it('plants one element per category in the tuple', () => {
		expect(buildScene(tuple({ categories: categories(3) })).elements).toHaveLength(3);
	});

	it('is a pure function of its tuple', () => {
		const input = tuple({ categories: ['nature', 'art', 'people'] });
		expect(buildScene(input).elements).toEqual(buildScene(input).elements);
	});

	it('derives geometry from the seed and index, not the category', () => {
		const nature = buildScene(tuple({ categories: ['nature', 'nature'] })).elements;
		const mixed = buildScene(tuple({ categories: ['errands', 'adventure'] })).elements;

		const geometry = (elements: typeof nature) =>
			[...elements]
				.sort((a, b) => a.index - b.index)
				.map((el) => [el.index, el.x, el.depth, el.rotation, el.scale]);

		expect(geometry(mixed)).toEqual(geometry(nature));
		// only the category-derived parts differ
		expect(mixed.map((el) => el.category)).not.toEqual(nature.map((el) => el.category));
	});

	it('re-keys the whole picture when the seed changes', () => {
		const a = buildScene(tuple({ seed: SEED_A, categories: categories(12) })).elements;
		const b = buildScene(tuple({ seed: SEED_B, categories: categories(12) })).elements;
		expect(b.map((el) => el.x)).not.toEqual(a.map((el) => el.x));
	});

	it('never moves an existing element when the scene grows', () => {
		const before = buildScene(tuple({ categories: categories(9) })).elements;
		const after = buildScene(tuple({ categories: categories(30) })).elements;
		const byIndex = new Map(after.map((el) => [el.index, el]));
		for (const el of before) expect(byIndex.get(el.index)).toEqual(el);
	});

	it('keeps positions stable across the element cap via startIndex', () => {
		const full = buildScene(tuple({ categories: categories(20) })).elements;
		const capped = buildScene(tuple({ categories: categories(5), startIndex: 15 })).elements;
		const byIndex = new Map(full.map((el) => [el.index, el]));
		for (const el of capped) expect(byIndex.get(el.index)).toEqual(el);
	});

	it('only uses declared species', () => {
		for (const el of buildScene(tuple({ categories: categories(30, 'art') })).elements) {
			expect(SPECIES).toContain(el.species);
		}
	});

	it('carries the scene-wide shape skin onto every element', () => {
		const scene = buildScene(
			tuple({ traits: traits({ speciesSkin: 2 }), categories: categories(8) })
		);
		expect(new Set(scene.elements.map((el) => el.skin))).toEqual(new Set([2]));
	});

	it('sorts back to front for painting', () => {
		const depths = buildScene(tuple({ categories: categories(25) })).elements.map((el) => el.depth);
		expect([...depths].sort((a, b) => a - b)).toEqual(depths);
	});

	it('carries the biomes points have unlocked', () => {
		expect(buildScene(tuple({ points: BIOME_THRESHOLDS.pond })).biomes).toContain('pond');
	});

	it('derives an element colour from its category', () => {
		const scene = buildScene(tuple({ categories: ['art'] }));
		expect(scene.elements[0]?.colorToken).toBe(categoryColorToken('art'));
	});

	it('places a surprise in front when one lands', () => {
		let found = 0;
		for (let count = 1; count <= 60; count++) {
			const scene = buildScene(tuple({ categories: categories(count) }));
			if (!scene.surprise) continue;
			found += 1;
			expect(scene.surprise.layer).toBe('front');
			expect(['bird', 'kite']).toContain(scene.surprise.species);
			expect(scene.surprise.index).toBe(count);
		}
		expect(found).toBeGreaterThan(0);
	});
});

describe('sceneTupleFromLedger', () => {
	const base = {
		seed: SEED_A,
		points: 0,
		timeOfDay: 'day' as const,
		season: 'summer' as const,
		moonPhase: 'full' as const,
		moonIllumination: 1
	};

	it('ignores skipped entries', () => {
		const entries = [entry({ id: 'a' }), entry({ id: 'b', outcome: 'skipped' })];
		expect(sceneTupleFromLedger({ ...base, entries }).categories).toHaveLength(1);
	});

	it('orders the categories oldest first', () => {
		const entries = [
			entry({ category: 'art', at: FIXED_NOW.getTime() + 20 }),
			entry({ category: 'home', at: FIXED_NOW.getTime() })
		];
		expect(sceneTupleFromLedger({ ...base, entries }).categories).toEqual(['home', 'art']);
	});

	it('caps the element count and keeps the most recent', () => {
		const entries = Array.from({ length: DEFAULT_ELEMENT_LIMIT + 25 }, (_, i) =>
			entry({ id: `n${i}`, at: FIXED_NOW.getTime() + i })
		);
		const built = sceneTupleFromLedger({ ...base, entries });
		expect(built.categories).toHaveLength(DEFAULT_ELEMENT_LIMIT);
		expect(built.startIndex).toBe(25);
	});

	it('honours a custom limit', () => {
		const entries = Array.from({ length: 10 }, (_, i) =>
			entry({ id: `n${i}`, at: FIXED_NOW.getTime() + i })
		);
		const built = sceneTupleFromLedger({ ...base, entries, limit: 3 });
		expect(built.categories).toHaveLength(3);
		expect(built.startIndex).toBe(7);
	});

	it('derives the trait table from the seed when none is supplied', () => {
		expect(sceneTupleFromLedger({ ...base, entries: [] }).traits).toEqual(deriveTraits(SEED_A));
	});
});

describe('scenePalette', () => {
	it('darkens at night', () => {
		expect(scenePalette({ traits: traits(), timeOfDay: 'day', season: 'summer' }).night).toBe(0);
		expect(scenePalette({ traits: traits(), timeOfDay: 'night', season: 'summer' }).night).toBe(1);
	});

	it('gives dawn and dusk an intermediate night factor', () => {
		for (const timeOfDay of ['dawn', 'dusk'] as const) {
			const palette = scenePalette({ traits: traits(), timeOfDay, season: 'summer' });
			expect(palette.night).toBeGreaterThan(0);
			expect(palette.night).toBeLessThan(1);
		}
	});

	it('tints the ground by season', () => {
		const summer = scenePalette({ traits: traits(), timeOfDay: 'day', season: 'summer' });
		const winter = scenePalette({ traits: traits(), timeOfDay: 'day', season: 'winter' });
		expect(summer.ground).not.toBe(winter.ground);
	});

	it('gives every family its own dawn, not the same dawn re-tinted', () => {
		const dawns = PALETTE_FAMILIES.map(
			(paletteFamily) =>
				scenePalette({ traits: traits({ paletteFamily }), timeOfDay: 'dawn', season: 'spring' })
					.skyBottom
		);
		expect(new Set(dawns).size).toBe(PALETTE_FAMILIES.length);
	});

	it('replaces the whole ladder per family, at every hour', () => {
		for (const timeOfDay of ['dawn', 'day', 'dusk', 'night'] as const) {
			const tops = PALETTE_FAMILIES.map(
				(paletteFamily) =>
					scenePalette({ traits: traits({ paletteFamily }), timeOfDay, season: 'summer' }).skyTop
			);
			expect(new Set(tops).size).toBe(PALETTE_FAMILIES.length);
		}
	});

	it('emits hex, so both painters can read a palette value back', () => {
		const palette = scenePalette({ traits: traits(), timeOfDay: 'dusk', season: 'autumn' });
		for (const value of [
			palette.skyTop,
			palette.skyBottom,
			palette.ground,
			palette.groundShadow,
			palette.hill,
			palette.light,
			palette.waterTop,
			palette.waterBottom
		]) {
			expect(value).toMatch(/^#[0-9a-f]{6}$/);
		}
	});
});

describe('moonTerminatorPoints', () => {
	it('samples the limb and the terminator at a fixed step count', () => {
		expect(moonTerminatorPoints(10, 0.5, false)).toHaveLength((MOON_TERMINATOR_STEPS + 1) * 2);
	});

	it('is a full disc at full moon and a hairline at new', () => {
		const full = moonTerminatorPoints(10, 1, false);
		expect(Math.min(...full.map((p) => p.x))).toBeCloseTo(-10, 5);
		expect(Math.max(...full.map((p) => p.x))).toBeCloseTo(10, 5);

		const none = moonTerminatorPoints(10, 0, false);
		expect(Math.max(...none.map((p) => Math.abs(p.x)))).toBeCloseTo(10, 5);
		// at new moon the terminator sits on the limb, so the lit area collapses
		expect(none.filter((p) => p.x < 0)).toHaveLength(0);
	});

	it('mirrors the lit limb when the moon is waning', () => {
		const waxing = moonTerminatorPoints(10, 0.25, false);
		const waning = moonTerminatorPoints(10, 0.25, true);
		expect(waning.map((p) => p.x)).toEqual(waxing.map((p) => -p.x));
	});

	/**
	 * The property that actually matters: the enclosed area equals the illuminated fraction
	 * of the disc. A half-circle limb closed by a half-ellipse of semi-minor axis
	 * `r(1 - 2 * lit)` is the exact shape, and this proves the sampling preserves it -
	 * including where the ellipse degenerates to a line (half) or back to the limb (new and
	 * full), which is why a sampled polygon is correct here and arcs would risk a flag flip.
	 */
	it('encloses the illuminated fraction of the disc at every phase', () => {
		const radius = 20;
		const disc = Math.PI * radius * radius;

		const shoelace = (points: { x: number; y: number }[]) => {
			let sum = 0;
			for (let index = 0; index < points.length; index++) {
				const a = points[index]!;
				const b = points[(index + 1) % points.length]!;
				sum += a.x * b.y - b.x * a.y;
			}
			return Math.abs(sum) / 2;
		};

		for (const lit of [0, 0.25, 0.5, 0.75, 1]) {
			const fraction = shoelace(moonTerminatorPoints(radius, lit, false)) / disc;
			// a 24-segment polygon inscribes the circle, so it runs ~0.3% light, evenly
			expect(fraction).toBeGreaterThanOrEqual(lit - 0.004);
			expect(fraction).toBeLessThanOrEqual(lit + 0.001);
		}
	});

	it('clamps an out-of-range illumination instead of inverting the shape', () => {
		expect(moonTerminatorPoints(10, -0.5, false)).toEqual(moonTerminatorPoints(10, 0, false));
		expect(moonTerminatorPoints(10, 1.5, false)).toEqual(moonTerminatorPoints(10, 1, false));
	});
});

describe('sceneToSvg', () => {
	const scene = buildScene(
		tuple({
			categories: [
				'nature',
				'art',
				'people',
				'adventure',
				'cooking',
				'errands',
				'exercise',
				'home',
				'learn'
			],
			points: BIOME_THRESHOLDS.ridge,
			traits: traits({ motif: 'fireflies' }),
			timeOfDay: 'night',
			moonIllumination: 0.3,
			moonPhase: 'waxing_crescent'
		})
	);

	it('parses as xml', () => {
		const doc = new DOMParser().parseFromString(
			sceneToSvg(scene, { width: 640, height: 360 }),
			'application/xml'
		);
		expect(doc.querySelector('parsererror')).toBeNull();
		expect(doc.documentElement.nodeName.toLowerCase()).toBe('svg');
	});

	it('carries a viewBox that matches the requested size', () => {
		const doc = new DOMParser().parseFromString(
			sceneToSvg(scene, { width: 800, height: 450 }),
			'application/xml'
		);
		expect(doc.documentElement.getAttribute('viewBox')).toBe('0 0 800 450');
		expect(doc.documentElement.getAttribute('width')).toBe('800');
		expect(doc.documentElement.getAttribute('height')).toBe('450');
	});

	it('is byte-identical for identical inputs', () => {
		const options = { width: 640, height: 360, title: 'A Playground' };
		expect(sceneToSvg(scene, options)).toBe(sceneToSvg(scene, options));
	});

	it('changes with the scene', () => {
		const other = buildScene(
			tuple({ seed: SEED_B, categories: categories(9), traits: deriveTraits(SEED_B) })
		);
		expect(sceneToSvg(other, { width: 640, height: 360 })).not.toBe(
			sceneToSvg(scene, { width: 640, height: 360 })
		);
	});

	it('is real vector output, not a raster wrapped in svg', () => {
		const svg = sceneToSvg(scene, { width: 640, height: 360 });
		expect(svg).not.toContain('<image');
		expect(svg).not.toContain('data:image');
		expect(svg.match(/<path /g)?.length ?? 0).toBeGreaterThan(10);
		expect(svg).toContain('<linearGradient');
		expect(svg).toContain('<radialGradient');
	});

	it('is self-contained, with nothing to fetch', () => {
		const svg = sceneToSvg(scene, { width: 640, height: 360 });
		expect(svg).not.toContain('<script');
		expect(svg).not.toContain('@font-face');
		expect(svg).not.toContain('font-family');
		expect(svg).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
		// the only href-shaped references are the internal defs
		for (const match of svg.matchAll(/url\(([^)]+)\)/g)) {
			expect(match[1]?.startsWith('#')).toBe(true);
		}
	});

	it('escapes a title rather than emitting raw markup', () => {
		const svg = sceneToSvg(scene, { width: 320, height: 200, title: 'Ben & <Jerry>' });
		expect(svg).toContain('<title>Ben &amp; &lt;Jerry&gt;</title>');
		expect(
			new DOMParser().parseFromString(svg, 'application/xml').querySelector('parsererror')
		).toBeNull();
	});

	it('renders every grammar, family, skin and motif without breaking xml', () => {
		for (const paletteFamily of PALETTE_FAMILIES) {
			for (const layoutGrammar of LAYOUT_GRAMMARS) {
				for (const motif of MOTIFS) {
					for (let speciesSkin = 0; speciesSkin < SPECIES_SKINS; speciesSkin++) {
						const built = buildScene(
							tuple({
								traits: traits({ paletteFamily, layoutGrammar, speciesSkin, motif }),
								categories: categories(9, 'adventure'),
								points: BIOME_THRESHOLDS.ridge
							})
						);
						const doc = new DOMParser().parseFromString(
							sceneToSvg(built, { width: 400, height: 240 }),
							'application/xml'
						);
						expect(doc.querySelector('parsererror')).toBeNull();
					}
				}
			}
		}
	});

	it('renders every season and hour without breaking xml', () => {
		for (const season of ['spring', 'summer', 'autumn', 'winter'] as const) {
			for (const timeOfDay of ['dawn', 'day', 'dusk', 'night'] as const) {
				const built = buildScene(
					tuple({
						season,
						timeOfDay,
						categories: categories(9, 'nature'),
						points: BIOME_THRESHOLDS.ridge
					})
				);
				const doc = new DOMParser().parseFromString(
					sceneToSvg(built, { width: 400, height: 240 }),
					'application/xml'
				);
				expect(doc.querySelector('parsererror')).toBeNull();
			}
		}
	});

	it('draws an empty playground rather than nothing', () => {
		const svg = sceneToSvg(buildScene(tuple()), { width: 320, height: 200 });
		expect(svg).toContain('<rect');
		expect(
			new DOMParser().parseFromString(svg, 'application/xml').querySelector('parsererror')
		).toBeNull();
	});
});

describe('export targets', () => {
	const box = { width: 360, height: 260 };

	it('keeps the on-screen size at Original', () => {
		expect(resolutionTarget(box, null)).toEqual({
			sceneWidth: 360,
			sceneHeight: 260,
			width: 360,
			height: 260,
			scale: 1
		});
	});

	it('scales the longest edge toward each preset, aspect preserved', () => {
		expect(resolutionTarget(box, 1280)).toEqual({
			sceneWidth: 360,
			sceneHeight: 260,
			width: 1280,
			height: 924,
			scale: 1280 / 360
		});
		expect(resolutionTarget(box, 1920)).toEqual({
			sceneWidth: 360,
			sceneHeight: 260,
			width: 1920,
			height: 1387,
			scale: 1920 / 360
		});
	});

	it('clamps the 3K preset to the 6x scale ceiling on a phone-sized scene', () => {
		const target = resolutionTarget(box, EXPORT_MAX_EDGE);
		expect(target.scale).toBe(EXPORT_MAX_SCALE);
		expect(target).toMatchObject({ width: 2160, height: 1560 });
	});

	it('reaches the named edge when the scene is large enough', () => {
		expect(resolutionTarget({ width: 640, height: 360 }, 1920)).toMatchObject({
			width: 1920,
			height: 1080
		});
	});

	it('never exports past the 3K ceiling', () => {
		for (const preset of RESOLUTION_PRESETS) {
			const target = resolutionTarget({ width: 1600, height: 900 }, preset.edge);
			expect(Math.max(target.width, target.height)).toBeLessThanOrEqual(EXPORT_MAX_EDGE);
		}
	});

	it('gives every social preset its exact frame', () => {
		expect(socialTarget(SOCIAL_PRESETS[0])).toEqual({
			sceneWidth: 1080,
			sceneHeight: 1080,
			width: 1080,
			height: 1080,
			scale: 1
		});
		expect(socialTarget(SOCIAL_PRESETS[1])).toEqual({
			sceneWidth: 1080,
			sceneHeight: 1920,
			width: 1080,
			height: 1920,
			scale: 1
		});
		expect(socialTarget(SOCIAL_PRESETS[2])).toEqual({
			sceneWidth: 1200,
			sceneHeight: 630,
			width: 1200,
			height: 630,
			scale: 1
		});
	});

	it('re-lays the scene out in a social frame rather than stretching it', () => {
		for (const preset of SOCIAL_PRESETS) {
			const target = socialTarget(preset);
			expect(target.sceneWidth / target.sceneHeight).toBeCloseTo(target.width / target.height, 6);
			expect(target.scale).toBe(1);
		}
	});

	it('clamps a nonsense scale', () => {
		expect(clampExportScale(Number.NaN)).toBe(1);
		expect(clampExportScale(0.2)).toBe(1);
		expect(clampExportScale(99)).toBe(EXPORT_MAX_SCALE);
	});

	it('names the file after the day it was made', () => {
		expect(playgroundFileName('png', '2026-07-27')).toBe('recess-playground-2026-07-27.png');
		expect(playgroundFileName('svg', '2026/07/27')).toBe('recess-playground-2026-07-27.svg');
	});
});
