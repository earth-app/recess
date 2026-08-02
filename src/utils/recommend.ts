import type { LedgerEntry, NudgeContext } from '~/types/context';
import type { Nudge, NudgeCategory, NudgeType, ValidationType } from '~/types/nudge';
import { nudgeRequiredPack } from '~/types/nudge';
import {
	BLEND_K,
	buildAffinityModel,
	COUNT_DECAY_CEILING,
	INTEREST_PSEUDO_COUNT,
	personalFactors,
	pointsBand,
	SKIP_EVIDENCE_WEIGHT,
	type AffinityModel
} from '~/utils/affinity';
import { dayKey, daysBetween, hashString, seededRandom, weightedSample } from '~/utils/day';
import { partitionByFilters, type FiltersResult } from '~/utils/filters';
import { DEFAULT_REACH_MAX_METRES } from '~/utils/geo';

// Deterministic per day: the same day key always yields the same set, so the
// deck survives a relaunch without persisting the selection. Weighted sampling
// rather than a hard sort keeps it from becoming a fixed rotation.
//
// The points bands and every feature arm live in affinity.ts; re-exporting them here
// would register a second auto-import of the same name.

export const DEFAULT_DAILY_COUNT = 4;
export const DEFAULT_COOLDOWN_DAYS = 21;
export const SKIP_DECAY_DAYS = 7;
export const CATEGORY_RECENCY_DAYS = 3;
export const MAX_PER_CATEGORY = 2;

/** one low, two mid, one high; higher points read as harder */
export const DEFAULT_SLOTS = ['low', 'mid', 'mid', 'high'] as const;

// #region tuning

/** a nudge never returns the next day, however forgiving the decay curve gets */
export const MIN_COOLDOWN_DAYS = 2;

/** how far a just-resolved nudge is pushed down; 1 would exclude it outright */
export const ITEM_SATIATION_DEPTH = 0.95;
export const ITEM_SATIATION_HALF_LIFE_DAYS = 10;

/** the same shape one level up, so a category rebounds within the week */
export const CATEGORY_SATIATION_DEPTH = 0.8;
export const CATEGORY_SATIATION_HALF_LIFE_DAYS = 2;

/** MMR trade-off; e^-mu is the multiplier a duplicate of an already-picked nudge takes */
export const MMR_MU = 1.2;

/** similarity mass per shared facet; sums to 1 for an identical pair */
export const SIMILARITY_CATEGORY_WEIGHT = 0.5;
export const SIMILARITY_TYPE_WEIGHT = 0.2;
export const SIMILARITY_TAG_WEIGHT = 0.3;

/** the deficit is a fraction of a fair share, so this is the lift a missing category gets */
export const CALIBRATION_WEIGHT = 0.75;

/** keeps a badly over-exposed category positive; nothing here may zero a nudge out */
export const CALIBRATION_FLOOR = 0.15;
export const CALIBRATION_WINDOW_DAYS = 28;

/**
 * Worst multiplier a place-bound nudge can take for having nothing nearby.
 *
 * The signal is a deterministic bump, deliberately NOT a seventh Beta-Bernoulli arm. At the
 * handful of observations a geographic arm would collect in this app's lifetime, a Thompson draw
 * flips the term's sign between days - and with a single user, that user sees every flip. Greedy
 * is rate-optimal under covariate diversity (Bastani, Bayati & Khosravi 2021), and distance decay
 * is measured pedestrian behaviour rather than an unknown reward, so there is nothing to learn.
 *
 * 0.45 sits alongside 'not enough daylight' (0.5) and 'pack missing' (0.4) rather than
 * dominating them; the multiplier is `floor + (1 - floor) * reachability`, so it only ever
 * discourages and can never zero a nudge out or push one above its base weight.
 */
export const REACH_FLOOR = 0.45;

/**
 * Every knob the recommender eval calibrates.
 *
 * Each field mirrors the exported constant of the same meaning; the eval sweeps this
 * object rather than editing the constants, so a reported number always names the
 * value it was measured at.
 */
