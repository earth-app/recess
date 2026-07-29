import type { LedgerEntry } from '~/types/context';
import type { MoonPhase, NudgeCategory, Season, TimeOfDay } from '~/types/nudge';
import { parseColor, toHex } from '~/utils/color';
import { hashString, seededRandom } from '~/utils/day';

// #region color

const FALLBACK_COLOR = '#2d9973';

function asHex(token: string): string {
	const parsed = parseColor(token);
	return parsed ? toHex({ ...parsed, a: 1 }) : FALLBACK_COLOR;
}

/** srgb mix that stays hex, so a palette value round-trips through both painters */
export function mixHex(from: string, to: string, amount: number): string {
	const a = parseColor(from);
	const b = parseColor(to);
	if (!a || !b) return asHex(from);
	const k = amount < 0 ? 0 : amount > 1 ? 1 : amount;
	return toHex({
		r: a.r + (b.r - a.r) * k,
		g: a.g + (b.g - a.g) * k,
		b: a.b + (b.b - a.b) * k,
		a: 1
	});
}

/** positive lightens toward white, negative darkens toward black */
export function shadeHex(color: string, amount: number): string {
	return amount >= 0 ? mixHex(color, '#ffffff', amount) : mixHex(color, '#000000', -amount);
}

export const NIGHT_TINT = '#10182e';

/** desaturate, then cool toward the night sky; 0 leaves the color untouched */
export function dimHex(color: string, night: number): string {
	const parsed = parseColor(color);
	if (!parsed) return FALLBACK_COLOR;
	if (night <= 0) return toHex({ ...parsed, a: 1 });
	const lum = 0.2126 * parsed.r + 0.7152 * parsed.g + 0.0722 * parsed.b;
	const grey = toHex({ r: lum, g: lum, b: lum, a: 1 });
	return mixHex(mixHex(toHex({ ...parsed, a: 1 }), grey, night * 0.5), NIGHT_TINT, night * 0.45);
}

export function rgbaCss(color: string, alpha: number): string {
	const parsed = parseColor(color) ?? { r: 45, g: 153, b: 115, a: 1 };
	const byte = (n: number) => Math.round(n < 0 ? 0 : n > 255 ? 255 : n);
	const a = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
	return `rgba(${byte(parsed.r)}, ${byte(parsed.g)}, ${byte(parsed.b)}, ${a.toFixed(3)})`;
}

// #endregion

// #region species

export const SPECIES = [
	'tree',
	'shrub',
	'flower',
	'grass',
	'rock',
	'water',
	'bird',
	'lantern',
	'kite',
	'swing',
	'tent',
	'sprout'
] as const;
export type Species = (typeof SPECIES)[number];

/** each category plants its own kinds of thing, so the scene reads as a record */
const CATEGORY_SPECIES: Record<NudgeCategory, readonly Species[]> = {
	nature: ['tree', 'shrub', 'flower', 'bird'],
	art: ['kite', 'lantern', 'flower'],
	cooking: ['sprout', 'shrub', 'grass'],
	people: ['swing', 'lantern', 'bird'],
	exercise: ['grass', 'rock', 'bird'],
	learn: ['lantern', 'sprout', 'tree'],
	home: ['lantern', 'shrub', 'swing'],
	errands: ['rock', 'grass', 'lantern'],
	adventure: ['tent', 'rock', 'water']
};

const CATEGORY_COLORS: Record<NudgeCategory, string> = {
	people: '@yellow',
	adventure: '@blue',
	home: '@coral',
	learn: '@gold',
	cooking: '@orange',
	nature: '@green',
	errands: '@brown',
	exercise: '@red',
	art: '@purple'
};

export function categoryColorToken(category: NudgeCategory): string {
	return CATEGORY_COLORS[category];
}

// #endregion

// #region biomes

export const BIOMES = ['meadow', 'grove', 'pond', 'ridge'] as const;
export type Biome = (typeof BIOMES)[number];

