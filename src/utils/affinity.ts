import type { LedgerEntry } from '~/types/context';
import { nudgeValidationType, type Nudge, type NudgeCategory } from '~/types/nudge';

// #region feature bands

export const POINTS_LOW_MAX = 10;
export const POINTS_HIGH_MIN = 20;

export type PointsBand = 'low' | 'mid' | 'high';

export function pointsBand(points: number): PointsBand {
	if (points <= POINTS_LOW_MAX) return 'low';
	if (points >= POINTS_HIGH_MIN) return 'high';
	return 'mid';
}

/** minutes; `<=` is short */
export const DURATION_SHORT_MAX = 10;
/** minutes; `>=` is long */
export const DURATION_LONG_MIN = 45;

export type DurationBand = 'short' | 'medium' | 'long';

export function durationBand(minutes: number): DurationBand {
	if (minutes <= DURATION_SHORT_MAX) return 'short';
	if (minutes >= DURATION_LONG_MIN) return 'long';
	return 'medium';
}

// #endregion

// #region features

export const FEATURE_GROUPS = [
	'category',
	'type',
	'validation',
	'points',
	'duration',
	'tag'
] as const;
export type FeatureGroup = (typeof FEATURE_GROUPS)[number];

/**
 * The feature arms a nudge activates, grouped.
 *
 * Built group-first rather than parsed back out of the flat keys, so there is no
 * unknown-prefix case to defend against downstream.
 */
export function groupedFeatures(nudge: Nudge): Map<FeatureGroup, string[]> {
	const grouped = new Map<FeatureGroup, string[]>();
	grouped.set('category', [`category:${nudge.category}`]);
	grouped.set('type', [`type:${nudge.type}`]);

	const validation = nudgeValidationType(nudge);
	if (validation) grouped.set('validation', [`validation:${validation}`]);

	grouped.set('points', [`points:${pointsBand(nudge.points)}`]);
	if (nudge.duration_minutes !== undefined) {
		grouped.set('duration', [`duration:${durationBand(nudge.duration_minutes)}`]);
	}

	if (nudge.tags.length > 0) {
		grouped.set(
			'tag',
			nudge.tags.map((tag) => `tag:${tag}`)
		);
	}

	return grouped;
}

/**
 * The same arms flat, in group order.
 *
 * Points and duration are discretized into bands rather than modelled continuously;
 * fitting a scaler over fewer than 100 noisy points would read as precision that is
 * not there, and banding is the standard naive Bayes answer for a numeric feature.
 */
export function featuresOf(nudge: Nudge): string[] {
	const grouped = groupedFeatures(nudge);
	return FEATURE_GROUPS.flatMap((group) => grouped.get(group) ?? []);
}

/**
 * The same arms read off a ledger entry, for an id no longer in the catalog.
 *
 * A locale switch or a retired nudge leaves entries whose nudge cannot be resolved.
 * The entry still carries everything except `tags`, so this keeps most of the
 * evidence rather than dropping the interaction.
 */
function entryFeatures(entry: LedgerEntry): string[] {
	const features = [`category:${entry.category}`, `type:${entry.type}`];

	if (entry.validation_type) features.push(`validation:${entry.validation_type}`);

	features.push(`points:${pointsBand(entry.points)}`);
	if (entry.duration_minutes !== undefined) {
		features.push(`duration:${durationBand(entry.duration_minutes)}`);
	}

	return features;
}

// #endregion

// #region counts

/** Rocchio's gamma < beta: positive feedback is far more informative than negative */
export const SKIP_EVIDENCE_WEIGHT = 0.2;

/** halve a feature's evidence past this total; bounds cost and handles nonstationarity */
export const COUNT_DECAY_CEILING = 48;

export interface FeatureCounts {
	successes: number;
	failures: number;
}

export type AffinityCounts = Map<string, FeatureCounts>;

export interface CountsOptions {
	skipWeight?: number;
	ceiling?: number;
	/** starting evidence folded in before the ledger, e.g. onboarding interests */
	priors?: AffinityCounts;
}

/**
 * Accumulate per-feature success / failure evidence from the ledger.
 *
 * `catalog` supplies the tags, which the ledger does not carry; pass it whenever tag
 * arms matter. Entries are read in timestamp order so the halving below cannot depend
 * on the caller's array order.
 */