export interface RecommendTuning {
	blendK: number;
	skipEvidenceWeight: number;
	countDecayCeiling: number;
	interestPseudoCount: number;
	minCooldownDays: number;
	itemSatiationDepth: number;
	itemSatiationHalfLifeDays: number;
	categorySatiationDepth: number;
	categorySatiationHalfLifeDays: number;
	mmrMu: number;
	calibrationWeight: number;
	calibrationFloor: number;
	calibrationWindowDays: number;
	reachFloor: number;
	/** outer limit of the distance-decay curve, in metres */
	reachMaxMetres: number;
}

export const RECOMMEND_TUNING: RecommendTuning = {
	blendK: BLEND_K,
	skipEvidenceWeight: SKIP_EVIDENCE_WEIGHT,
	countDecayCeiling: COUNT_DECAY_CEILING,
	interestPseudoCount: INTEREST_PSEUDO_COUNT,
	minCooldownDays: MIN_COOLDOWN_DAYS,
	itemSatiationDepth: ITEM_SATIATION_DEPTH,
	itemSatiationHalfLifeDays: ITEM_SATIATION_HALF_LIFE_DAYS,
	categorySatiationDepth: CATEGORY_SATIATION_DEPTH,
	categorySatiationHalfLifeDays: CATEGORY_SATIATION_HALF_LIFE_DAYS,
	mmrMu: MMR_MU,
	calibrationWeight: CALIBRATION_WEIGHT,
	calibrationFloor: CALIBRATION_FLOOR,
	calibrationWindowDays: CALIBRATION_WINDOW_DAYS,
	reachFloor: REACH_FLOOR,
	reachMaxMetres: DEFAULT_REACH_MAX_METRES
};

// #endregion

export type PointsSlot = (typeof DEFAULT_SLOTS)[number];

export interface RecommendOptions {
	count?: number;
	cooldownDays?: number;
	/** categories the user turned off in settings */
	enabledCategories?: readonly NudgeCategory[];
	/** categories picked during onboarding; enters the model as pseudo-counts */
	interests?: readonly NudgeCategory[];
	/**
	 * nudge types the user has not unlocked yet, excluded from the pool outright.
	 *
	 * Without this the informational unlocks lie: `notice` and `count` nudges were served
	 * from zero points, and the app then announced "You Can Now Get Noticing Nudges" at 150
	 * for something the user had had all along.
	 */
	lockedTypes?: readonly NudgeType[];
	slots?: readonly PointsSlot[];
	/** per-install seed; `''` degrades to the day-and-locale stream rather than throwing */
	installSeed?: string;
	tuning?: Partial<RecommendTuning>;
}

export interface ScoredNudge {
	nudge: Nudge;
	weight: number;
	reasons: string[];
}

export interface Recommendation {
	nudges: Nudge[];
	/** unlocks only once every core nudge is resolved */
	bonus: Nudge | null;
	scored: ScoredNudge[];
	blocked: { nudge: Nudge; result: FiltersResult }[];
	/** set when the pool could not fill every slot */
	shortfall: number;
	/** the learned model the day was scored against, for inspection and the eval lane */
	model: AffinityModel;
}

// #region signals

/**
 * AR(1) leaky integrator, evaluated lazily as `gamma ** daysSince` so there is no
 * per-day tick and nothing new to persist. Rebounding Bandits' satiation shape:
 * reward declines with exposure and rebounds while the item is not shown.
 */
export function satiationFactor(daysSince: number, depth: number, halfLifeDays: number): number {
	if (!(halfLifeDays > 0)) return 1;
	const gamma = 0.5 ** (1 / halfLifeDays);
	return 1 - depth * gamma ** Math.max(0, daysSince);
}

function jaccard(a: readonly string[], b: readonly string[]): number {
	if (a.length === 0 || b.length === 0) return 0;

	const left = new Set(a);
	const right = new Set(b);
	let shared = 0;
	for (const value of right) if (left.has(value)) shared++;

	// both sets are non-empty by the guard above, so the union can never be zero
	return shared / (left.size + right.size - shared);
}