/** points scale the scene; they never buy anything */
export const BIOME_THRESHOLDS: Record<Biome, number> = {
	meadow: 0,
	grove: 400,
	pond: 1200,
	ridge: 2600
};

export function unlockedBiomes(points: number): Biome[] {
	return BIOMES.filter((biome) => points >= BIOME_THRESHOLDS[biome]);
}

export function nextBiome(points: number): { biome: Biome; remaining: number } | null {
	for (const biome of BIOMES) {
		if (points < BIOME_THRESHOLDS[biome]) {
			return { biome, remaining: BIOME_THRESHOLDS[biome] - points };
		}
	}
	return null;
}

// #endregion

// #region traits

export const SCENE_SCHEMA_VERSION = 1;

export const PALETTE_FAMILIES = [
	'meadow',
	'ember',
	'pine',
	'sandstone',
	'orchid',
	'moonlit'
] as const;
export type PaletteFamily = (typeof PALETTE_FAMILIES)[number];

/** rarity tiers; a cumulative-weight pick turns these into how often a family shows up */
export const PALETTE_FAMILY_WEIGHTS: Record<PaletteFamily, number> = {
	meadow: 30,
	ember: 25,
	pine: 20,
	sandstone: 15,
	orchid: 7,
	moonlit: 3
};

export const LAYOUT_GRAMMARS = ['scatter', 'terrace', 'clearing', 'ridge', 'spiral'] as const;
export type LayoutGrammar = (typeof LAYOUT_GRAMMARS)[number];

export const LAYOUT_GRAMMAR_WEIGHTS: Record<LayoutGrammar, number> = {
	scatter: 35,
	terrace: 25,
	clearing: 20,
	ridge: 15,
	spiral: 5
};

export const MOTIFS = ['none', 'fireflies', 'drifting_seeds', 'low_mist', 'flock'] as const;
export type Motif = (typeof MOTIFS)[number];

export const MOTIF_WEIGHTS: Record<Motif, number> = {
	none: 45,
	fireflies: 20,
	drifting_seeds: 15,
	low_mist: 13,
	flock: 7
};

/** three shape variants per species, chosen once per install rather than per element */
export const SPECIES_SKINS = 3;

export interface SceneTraits {
	/** supplies all four time-of-day palettes; dawn in one family is not dawn in another */
	paletteFamily: PaletteFamily;
	/** names the placement algorithm outright; grammars are not one function with knobs */
	layoutGrammar: LayoutGrammar;
	/** 0..2, shared by every element so the scene reads as one hand */
	speciesSkin: number;
	/** ground line as a fraction of the frame height, 0.55..0.75 */
	horizon: number;
	/** degrees; negative lights the scene from the left, positive from the right */
	lightAngle: number;
	/** an ambient overlay, usually absent */
	motif: Motif;
}

/**
 * Pick one item, probability proportional to weight, from a single roll in [0,1).
 *
 * A cumulative-weight table rather than repeated draws, so the rarity tiers read
 * straight off the weights and the pick costs exactly one rng value.
 */
export function weightedChoice<T extends string>(
	items: readonly T[],
	weights: Record<T, number>,
	roll: number
): T {
	const first = items[0];
	if (first === undefined) throw new Error('weightedChoice needs at least one item');

	let total = 0;
	for (const item of items) total += Math.max(0, weights[item]);
	if (total <= 0) return first;

	const clamped = roll < 0 ? 0 : roll >= 1 ? 0.999_999_999 : roll;
	let target = clamped * total;
	for (const item of items) {
		target -= Math.max(0, weights[item]);
		if (target < 0) return item;
	}
	return items[items.length - 1] as T;
}

/**
 * The trait table for one install.
 *
 * Draw order is part of the contract - palette family, grammar, skin, horizon, light,
 * motif - because a reordered draw would re-key every existing install's picture.
 */