export function countsFrom(
	entries: readonly LedgerEntry[],
	catalog: readonly Nudge[] = [],
	options: CountsOptions = {}
): AffinityCounts {
	const skipWeight = options.skipWeight ?? SKIP_EVIDENCE_WEIGHT;
	const ceiling = options.ceiling ?? COUNT_DECAY_CEILING;

	const counts: AffinityCounts = new Map();
	if (options.priors) {
		for (const [feature, prior] of options.priors) {
			counts.set(feature, { successes: prior.successes, failures: prior.failures });
		}
	}

	const byId = new Map(catalog.map((nudge) => [nudge.id, nudge]));
	const ordered = [...entries].sort((a, b) => a.at - b.at);

	for (const entry of ordered) {
		const nudge = byId.get(entry.id);
		const features = nudge ? featuresOf(nudge) : entryFeatures(entry);
		const skipped = entry.outcome === 'skipped';

		for (const feature of features) {
			const slot = counts.get(feature) ?? { successes: 0, failures: 0 };
			if (skipped) slot.failures += skipWeight;
			else slot.successes += 1;

			if (slot.successes + slot.failures > ceiling) {
				slot.successes /= 2;
				slot.failures /= 2;
			}

			counts.set(feature, slot);
		}
	}

	return counts;
}

/**
 * Integer Beta shapes: `Beta(1, 1)` plus rounded evidence.
 *
 * Rounding is what keeps `betaInt` exact - skip evidence arrives in 0.2 increments, so
 * three skips are what it takes to register as one unit of negative evidence. Every
 * shape stays >= 1 forever, which is the whole reason the sampler can be exact.
 */
export function featureShapes(counts: AffinityCounts, feature: string): { a: number; b: number } {
	const slot = counts.get(feature);
	return {
		a: 1 + Math.round(slot?.successes ?? 0),
		b: 1 + Math.round(slot?.failures ?? 0)
	};
}

/** the posterior mean for one arm; what the Thompson draw is centred on */
export function posteriorMean(counts: AffinityCounts, feature: string): number {
	const { a, b } = featureShapes(counts, feature);
	return a / (a + b);
}

// #endregion

// #region sampling

/**
 * `Gamma(k, 1)` for integer k. Erlang, so exactly a sum of k exponentials. `1 - rng()`
 * keeps the uniform in `(0, 1]`, so the log never sees zero.
 */
function gammaInt(k: number, rng: () => number): number {
	let sum = 0;
	for (let i = 0; i < k; i++) sum -= Math.log(1 - rng());
	return sum;
}

/**
 * Exact Beta sample for integer shapes, via the Gamma ratio.
 *
 * The Beta CDF has no closed-form inverse, so inverse-CDF sampling is unavailable and
 * the Gamma ratio is the exact route. Driven from the supplied rng, never
 * `Math.random`, so a day's draws replay from the seed alone.
 */
// a non-integer prior would need Marsaglia-Tsang (2000) squeeze rejection instead;
// the priors are integer on purpose so that never becomes necessary
export function betaInt(a: number, b: number, rng: () => number): number {
	const drawA = gammaInt(Math.max(1, Math.round(a)), rng);
	const drawB = gammaInt(Math.max(1, Math.round(b)), rng);
	const total = drawA + drawB;
	// every uniform came back as exactly 1, so there is no ratio; fall back to the median
	return total === 0 ? 0.5 : drawA / total;
}

/** caps one arm's log-odds, so a single lopsided draw cannot saturate the total */
export const AFFINITY_LOGIT_CLAMP = 2;

/** caps the summed log-odds; e^2 either way, so the learned layer spans 0.14x - 7.4x */
export const AFFINITY_MAX_LOG_ODDS = 2;

function clamp(value: number, limit: number): number {
	if (Number.isNaN(value)) return 0;
	return Math.min(limit, Math.max(-limit, value));
}

function logit(p: number): number {
	return Math.log(p / (1 - p));
}

// #endregion

// #region affinity

/**
 * How much each group's log-odds is worth in the sum.
 *
 * The category arm carries most of the mass on purpose: it is the only arm an
 * onboarding interest can feed, so anything smaller would make a declared interest
 * invisible on day one.
 */
export const FEATURE_GROUP_WEIGHTS: Record<FeatureGroup, number> = {
	category: 0.8,
	tag: 0.5,
	type: 0.4,
	validation: 0.25,
	points: 0.2,
	duration: 0.2
};

export interface AffinityWeights {
	groups?: Partial<Record<FeatureGroup, number>>;
	logitClamp?: number;
	maxLogOdds?: number;
}