/** shared category / type / tags; 1 for an identical pair, 0 for nothing in common */
export function nudgeSimilarity(a: Nudge, b: Nudge): number {
	let score = SIMILARITY_TAG_WEIGHT * jaccard(a.tags, b.tags);
	if (a.category === b.category) score += SIMILARITY_CATEGORY_WEIGHT;
	if (a.type === b.type) score += SIMILARITY_TYPE_WEIGHT;
	return score;
}

export function maxSimilarity(nudge: Nudge, against: readonly Nudge[]): number {
	let worst = 0;
	for (const other of against) {
		if (other.id === nudge.id) continue;
		worst = Math.max(worst, nudgeSimilarity(nudge, other));
	}
	return worst;
}

/** `''` keeps the pre-seed stream exactly, so a pre-load call cannot re-key the deck */
export function seedKeyFor(installSeed: string, day: string, locale: string): string {
	return installSeed ? `${installSeed}:${day}:${locale}` : `${day}:${locale}`;
}

// #endregion

interface History {
	completions: Record<string, number>;
	skips: Record<string, number>;
	/** latest resolved-not-skipped timestamp per category, for category satiation */
	categoryLast: Partial<Record<NudgeCategory, number>>;
	recentCategories: Set<NudgeCategory>;
	previousTags: Set<string>;
	/** times each id has been resolved at all, for the novelty bonus */
	exposure: Record<string, number>;
	/** how far each category sits below a fair share of the calibration window */
	categoryDeficit: Partial<Record<NudgeCategory, number>>;
}

function buildHistory(
	entries: readonly LedgerEntry[],
	ctx: NudgeContext,
	catalog: readonly Nudge[],
	pool: readonly Nudge[],
	tuning: RecommendTuning
): History {
	const completions: Record<string, number> = {};
	const skips: Record<string, number> = {};
	const categoryLast: Partial<Record<NudgeCategory, number>> = {};
	const recentCategories = new Set<NudgeCategory>();
	const previousTags = new Set<string>();
	const exposure: Record<string, number> = {};
	const yesterday = dayKey(new Date(ctx.now.getTime() - 86_400_000));
	// the ledger carries no tags, so they have to come off the catalog
	const tagsById = new Map(catalog.map((nudge) => [nudge.id, nudge.tags]));

	// skips count as exposure here: the card was shown either way, so the calibration
	// window is the mix the user actually saw
	const windowCounts = new Map<NudgeCategory, number>();
	let windowTotal = 0;

	for (const entry of entries) {
		exposure[entry.id] = (exposure[entry.id] ?? 0) + 1;

		const age = daysBetween(entry.day, ctx.day);
		if (age >= 0 && age < tuning.calibrationWindowDays) {
			windowCounts.set(entry.category, (windowCounts.get(entry.category) ?? 0) + 1);
			windowTotal++;
		}

		if (entry.outcome === 'skipped') {
			skips[entry.id] = Math.max(skips[entry.id] ?? 0, entry.at);
			continue;
		}

		completions[entry.id] = Math.max(completions[entry.id] ?? 0, entry.at);
		categoryLast[entry.category] = Math.max(categoryLast[entry.category] ?? 0, entry.at);

		if (age >= 0 && age <= CATEGORY_RECENCY_DAYS) recentCategories.add(entry.category);
		if (entry.day === yesterday) {
			for (const tag of tagsById.get(entry.id) ?? []) previousTags.add(tag);
		}
	}

	const inPlay = new Set(pool.map((nudge) => nudge.category));
	const categoryDeficit: Partial<Record<NudgeCategory, number>> = {};
	// an empty window has nothing to balance, so every deficit stays 0 and the factor is 1
	if (windowTotal > 0 && inPlay.size > 0) {
		const target = 1 / inPlay.size;
		for (const category of inPlay) {
			const share = (windowCounts.get(category) ?? 0) / windowTotal;
			// as a fraction of a fair share, so one weight means the same thing whether
			// nine categories are enabled or two
			categoryDeficit[category] = (target - share) / target;
		}
	}

	return {
		completions,
		skips,
		categoryLast,
		recentCategories,
		previousTags,
		exposure,
		categoryDeficit
	};
}