export function deriveTraits(seed: string, version = SCENE_SCHEMA_VERSION): SceneTraits {
	const rng = seededRandom(hashString(`recess:traits:v${version}:${seed}`));
	return {
		paletteFamily: weightedChoice(PALETTE_FAMILIES, PALETTE_FAMILY_WEIGHTS, rng()),
		layoutGrammar: weightedChoice(LAYOUT_GRAMMARS, LAYOUT_GRAMMAR_WEIGHTS, rng()),
		speciesSkin: Math.min(SPECIES_SKINS - 1, Math.floor(rng() * SPECIES_SKINS)),
		horizon: 0.55 + rng() * 0.2,
		lightAngle: -35 + rng() * 70,
		motif: weightedChoice(MOTIFS, MOTIF_WEIGHTS, rng())
	};
}

// #endregion

// #region palette

export interface ScenePalette {
	skyTop: string;
	skyBottom: string;
	ground: string;
	groundShadow: string;
	/** distant hill / grove band before haze */
	hill: string;
	light: string;
	waterTop: string;
	waterBottom: string;
	/** 0 in daylight, 1 at night; dims every element */
	night: number;
}

interface FamilyPalette {
	/** sky top at full day and at full night; every hour between is a mix of the two */
	skyTop: readonly [string, string];
	skyHorizon: readonly [string, string];
	/** what the horizon warms toward at dusk and at dawn */
	dusk: string;
	dawn: string;
	ground: string;
	groundShadow: string;
	hill: string;
	light: readonly [string, string];
	water: readonly [string, string];
}

// `meadow` carries crust's exact sky and hill values, so the common case reads the same
// across the two apps; the other five are recess palette aliases pushed into a family
const FAMILY_PALETTES: Record<PaletteFamily, FamilyPalette> = {
	meadow: {
		skyTop: ['#a9dcf5', '#0a1836'],
		skyHorizon: ['#fbe4c0', '#243056'],
		dusk: '#f59e42',
		dawn: '#fca5a5',
		ground: '#5aa06a',
		groundShadow: '#3f7d4f',
		hill: '#6fb587',
		light: ['#fff7d6', '#cfd9ff'],
		water: ['#63b3ed', '#3182ce']
	},
	ember: {
		skyTop: ['#8fc7e8', '#1b1030'],
		skyHorizon: ['#ffd9b0', '#3a1f38'],
		dusk: '#ff7f6b',
		dawn: '#ffb300',
		ground: '#9c6b4f',
		groundShadow: '#6b4530',
		hill: '#c08a5c',
		light: ['#fff1d0', '#ffd7a8'],
		water: ['#7fb8c9', '#2f6f80']
	},
	pine: {
		skyTop: ['#8fd0e0', '#061826'],
		skyHorizon: ['#dff2ef', '#123037'],
		dusk: '#17a2a2',
		dawn: '#8bc34a',
		ground: '#2f6b52',
		groundShadow: '#1c4433',
		hill: '#3f8465',
		light: ['#eafff7', '#bfe6dd'],
		water: ['#4fb3a5', '#1f6b62']
	},
	sandstone: {
		skyTop: ['#bfe0f2', '#191024'],
		skyHorizon: ['#ffeccb', '#3b2a2f'],
		dusk: '#ffd700',
		dawn: '#ffb300',
		ground: '#c2a26a',
		groundShadow: '#8b6a3c',
		hill: '#d9bc85',
		light: ['#fff8e0', '#e6d3a8'],
		water: ['#79b6c9', '#3a7288']
	},
	orchid: {
		skyTop: ['#cfc2f0', '#150a2c'],
		skyHorizon: ['#ffdcf0', '#2a1440'],
		dusk: '#9b59b6',
		dawn: '#e91e63',
		ground: '#6b5a86',
		groundShadow: '#3f3357',
		hill: '#8b76a8',
		light: ['#fdeaff', '#d8c6ff'],
		water: ['#8a7fd6', '#4a3f9c']
	},
	moonlit: {
		skyTop: ['#9fb6d8', '#050a1c'],
		skyHorizon: ['#e2ecf7', '#141c3a'],
		dusk: '#5b6ee1',
		dawn: '#a9b6e8',
		ground: '#42506b',
		groundShadow: '#252d40',
		hill: '#5a6a88',
		light: ['#f4f8ff', '#e6ecff'],
		water: ['#6b7fc4', '#2c3a6b']
	}
};