/**
 * Thompson-sampled naive Bayes log-odds for one nudge:
 * `sum(weight_group * logit(theta_group))`, clamped.
 *
 * A group's log-odds is the mean over the arms that carry evidence, never the sum, or
 * a 5-tag nudge would outrank a 1-tag nudge on tag count alone. An arm with no
 * evidence is `Beta(1, 1)`, whose log-odds is 0 either way, so it is skipped rather
 * than drawn - a uniform draw there would only add noise on top of the exploration the
 * novelty bonus already buys.
 */
export function affinityFor(
	nudge: Nudge,
	counts: AffinityCounts,
	rng: () => number,
	weights: AffinityWeights = {}
): number {
	const groups = { ...FEATURE_GROUP_WEIGHTS, ...weights.groups };
	const logitClamp = weights.logitClamp ?? AFFINITY_LOGIT_CLAMP;
	const maxLogOdds = weights.maxLogOdds ?? AFFINITY_MAX_LOG_ODDS;

	const byGroup = groupedFeatures(nudge);

	let logOdds = 0;
	// fixed group order, so the draw sequence stays replayable from the seed alone
	for (const group of FEATURE_GROUPS) {
		const features = byGroup.get(group);
		if (!features) continue;

		let sum = 0;
		let active = 0;
		for (const feature of features) {
			const { a, b } = featureShapes(counts, feature);
			if (a === 1 && b === 1) continue;
			sum += clamp(logit(betaInt(a, b, rng)), logitClamp);
			active++;
		}
		if (active === 0) continue;

		logOdds += (groups[group] ?? 0) * (sum / active);
	}

	return clamp(logOdds, maxLogOdds);
}

/** interactions needed before the learned layer counts for half of its full strength */
export const BLEND_K = 10;

/**
 * `n / (n + k)`. Exactly 0 at `n = 0`, which is what makes a fresh install behave
 * bit-for-bit as the unlearned recommender does.
 */
export function confidenceBlend(interactions: number, k: number = BLEND_K): number {
	const n = Math.max(0, interactions);
	if (n === 0) return 0;
	return n / (n + Math.max(0, k));
}

/** onboarding evidence worth this many completions, per selected interest */
export const INTEREST_PSEUDO_COUNT = 3;

/**
 * Onboarding interests as prior evidence rather than a permanent multiplier.
 *
 * A chip tapped once during onboarding must not outweigh months of real completions,
 * so it enters as pseudo-counts and is outvoted as real evidence lands.
 */
export function interestPseudoCounts(
	interests: readonly NudgeCategory[],
	strength: number = INTEREST_PSEUDO_COUNT
): AffinityCounts {
	const counts: AffinityCounts = new Map();
	if (!(strength > 0)) return counts;

	for (const category of interests) {
		counts.set(`category:${category}`, { successes: strength, failures: 0 });
	}

	return counts;
}

export interface AffinityModel {
	counts: AffinityCounts;
	/**
	 * Evidence volume, not evidence weight: every ledger entry with skips included, plus
	 * the onboarding pseudo-counts. Interests are declared evidence, so they have to move
	 * the blend or a first-launch deck could never act on them.
	 */
	interactions: number;
	blend: number;
}

export interface AffinityOptions {
	skipWeight?: number;
	ceiling?: number;
	blendK?: number;
	interests?: readonly NudgeCategory[];
	interestStrength?: number;
}

export function buildAffinityModel(
	entries: readonly LedgerEntry[],
	catalog: readonly Nudge[] = [],
	options: AffinityOptions = {}
): AffinityModel {
	const priors = interestPseudoCounts(options.interests ?? [], options.interestStrength);
	const counts = countsFrom(entries, catalog, {
		skipWeight: options.skipWeight,
		ceiling: options.ceiling,
		priors
	});

	let pseudo = 0;
	for (const prior of priors.values()) pseudo += prior.successes + prior.failures;

	const interactions = entries.length + pseudo;
	return { counts, interactions, blend: confidenceBlend(interactions, options.blendK) };
}

/**
 * The learned multiplier per nudge id, `personal ** blend`.
 *
 * Drawn once per call so a day's slate is scored against one coherent posterior
 * sample; a fresh draw per slot would make the same nudge disagree with itself.
 */
export function personalFactors(
	nudges: readonly Nudge[],
	model: AffinityModel,
	rng: () => number,
	weights: AffinityWeights = {}
): Map<string, number> {
	const factors = new Map<string, number>();
	// no evidence means no draws at all, so a fresh install keeps the exact pick stream
	if (model.blend === 0) return factors;

	for (const nudge of nudges) {
		const personal = Math.exp(affinityFor(nudge, model.counts, rng, weights));
		factors.set(nudge.id, personal ** model.blend);
	}

	return factors;
}

// #endregion