interface Scoring {
	ctx: NudgeContext;
	history: History;
	tuning: RecommendTuning;
	/** learned multiplier per id, already raised to the confidence blend */
	personal: Map<string, number>;
}

function daysSinceStamp(stamp: number, day: string): number {
	return daysBetween(dayKey(new Date(stamp)), day);
}

/**
 * multiplicative signals on a base of 1. nothing here can zero a nudge out -
 * hard exclusions happen in the filter pass and the cooldown check, so the
 * weight only ever shifts the odds.
 */
function scoreNudge(nudge: Nudge, scoring: Scoring, pickedSoFar: readonly Nudge[]): ScoredNudge {
	const { ctx, history, tuning, personal } = scoring;
	let weight = 1;
	const reasons: string[] = [];

	const bump = (factor: number, reason: string) => {
		weight *= factor;
		reasons.push(`${reason} x${Number(factor.toFixed(3))}`);
	};

	if (history.recentCategories.has(nudge.category)) bump(0.35, 'category seen recently');

	const lastSkip = history.skips[nudge.id];
	if (lastSkip !== undefined && daysSinceStamp(lastSkip, ctx.day) <= SKIP_DECAY_DAYS) {
		bump(0.3, 'skipped recently');
	}

	const learned = personal.get(nudge.id);
	if (learned !== undefined) bump(learned, 'learned affinity');

	const lastCompletion = history.completions[nudge.id];
	if (lastCompletion !== undefined) {
		bump(
			satiationFactor(
				daysSinceStamp(lastCompletion, ctx.day),
				tuning.itemSatiationDepth,
				tuning.itemSatiationHalfLifeDays
			),
			'item satiation'
		);
	}

	const lastCategory = history.categoryLast[nudge.category];
	if (lastCategory !== undefined) {
		bump(
			satiationFactor(
				daysSinceStamp(lastCategory, ctx.day),
				tuning.categorySatiationDepth,
				tuning.categorySatiationHalfLifeDays
			),
			'category satiation'
		);
	}

	// Steck (2018) calibration, deliberately toward an even mix rather than toward
	// history; pulling toward history would fight the app's variety goal
	const deficit = history.categoryDeficit[nudge.category];
	if (deficit !== undefined) {
		const factor = 1 + tuning.calibrationWeight * deficit;
		bump(Math.max(tuning.calibrationFloor, factor), 'category calibration');
	}

	// a region overlay entry should outrank the base-language original, and an
	// english fallback should sit behind a native-language one
	if (nudge.locale === ctx.locale) bump(1.25, 'exact locale');
	else if (nudge.locale !== ctx.locale.split('-')[0]) bump(0.8, 'fallback locale');

	const pack = nudgeRequiredPack(nudge);
	if (pack && !ctx.installed_packs.includes(pack)) bump(0.4, 'pack missing');

	if (nudge.duration_minutes !== undefined) {
		const remaining = ctx.daylight_remaining;
		if (
			remaining !== undefined &&
			Number.isFinite(remaining) &&
			remaining < nudge.duration_minutes
		) {
			bump(0.5, 'not enough daylight');
		}
		// a long nudge late at night is a bad ask
		if (ctx.hour >= 21 && nudge.duration_minutes > 15) bump(0.4, 'too long for this hour');
	}

	/**
	 * Can this actually be done near you?
	 *
	 * Only applies to a nudge that declares what it needs from a place. `undefined` anywhere - no
	 * pack, no position, an affordance the pack has never heard of - means the question was not
	 * answerable, and an unanswerable question must not move the weight at all. Same fail-open
	 * contract the weather signals follow, and what keeps a rural or offline user's deck
	 * byte-identical to today's.
	 */
	const needs = nudge.place_affordances;
	if (needs && needs.length > 0 && ctx.reachability) {
		// every affordance must be reachable, so the worst one governs
		let worst: number | null = null;
		for (const affordance of needs) {
			const score = ctx.reachability[affordance];
			if (score === undefined) {
				worst = null;
				break;
			}
			worst = worst === null ? score : Math.min(worst, score);
		}

		if (worst !== null) {
			bump(tuning.reachFloor + (1 - tuning.reachFloor) * worst, 'reachable nearby');
		}
	}

	const tagOverlap = nudge.tags.filter((tag) => history.previousTags.has(tag)).length;
	if (tagOverlap > 0) bump(0.7, 'tag seen yesterday');

	const sameCategoryPicked = pickedSoFar.filter((p) => p.category === nudge.category).length;
	if (sameCategoryPicked > 0) bump(0.3, 'category already picked today');

	const pickedTags = new Set(pickedSoFar.flatMap((p) => p.tags));
	if (nudge.tags.some((tag) => pickedTags.has(tag))) bump(0.6, 'tag already picked today');

	// MMR against the already-picked set. greedy over a monotone submodular objective,
	// so at k=4 the slate is within 1 - ((k-1)/k)^k = 0.684 of the optimal one
	if (pickedSoFar.length > 0 && tuning.mmrMu > 0) {
		const similarity = maxSimilarity(nudge, pickedSoFar);
		if (similarity > 0) bump(Math.exp(-tuning.mmrMu * similarity), 'mmr variety');
	}

	return { nudge, weight, reasons };
}