export const NIGHT_FACTORS: Record<TimeOfDay, number> = {
	dawn: 0.55,
	day: 0,
	dusk: 0.68,
	night: 1
};

const SEASON_TINTS: Record<Season, readonly [string, number] | null> = {
	autumn: ['#a9843f', 0.22],
	winter: ['#e2eef6', 0.55],
	spring: ['#bce8a8', 0.18],
	summer: null
};

/** the ground and the distant hill bands share one season tint, so they stay a set */
export function seasonTint(base: string, season: Season): string {
	const tint = SEASON_TINTS[season];
	return tint ? mixHex(base, tint[0], tint[1]) : asHex(base);
}

export const AUTUMN_FOLIAGE = ['#d97706', '#b45309', '#dc2626', '#ea580c', '#ca8a04'] as const;

/** null in winter, when everything leafy goes bare */
export function foliageFor(color: string, season: Season, pick: number): string | null {
	switch (season) {
		case 'winter':
			return null;
		case 'autumn': {
			const index =
				((pick % AUTUMN_FOLIAGE.length) + AUTUMN_FOLIAGE.length) % AUTUMN_FOLIAGE.length;
			return mixHex(color, AUTUMN_FOLIAGE[index] as string, 0.55);
		}
		case 'spring':
			return mixHex(color, '#bce8a8', 0.2);
		default:
			return asHex(color);
	}
}

export interface PaletteMoment {
	traits: SceneTraits;
	timeOfDay: TimeOfDay;
	season: Season;
}

export function scenePalette(moment: PaletteMoment): ScenePalette {
	const family = FAMILY_PALETTES[moment.traits.paletteFamily] ?? FAMILY_PALETTES.meadow;
	const night = NIGHT_FACTORS[moment.timeOfDay];

	let skyTop = mixHex(family.skyTop[0], family.skyTop[1], night);
	let skyBottom = mixHex(family.skyHorizon[0], family.skyHorizon[1], night);
	if (moment.timeOfDay === 'dusk') skyBottom = mixHex(skyBottom, family.dusk, 0.28);
	else if (moment.timeOfDay === 'dawn') skyBottom = mixHex(skyBottom, family.dawn, 0.24);
	if (moment.season === 'winter') skyTop = mixHex(skyTop, '#cfe3f2', 0.12);

	return {
		skyTop,
		skyBottom,
		ground: dimHex(seasonTint(family.ground, moment.season), night),
		groundShadow: dimHex(seasonTint(family.groundShadow, moment.season), night),
		hill: dimHex(seasonTint(family.hill, moment.season), night),
		light: mixHex(family.light[0], family.light[1], night),
		waterTop: dimHex(family.water[0], night),
		waterBottom: dimHex(family.water[1], night),
		night
	};
}

// #endregion

// #region layout grammars

export interface Placement {
	/** 0..1 across the ground */
	x: number;
	/** 0..1 depth into the scene; drives scale, layer and painter order */
	depth: number;
}

const GOLDEN = 0.618_033_988_75;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const TERRACE_BANDS = 4;
const SPIRAL_TIGHTNESS = 26;

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * van der Corput radical inverse, base 2.
 *
 * Spreads a growing index evenly over 0..1 without knowing the total, which is what
 * lets a grammar place element 40 without moving elements 0..39. A flat rng() clumps;
 * a count-dependent stride would reshuffle the whole picture on every completion.
 */
function radicalInverse(index: number): number {
	let bits = index + 1;
	let out = 0;
	let denominator = 0.5;
	while (bits > 0) {
		out += (bits & 1) * denominator;
		bits >>= 1;
		denominator /= 2;
	}
	return out;
}