function validationOf(nudge: Nudge): ValidationType | null {
	return 'validation_type' in nudge ? (nudge.validation_type as ValidationType) : null;
}

/**
 * pick one nudge for a slot. constraints are relaxed in order rather than
 * failing: preferred band -> any band, then variety rules dropped, so a small
 * pool still fills the day.
 */
function pickForSlot(
	pool: Nudge[],
	band: PointsSlot,
	scoring: Scoring,
	picked: Nudge[],
	rng: () => number
): Nudge | null {
	const categoryCounts = new Map<NudgeCategory, number>();
	for (const nudge of picked) {
		categoryCounts.set(nudge.category, (categoryCounts.get(nudge.category) ?? 0) + 1);
	}
	const usedValidations = new Set(picked.map(validationOf).filter(Boolean));

	const underCategoryCap = (nudge: Nudge) =>
		(categoryCounts.get(nudge.category) ?? 0) < MAX_PER_CATEGORY;
	const freshValidation = (nudge: Nudge) => !usedValidations.has(validationOf(nudge));

	const tiers: Nudge[][] = [
		pool.filter((n) => pointsBand(n.points) === band && underCategoryCap(n) && freshValidation(n)),
		pool.filter((n) => pointsBand(n.points) === band && underCategoryCap(n)),
		pool.filter((n) => underCategoryCap(n) && freshValidation(n)),
		pool.filter(underCategoryCap),
		pool
	];

	for (const tier of tiers) {
		if (tier.length === 0) continue;
		const [choice] = weightedSample(
			tier,
			(nudge) => scoreNudge(nudge, scoring, picked).weight,
			1,
			rng
		);
		if (choice) return choice;
	}

	return null;
}

/**
 * The bonus is a pure novelty pick: lowest-exposure, never-completed.
 *
 * That is a ~20% exploration slot for nothing, well past the 5% Schibsted run in
 * production and the 1% Twitter reports, with no epsilon schedule to decay.
 */
function pickNovelty(pool: readonly Nudge[], history: History, seedKey: string): Nudge | null {
	if (pool.length === 0) return null;

	const fresh = pool.filter((nudge) => history.completions[nudge.id] === undefined);
	// relaxes to the whole pool once every eligible nudge has been done at least once
	const candidates = fresh.length > 0 ? fresh : pool;

	let best: Nudge | null = null;
	let bestExposure = Number.POSITIVE_INFINITY;
	let bestTie = Number.POSITIVE_INFINITY;

	for (const nudge of candidates) {
		const exposure = history.exposure[nudge.id] ?? 0;
		const tie = hashString(`${seedKey}:${nudge.id}`);
		if (exposure < bestExposure || (exposure === bestExposure && tie < bestTie)) {
			best = nudge;
			bestExposure = exposure;
			bestTie = tie;
		}
	}

	return best;
}