/** an even field; golden-ratio stride across x, radical-inverse depth */
function placeScatter(index: number, rng: () => number): Placement {
	return {
		x: clamp01(0.06 + (((index + 1) * GOLDEN + rng() * 0.09) % 1) * 0.88),
		depth: clamp01(radicalInverse(index) * 0.94 + rng() * 0.06)
	};
}

/** four flat shelves; each new element steps down to the next one */
function placeTerrace(index: number, rng: () => number): Placement {
	const band = index % TERRACE_BANDS;
	const row = Math.floor(index / TERRACE_BANDS);
	const stride = (row + 1) * (1 - GOLDEN) + band * 0.17 + rng() * 0.04;
	return {
		x: clamp01(0.08 + (stride % 1) * 0.84),
		depth: clamp01(0.1 + band * (0.84 / (TERRACE_BANDS - 1)) + (rng() - 0.5) * 0.04)
	};
}

/** an annulus; the middle of the frame is left deliberately open */
function placeClearing(index: number, rng: () => number): Placement {
	const angle = index * GOLDEN_ANGLE + rng() * 0.06;
	const radius = Math.sqrt(0.4 + 0.6 * radicalInverse(index));
	return {
		x: clamp01(0.5 + Math.cos(angle) * radius * 0.44),
		depth: clamp01(0.5 + Math.sin(angle) * radius * 0.46)
	};
}

/** one wobbling diagonal; everything queues along a single slope */
function placeRidgeLine(index: number, rng: () => number): Placement {
	const t = radicalInverse(index);
	return {
		x: clamp01(0.07 + t * 0.86 + (rng() - 0.5) * 0.03),
		depth: clamp01(0.16 + t * 0.68 + Math.sin(t * 7.5 + 1.3) * 0.11)
	};
}

/** phyllotaxis growing outward, so newer work rings older work */
function placeSpiral(index: number, rng: () => number): Placement {
	const angle = index * GOLDEN_ANGLE;
	const radius = Math.sqrt(index / (index + SPIRAL_TIGHTNESS));
	return {
		x: clamp01(0.5 + Math.cos(angle) * radius * 0.43 + (rng() - 0.5) * 0.02),
		depth: clamp01(0.5 + Math.sin(angle) * radius * 0.45 + (rng() - 0.5) * 0.02)
	};
}

const GRAMMAR_PLACERS: Record<LayoutGrammar, (index: number, rng: () => number) => Placement> = {
	scatter: placeScatter,
	terrace: placeTerrace,
	clearing: placeClearing,
	ridge: placeRidgeLine,
	spiral: placeSpiral
};

/** the grammar IS the placement function; one function with knobs would only re-tint */
export function placeElement(grammar: LayoutGrammar, index: number, rng: () => number): Placement {
	return (GRAMMAR_PLACERS[grammar] ?? placeScatter)(index, rng);
}

/** below this aspect the ground band starts losing to empty sky */
const WIDE_ASPECT = 1.2;
const TALL_HORIZON = 0.52;

/**
 * Where the ground line falls in a given frame.
 *
 * The trait horizon is tuned for a landscape card. Left alone it turns a 1080x1920
 * story frame into three quarters empty sky, so an extreme aspect pulls the line back
 * toward the middle; a landscape frame keeps the trait exactly.
 */
export function horizonFor(horizon: number, box: SceneBox): number {
	const aspect = Math.max(0.01, box.width) / Math.max(0.01, box.height);
	const tall = clamp01((WIDE_ASPECT - aspect) / 0.7);
	return horizon * (1 - tall) + TALL_HORIZON * tall;
}

// #endregion

// #region scene

export type Layer = 'back' | 'mid' | 'front';

export interface PlaygroundElement {
	/** absolute position in the planted ledger; the derivation's only per-element input */
	index: number;
	species: Species;
	/** 0..2 shape variant; carried per element so painters need no trait lookup */
	skin: number;
	category: NudgeCategory;
	colorToken: string;
	x: number;
	depth: number;
	/** size jitter, 0.86..1.14; perspective comes from depth at layout time */
	scale: number;
	rotation: number;
	layer: Layer;
	seed: number;
}

/**
 * Everything a scene needs, and nothing that ties it to storage.
 *
 * Geometry is derived from `(seed, index)`, so an element carries only its category -
 * four bits - and the receiver re-derives species, position, depth, scale and rotation.
 * That is what lets a scene travel as a short payload instead of a full element list.
 */
export interface SceneTuple {
	/** which derivation rules to apply; see SCENE_SCHEMA_VERSION */
	schemaVersion: number;
	/** the per-install seed; `''` degrades to a shared default rather than throwing */
	seed: string;
	traits: SceneTraits;
	/** one per planted element, oldest first */
	categories: readonly NudgeCategory[];
	/** absolute index of `categories[0]`, so capping the front never moves anything */
	startIndex: number;
	points: number;
	timeOfDay: TimeOfDay;
	season: Season;
	moonPhase: MoonPhase;
	moonIllumination: number;
}

export interface PlaygroundScene {
	schemaVersion: number;
	seed: string;
	traits: SceneTraits;
	elements: PlaygroundElement[];
	biomes: Biome[];
	points: number;
	timeOfDay: TimeOfDay;
	season: Season;
	moonPhase: MoonPhase;
	moonIllumination: number;
	/** an unannounced extra that shows up on its own; never advertised beforehand */
	surprise: PlaygroundElement | null;
}

export const DEFAULT_ELEMENT_LIMIT = 160;

/** 1 in this many scenes brings something unexpected along with it */
export const SURPRISE_ODDS = 14;

function sceneSeedFor(seed: string, version: number): number {
	return hashString(`recess:scene:v${version}:${seed}`);
}

function elementFor(
	sceneSeed: number,
	traits: SceneTraits,
	category: NudgeCategory,
	index: number
): PlaygroundElement {
	const seed = hashString(`${sceneSeed}:${index}`);
	const rng = seededRandom(seed);

	const pool = CATEGORY_SPECIES[category] ?? CATEGORY_SPECIES.nature;
	const species = pool[Math.floor(rng() * pool.length)] as Species;
	const { x, depth } = placeElement(traits.layoutGrammar, index, rng);
	const layer: Layer = depth < 0.33 ? 'back' : depth < 0.7 ? 'mid' : 'front';

	return {
		index,
		species,
		skin: traits.speciesSkin,
		category,
		colorToken: CATEGORY_COLORS[category] ?? '@green',
		x,
		depth,
		scale: 0.86 + rng() * 0.28,
		rotation: (rng() - 0.5) * 14,
		layer,
		seed
	};
}

export function buildScene(tuple: SceneTuple): PlaygroundScene {
	const sceneSeed = sceneSeedFor(tuple.seed, tuple.schemaVersion);
	const start = Math.max(0, Math.round(tuple.startIndex));

	const elements = tuple.categories.map((category, offset) =>
		elementFor(sceneSeed, tuple.traits, category, start + offset)
	);

	// painter's order: the horizon first, the front edge last, so occlusion agrees
	// with perspective
	elements.sort((a, b) => a.depth - b.depth || a.index - b.index);

	let surprise: PlaygroundElement | null = null;
	const count = elements.length;
	if (count > 0 && hashString(`surprise:${sceneSeed}:${count}`) % SURPRISE_ODDS === 0) {
		const rng = seededRandom(hashString(`surprise-place:${sceneSeed}:${count}`));
		const base = elements[count - 1] as PlaygroundElement;
		surprise = {
			...base,
			index: start + count,
			species: rng() > 0.5 ? 'bird' : 'kite',
			x: 0.15 + rng() * 0.7,
			depth: 0.72 + rng() * 0.24,
			layer: 'front',
			scale: 1.05 + rng() * 0.25
		};
	}

	return {
		schemaVersion: tuple.schemaVersion,
		seed: tuple.seed,
		traits: tuple.traits,
		elements,
		biomes: unlockedBiomes(tuple.points),
		points: tuple.points,
		timeOfDay: tuple.timeOfDay,
		season: tuple.season,
		moonPhase: tuple.moonPhase,
		moonIllumination: tuple.moonIllumination,
		surprise
	};
}