export function recommendDaily(
	catalog: readonly Nudge[],
	ctx: NudgeContext,
	entries: readonly LedgerEntry[] = [],
	options: RecommendOptions = {}
): Recommendation {
	const count = Math.max(1, options.count ?? DEFAULT_DAILY_COUNT);
	const requested = Math.max(0, options.cooldownDays ?? DEFAULT_COOLDOWN_DAYS);
	const slots = options.slots ?? DEFAULT_SLOTS;
	const tuning = { ...RECOMMEND_TUNING, ...options.tuning };

	const enabled = options.enabledCategories;
	const locked = options.lockedTypes ?? [];
	const byCategory = (
		enabled ? catalog.filter((nudge) => enabled.includes(nudge.category)) : [...catalog]
	).filter((nudge) => !locked.includes(nudge.type));

	const history = buildHistory(entries, ctx, catalog, byCategory, tuning);

	// exponential satiation does the soft work now, so the wall only has to stop a
	// next-day repeat. 0 stays 0 - that is settings turning the cooldown off on purpose
	const cooldownDays = requested > 0 ? Math.max(requested, tuning.minCooldownDays) : 0;

	// resolved today already, so it must not come back in the same day's deck
	const resolvedToday = new Set(
		entries.filter((entry) => entry.day === ctx.day).map((entry) => entry.id)
	);

	const offCooldown = byCategory.filter((nudge) => {
		if (resolvedToday.has(nudge.id)) return false;
		const last = history.completions[nudge.id];
		if (last === undefined) return true;
		return daysSinceStamp(last, ctx.day) >= cooldownDays;
	});

	const { eligible, blocked } = partitionByFilters(offCooldown, ctx);

	const seedKey = seedKeyFor(options.installSeed ?? '', ctx.day, ctx.locale);
	const rng = seededRandom(hashString(seedKey));

	const model = buildAffinityModel(entries, catalog, {
		skipWeight: tuning.skipEvidenceWeight,
		ceiling: tuning.countDecayCeiling,
		blendK: tuning.blendK,
		interests: options.interests,
		interestStrength: tuning.interestPseudoCount
	});

	// its own stream on purpose: a Thompson draw must not shift where the picker lands,
	// or an install with no evidence would stop matching the unlearned deck
	const personal = personalFactors(
		eligible,
		model,
		seededRandom(hashString(`${seedKey}:affinity`))
	);

	const scoring: Scoring = { ctx, history, tuning, personal };
	const pool = [...eligible];
	const picked: Nudge[] = [];

	for (let i = 0; i < count; i++) {
		const band = slots[i % slots.length] ?? 'mid';
		const choice = pickForSlot(pool, band, scoring, picked, rng);
		if (!choice) break;
		picked.push(choice);
		pool.splice(pool.indexOf(choice), 1);
	}

	const bonus = pickNovelty(pool, history, seedKey);

	const scored = eligible
		.map((nudge) => scoreNudge(nudge, scoring, []))
		.sort((a, b) => b.weight - a.weight);

	return {
		nudges: picked,
		bonus,
		scored,
		blocked,
		shortfall: Math.max(0, count - picked.length),
		model
	};
}

/**
 * why today is empty, in the user's terms. picks the most common definite
 * blocker so the empty state can say something specific.
 */
export function dominantBlocker(
	blocked: readonly { nudge: Nudge; result: FiltersResult }[]
): string | null {
	const counts = new Map<string, number>();
	for (const entry of blocked) {
		const type = entry.result.blockedBy?.type;
		if (type) counts.set(type, (counts.get(type) ?? 0) + 1);
	}

	let best: string | null = null;
	let bestCount = 0;
	for (const [type, n] of counts) {
		if (n > bestCount) {
			best = type;
			bestCount = n;
		}
	}

	return best;
}