export interface LedgerSceneInput {
	entries: readonly LedgerEntry[];
	/** from installSeed(); `''` before it resolves */
	seed: string;
	points: number;
	timeOfDay: TimeOfDay;
	season: Season;
	moonPhase: MoonPhase;
	moonIllumination: number;
	/** cap on rendered elements; the oldest fall away first */
	limit?: number;
	traits?: SceneTraits;
	schemaVersion?: number;
}

/** the ledger side of the tuple; the decoded-payload side builds one by hand */
export function sceneTupleFromLedger(input: LedgerSceneInput): SceneTuple {
	const version = input.schemaVersion ?? SCENE_SCHEMA_VERSION;
	const limit = input.limit ?? DEFAULT_ELEMENT_LIMIT;

	const planted = input.entries
		.filter((entry) => entry.outcome !== 'skipped')
		.sort((a, b) => a.at - b.at);

	// keep the most recent when over the cap; startIndex carries the offset so the
	// survivors stay exactly where they were
	const start = planted.length > limit ? planted.length - limit : 0;

	return {
		schemaVersion: version,
		seed: input.seed,
		traits: input.traits ?? deriveTraits(input.seed, version),
		categories: planted.slice(start).map((entry) => entry.category),
		startIndex: start,
		points: input.points,
		timeOfDay: input.timeOfDay,
		season: input.season,
		moonPhase: input.moonPhase,
		moonIllumination: input.moonIllumination
	};
}

// #endregion

// #region shared geometry

export interface Point {
	x: number;
	y: number;
}

export interface SceneBox {
	width: number;
	height: number;
}

export const MOON_TERMINATOR_STEPS = 24;

const WANING_PHASES: ReadonlySet<MoonPhase> = new Set<MoonPhase>([
	'waning_gibbous',
	'last_quarter',
	'waning_crescent'
]);

export function isWaning(phase: MoonPhase): boolean {
	return WANING_PHASES.has(phase);
}

/**
 * The lit face of the moon, as a closed 24-segment polygon centred on the origin.
 *
 * A sampled polygon rather than two arcs on purpose: the crescent-to-gibbous crossover
 * is exact, with none of the arc-flag pitfalls that flip a crescent into a gibbous right
 * at the half phase, and it translates to an SVG path almost verbatim.
 */
export function moonTerminatorPoints(
	radius: number,
	illumination: number,
	waning: boolean
): Point[] {
	const lit = illumination < 0 ? 0 : illumination > 1 ? 1 : illumination;
	const side = waning ? -1 : 1;
	const terminator = side * radius * (1 - 2 * lit);
	const points: Point[] = [];

	for (let i = 0; i <= MOON_TERMINATOR_STEPS; i++) {
		const a = -Math.PI / 2 + (i / MOON_TERMINATOR_STEPS) * Math.PI;
		points.push({ x: side * radius * Math.cos(a), y: radius * Math.sin(a) });
	}
	for (let i = MOON_TERMINATOR_STEPS; i >= 0; i--) {
		const a = -Math.PI / 2 + (i / MOON_TERMINATOR_STEPS) * Math.PI;
		points.push({ x: terminator * Math.cos(a), y: radius * Math.sin(a) });
	}

	return points;
}

/** a seeded polygon that reads as an organic lump once traced through its midpoints */
export function blobPoints(seed: number, size: number, steps = 9): Point[] {
	const rng = seededRandom(seed);
	const points: Point[] = [];
	for (let i = 0; i < steps; i++) {
		const angle = (i / steps) * Math.PI * 2;
		const radius = size * (0.4 + rng() * 0.16);
		points.push({
			x: Math.cos(angle) * radius,
			y: Math.sin(angle) * radius * 0.62 - size * 0.28
		});
	}
	return points;
}

// #endregion

// #region export

export const PLAYGROUND_EXPORT_FORMATS = ['svg', 'png', 'jpg'] as const;
export type PlaygroundExportFormat = (typeof PLAYGROUND_EXPORT_FORMATS)[number];

export const EXPORT_MIME: Record<PlaygroundExportFormat, string> = {
	svg: 'image/svg+xml',
	png: 'image/png',
	jpg: 'image/jpeg'
};

export const JPG_QUALITY = 0.95;

/** longest-edge ceiling; nothing exports past a ~3K poster */
export const EXPORT_MAX_EDGE = 2880;
export const EXPORT_MIN_SCALE = 1;
export const EXPORT_MAX_SCALE = 6;

export const RESOLUTION_PRESETS = [
	{ id: 'original', edge: null },
	{ id: 'hd', edge: 1280 },
	{ id: '2k', edge: 1920 },
	{ id: '3k', edge: EXPORT_MAX_EDGE }
] as const;
export type ResolutionPresetId = (typeof RESOLUTION_PRESETS)[number]['id'];

export const SOCIAL_PRESETS = [
	{ id: 'square', width: 1080, height: 1080 },
	{ id: 'story', width: 1080, height: 1920 },
	{ id: 'landscape', width: 1200, height: 630 }
] as const;
export type SocialPresetId = (typeof SOCIAL_PRESETS)[number]['id'];

export interface ExportTarget {
	/** the css-unit box the scene lays itself out in */
	sceneWidth: number;
	sceneHeight: number;
	/** the pixel size of the file that comes out */
	width: number;
	height: number;
	/** canvas transform scale; 1 when the scene re-lays out at the target size */
	scale: number;
}

export function clampExportScale(scale: number): number {
	if (!Number.isFinite(scale)) return EXPORT_MIN_SCALE;
	return Math.max(EXPORT_MIN_SCALE, Math.min(EXPORT_MAX_SCALE, scale));
}

/**
 * Upscale the on-screen scene toward a longest-edge target, aspect preserved.
 *
 * A small phone scene cannot reach 2880 within the 6x clamp, so the reported width and
 * height are what actually comes out rather than what the preset is named after.
 */
export function resolutionTarget(box: SceneBox, edge: number | null): ExportTarget {
	const width = Math.max(1, Math.round(box.width || 1));
	const height = Math.max(1, Math.round(box.height || 1));
	const longest = Math.max(width, height);
	const scale =
		edge === null || edge <= 0
			? EXPORT_MIN_SCALE
			: clampExportScale(Math.min(edge, EXPORT_MAX_EDGE) / longest);

	return {
		sceneWidth: width,
		sceneHeight: height,
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale)),
		scale
	};
}

/**
 * A fixed social frame.
 *
 * The scene re-lays out at the target box rather than being stretched or cropped into
 * it - the horizon, element placement and stroke weights are all functions of the frame,
 * so a story frame is a genuinely tall composition instead of a squeezed wide one.
 */
export function socialTarget(preset: { width: number; height: number }): ExportTarget {
	const width = Math.max(1, Math.min(EXPORT_MAX_EDGE, Math.round(preset.width)));
	const height = Math.max(1, Math.min(EXPORT_MAX_EDGE, Math.round(preset.height)));
	return { sceneWidth: width, sceneHeight: height, width, height, scale: 1 };
}

export function playgroundFileName(format: PlaygroundExportFormat, day: string): string {
	const safe = day.replace(/[^0-9a-zA-Z-]+/g, '-');
	return `recess-playground-${safe}.${format}`;
}

// #endregion
