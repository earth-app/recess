import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LedgerEntry, NudgeContext, WeatherSnapshot } from '~/types/context';
import type { Nudge, NudgeCategory, NudgeType } from '~/types/nudge';
import type { RecommendTuning } from '~/utils/recommend';
import { EVAL_DIR, installSourceResolver } from './harness';

// The recommender eval: 180 scripted days per persona, reporting intra-list diversity,
// catalog coverage and simulated completion rate, and failing if any reachable catalog
// item goes permanently dark. This is where every tuning constant gets its number, so
// nothing in RECOMMEND_TUNING should be edited without re-running it.

const REPORT_PATH = join(EVAL_DIR, 'recommend-report.json');

// #region knobs

const DAYS = 180;
const DAILY_COUNT = 4;
const LOCALE = 'en';

/** the sim starts here so 180 days sweep winter through summer */
const START = { year: 2026, month: 0, day: 1 };

/** an item eligible at least this often but never shown is dark, not just unlucky */
const DARK_MIN_ELIGIBLE_DAYS = 20;

/** floors the gate enforces on the shipped arm */
const COVERAGE_FLOOR = 0.75;
const COMPLETION_FLOOR = 0.4;

/** fixed install seeds, one per persona; shaped like the real 128-bit hex seed */
const SEEDS = [
	'2f1c9b6a04d7e83512ab6c4d9e0f7a35',
	'8a3d0e5b7c1f9426ad83b5e0c2179fab',
	'c40b19e7a5d382f6084b1cde79235a6f'
];

// #endregion

// #region personas

interface Persona {
	id: string;
	interests: NudgeCategory[];
	/** odds multiplier applied to the base completion rate */
	category: Partial<Record<NudgeCategory, number>>;
	type: Partial<Record<NudgeType, number>>;
	tag: Record<string, number>;
	base: number;
}

/**
 * Scripted, not sampled: a fixed taste vector per persona is what makes "did the model
 * find the preference" a measurable question rather than a coin flip.
 */
const PERSONAS: Persona[] = [
	{
		id: 'outdoors',
		interests: ['nature', 'adventure'],
		category: { nature: 2.2, adventure: 2, exercise: 1.6, home: 0.35, errands: 0.3, art: 0.6 },
		type: { notice: 1.5, count: 1.3, task: 1, question: 0.8, think: 0.7 },
		tag: { plants: 1.6, birds: 1.6, sky: 1.4, screens: 0.3, paperwork: 0.25 },
		base: 0.45
	},
	{
		id: 'maker',
		interests: ['art', 'cooking'],
		category: { art: 2.4, cooking: 2, learn: 1.4, exercise: 0.3, errands: 0.4, adventure: 0.5 },
		type: { create: 1.8, choose: 1.2, think: 1.1, count: 0.6 },
		tag: { colour: 1.5, hands: 1.5, dinner: 1.4, cardio: 0.3 },
		base: 0.45
	},
	{
		id: 'indifferent',
		interests: [],
		category: {},
		type: {},
		tag: {},
		base: 0.5
	}
];

function completionOdds(persona: Persona, nudge: Nudge): number {
	let odds = persona.base;
	odds *= persona.category[nudge.category] ?? 1;
	odds *= persona.type[nudge.type] ?? 1;
	for (const tag of nudge.tags) odds *= persona.tag[tag] ?? 1;
	return Math.min(0.98, Math.max(0.02, odds));
}

// #endregion

// #region scripted world

const HOURS: { hour: number; timeOfDay: NudgeContext['time_of_day'] }[] = [
	{ hour: 6, timeOfDay: 'dawn' },
	{ hour: 10, timeOfDay: 'day' },
	{ hour: 14, timeOfDay: 'day' },
	{ hour: 18, timeOfDay: 'dusk' },
	{ hour: 21, timeOfDay: 'night' }
];

/** WMO codes Open-Meteo really reports, rotated so gated nudges all become reachable */
const WEATHER_SCRIPT: { code: number; temperature_c: number; wind_speed_kmh: number }[] = [
	{ code: 0, temperature_c: 22, wind_speed_kmh: 6 },
	{ code: 3, temperature_c: 14, wind_speed_kmh: 12 },
	{ code: 61, temperature_c: 11, wind_speed_kmh: 18 },
	{ code: 71, temperature_c: -2, wind_speed_kmh: 9 },
	{ code: 45, temperature_c: 5, wind_speed_kmh: 3 },
	{ code: 95, temperature_c: 24, wind_speed_kmh: 34 },
	{ code: 1, temperature_c: 30, wind_speed_kmh: 4 },
	{ code: 80, temperature_c: 17, wind_speed_kmh: 22 }
];

const LATITUDE = 41.88;
const LONGITUDE = -87.63;

interface World {
	now: Date;
	day: string;
	hour: number;
	timeOfDay: NudgeContext['time_of_day'];
	weather: WeatherSnapshot;
}

// #endregion

// #region metrics

interface ArmMetrics {
	/** mean pairwise 1 - similarity inside a day's core slate */
	ild4: number;
	coverage: number;
	completionRate: number;
	/**
	 * Mean scripted completion odds of everything the deck offered. This is the metric
	 * that answers "did the model find the preference", because it reads the persona's
	 * taste directly instead of waiting on the coin flip that realizes it.
	 */
	preferenceMatch: number;
	/**
	 * Stdev of per-item show share against an even split over the items the scripted days
	 * actually made eligible. Satiation should flatten it; measuring against the whole
	 * catalog instead would penalize an arm for items it was never allowed to reach.
	 */
	showSkew: number;
	/** share of the reachable pool that was shown at least once */
	reachableCoverage: number;
	/** eligible often enough to have been shown, and never was */
	dark: string[];
	/** never eligible on any day; structurally gated, reported not gated */
	neverEligible: number;
	categorySkew: number;
	shown: number;
	completed: number;
	shortfallDays: number;
	bonusOffered: number;
	catalogSize: number;
}

function round(value: number, places = 4): number {
	const factor = 10 ** places;
	return Math.round(value * factor) / factor;
}

function stdev(values: readonly number[], target: number): number {
	if (values.length === 0) return 0;
	const variance = values.reduce((sum, value) => sum + (value - target) ** 2, 0) / values.length;
	return Math.sqrt(variance);
}

// #endregion

type Sources = {
	recommend: typeof import('~/utils/recommend');
	data: typeof import('~/utils/data');
	day: typeof import('~/utils/day');
	weather: typeof import('~/utils/weather');
};

/** the shipped modules under test, reached through the harness alias rewriter */
async function loadSources(): Promise<Sources> {
	installSourceResolver();
	const [recommend, data, day, weather] = await Promise.all([
		import('~/utils/recommend'),
		import('~/utils/data'),
		import('~/utils/day'),
		import('~/utils/weather')
	]);
	return { recommend, data, day, weather };
}

function buildWorld(sources: Sources, offset: number): World {
	const now = new Date(Date.UTC(START.year, START.month, START.day + offset, 12));
	const slot = HOURS[offset % HOURS.length] as (typeof HOURS)[number];
	const script = WEATHER_SCRIPT[offset % WEATHER_SCRIPT.length] as (typeof WEATHER_SCRIPT)[number];
	const condition = sources.weather.conditionForCode(script.code) ?? 'clear';

	return {
		now,
		day: sources.day.dayKey(now),
		hour: slot.hour,
		timeOfDay: slot.timeOfDay,
		weather: {
			code: script.code,
			condition,
			temperature_c: script.temperature_c,
			wind_speed_kmh: script.wind_speed_kmh,
			humidity: 55,
			uv_index: script.code === 0 ? 7 : 2,
			is_day: slot.timeOfDay !== 'night',
			fetched_at: now.getTime(),
			latitude: LATITUDE,
			longitude: LONGITUDE
		}
	};
}

interface RunInput {
	sources: Sources;
	catalog: readonly Nudge[];
	persona: Persona;
	seed: string;
	tuning: Partial<RecommendTuning>;
	cooldownDays: number;
	enabledCategories?: readonly NudgeCategory[];
}

/**
 * One persona's 180 days. Everything the picker offers is answered by the persona's
 * taste through a seeded coin, and the answer goes straight back into the ledger, so
 * the loop is closed exactly as the app closes it.
 */
function runPersona(input: RunInput): ArmMetrics {
	const { sources, catalog, persona, seed, tuning, cooldownDays, enabledCategories } = input;
	const { recommendDaily, nudgeSimilarity } = sources.recommend;

	// common random numbers: the coin is a function of persona, day and item rather than a
	// position in a stream, so two arms that offer the same nudge on the same day get the
	// same answer. Without it the arm-to-arm noise is larger than the effect being read
	const coinFor = (day: string, id: string) =>
		sources.day.seededRandom(sources.day.hashString(`${seed}:${persona.id}:${day}:${id}`))();

	const entries: LedgerEntry[] = [];
	const eligibleDays = new Map<string, number>();
	const shownCount = new Map<string, number>();
	const categoryShown = new Map<NudgeCategory, number>();

	let points = 0;
	let streak = 0;
	let shown = 0;
	let completed = 0;
	let shortfallDays = 0;
	let bonusOffered = 0;
	let ildTotal = 0;
	let ildDays = 0;
	let oddsTotal = 0;

	const resolve = (nudge: Nudge, world: World) => {
		shown++;
		shownCount.set(nudge.id, (shownCount.get(nudge.id) ?? 0) + 1);
		categoryShown.set(nudge.category, (categoryShown.get(nudge.category) ?? 0) + 1);

		const odds = completionOdds(persona, nudge);
		oddsTotal += odds;

		const done = coinFor(world.day, nudge.id) < odds;
		if (done) {
			completed++;
			points += nudge.points;
		}

		entries.push({
			id: nudge.id,
			category: nudge.category,
			type: nudge.type,
			outcome: done ? 'passed' : 'skipped',
			points: done ? nudge.points : 0,
			at: world.now.getTime(),
			day: world.day,
			duration_minutes: nudge.duration_minutes
		});

		return done;
	};

	for (let offset = 0; offset < DAYS; offset++) {
		const world = buildWorld(sources, offset);
		const completions: Record<string, number> = {};
		for (const entry of entries) {
			if (entry.outcome !== 'skipped') {
				completions[entry.id] = Math.max(completions[entry.id] ?? 0, entry.at);
			}
		}

		const ctx: NudgeContext = {
			now: world.now,
			day: world.day,
			hour: world.hour,
			weekday: world.now.getUTCDay(),
			time_of_day: world.timeOfDay,
			season: sources.day.seasonFor(world.now, LATITUDE),
			moon_phase: sources.day.moonPhaseFor(world.now),
			moon_illumination: sources.day.moonIllumination(world.now),
			locale: LOCALE,
			points,
			streak_days: streak,
			completed_today: 0,
			completions,
			granted_permissions: ['camera', 'microphone', 'location', 'notifications'],
			installed_packs: ['vision', 'text', 'audio', 'writing'],
			weather: world.weather,
			latitude: LATITUDE,
			longitude: LONGITUDE
		};

		const result = recommendDaily(catalog, ctx, entries, {
			count: DAILY_COUNT,
			cooldownDays,
			enabledCategories,
			interests: persona.interests,
			installSeed: seed,
			tuning
		});

		for (const row of result.scored) {
			eligibleDays.set(row.nudge.id, (eligibleDays.get(row.nudge.id) ?? 0) + 1);
		}
		if (result.shortfall > 0) shortfallDays++;

		const slate = result.nudges;
		if (slate.length > 1) {
			let total = 0;
			let pairs = 0;
			for (let i = 0; i < slate.length; i++) {
				for (let j = i + 1; j < slate.length; j++) {
					total += 1 - nudgeSimilarity(slate[i] as Nudge, slate[j] as Nudge);
					pairs++;
				}
			}
			ildTotal += total / pairs;
			ildDays++;
		}

		for (const nudge of slate) resolve(nudge, world);

		// the app unlocks the bonus once every core nudge is resolved, skips included
		if (slate.length > 0 && result.bonus) {
			bonusOffered++;
			resolve(result.bonus, world);
		}

		streak = slate.length > 0 ? streak + 1 : 0;
	}

	const dark = [...eligibleDays]
		.filter(([id, days]) => days >= DARK_MIN_ELIGIBLE_DAYS && !shownCount.has(id))
		.map(([id]) => id)
		.sort();

	const categories = [...new Set(catalog.map((nudge) => nudge.category))];
	const shares = categories.map((category) => (categoryShown.get(category) ?? 0) / (shown || 1));
	const reachable = [...eligibleDays.keys()];
	const itemShares = reachable.map((id) => (shownCount.get(id) ?? 0) / (shown || 1));

	return {
		ild4: ildDays === 0 ? 0 : ildTotal / ildDays,
		coverage: shownCount.size / catalog.length,
		completionRate: shown === 0 ? 0 : completed / shown,
		preferenceMatch: shown === 0 ? 0 : oddsTotal / shown,
		showSkew: stdev(itemShares, 1 / (reachable.length || 1)),
		reachableCoverage: reachable.length === 0 ? 0 : shownCount.size / reachable.length,
		dark,
		neverEligible: catalog.length - eligibleDays.size,
		categorySkew: stdev(shares, 1 / categories.length),
		shown,
		completed,
		shortfallDays,
		bonusOffered,
		catalogSize: catalog.length
	};
}

function mergeArms(runs: readonly ArmMetrics[]): ArmMetrics {
	const total = runs.reduce((sum, run) => sum + run.shown, 0);
	const weighted = (pick: (run: ArmMetrics) => number) =>
		runs.reduce((sum, run) => sum + pick(run) * run.shown, 0) / (total || 1);

	return {
		ild4: runs.reduce((sum, run) => sum + run.ild4, 0) / (runs.length || 1),
		coverage: runs.reduce((sum, run) => sum + run.coverage, 0) / (runs.length || 1),
		completionRate: weighted((run) => run.completionRate),
		preferenceMatch: weighted((run) => run.preferenceMatch),
		showSkew: runs.reduce((sum, run) => sum + run.showSkew, 0) / (runs.length || 1),
		reachableCoverage:
			runs.reduce((sum, run) => sum + run.reachableCoverage, 0) / (runs.length || 1),
		dark: [...new Set(runs.flatMap((run) => run.dark))].sort(),
		neverEligible: Math.max(...runs.map((run) => run.neverEligible)),
		categorySkew: runs.reduce((sum, run) => sum + run.categorySkew, 0) / (runs.length || 1),
		shown: total,
		completed: runs.reduce((sum, run) => sum + run.completed, 0),
		shortfallDays: runs.reduce((sum, run) => sum + run.shortfallDays, 0),
		bonusOffered: runs.reduce((sum, run) => sum + run.bonusOffered, 0),
		catalogSize: runs[0]?.catalogSize ?? 0
	};
}

// #region arms and sweeps

interface Arm {
	id: string;
	why: string;
	tuning: Partial<RecommendTuning>;
	/** the settings cooldown this arm runs under; the default is what the app ships */
	cooldownDays?: number;
	/** a narrowed settings pool, for the regime where the deck runs out of room */
	enabledCategories?: NudgeCategory[];
}

/** matches the shipped default in useSettings */
const DEFAULT_COOLDOWN = 21;

/**
 * The cooldown a user who wants repeats would pick. Item satiation is close to inert at
 * the 21-day default, because a 120-item catalog and ~900 shows means the hard wall is
 * already the binding constraint; this is the regime where the decay curve does the work.
 */
const SHORT_COOLDOWN = 2;

/** two categories left on and the cooldown at its floor: the smallest pool the app allows */
const NARROW: NudgeCategory[] = ['nature', 'art'];

const ARMS: Arm[] = [
	{ id: 'shipped', why: 'RECOMMEND_TUNING as it stands', tuning: {} },
	{
		id: 'unlearned',
		why: 'blend forced to 0; the deck before this change',
		tuning: { blendK: Number.POSITIVE_INFINITY }
	},
	{ id: 'no-mmr', why: 'MMR off, so only the old variety penalties remain', tuning: { mmrMu: 0 } },
	{
		id: 'no-calibration',
		why: 'the across-week category balance term off',
		tuning: { calibrationWeight: 0 }
	},
	{
		id: 'greedy',
		why: 'full confidence from the first interaction; the adversarial case for dark items',
		tuning: { blendK: 1 }
	},
	{
		id: 'narrow',
		why: `${NARROW.join(' + ')} only at cooldown ${SHORT_COOLDOWN}; the pool the decay curve is for`,
		tuning: {},
		cooldownDays: SHORT_COOLDOWN,
		enabledCategories: NARROW
	},
	{
		id: 'narrow-no-satiation',
		why: 'the same narrow pool with both satiation terms off',
		tuning: { itemSatiationDepth: 0, categorySatiationDepth: 0 },
		cooldownDays: SHORT_COOLDOWN,
		enabledCategories: NARROW
	}
];

interface SweepPoint {
	knob: string;
	value: number;
	metrics: ArmMetrics;
}

const SWEEPS: { knob: keyof RecommendTuning; values: number[] }[] = [
	{ knob: 'mmrMu', values: [0, 0.4, 0.8, 1.2, 1.6] },
	{ knob: 'calibrationWeight', values: [0, 0.25, 0.5, 0.75, 1] },
	{ knob: 'blendK', values: [5, 10, 20, 40] },
	{ knob: 'itemSatiationDepth', values: [0, 0.5, 0.8, 0.95] },
	{ knob: 'itemSatiationHalfLifeDays', values: [3, 10, 21, 45] },
	{ knob: 'categorySatiationHalfLifeDays', values: [1, 2, 4, 7] },
	{ knob: 'interestPseudoCount', values: [0, 3, 6, 12] },
	{ knob: 'skipEvidenceWeight', values: [0.1, 0.2, 0.5, 1] }
];

// #endregion

// #region reporting

function table(header: readonly string[], rows: readonly string[][]): string {
	const widths = header.map((cell, index) =>
		Math.max(cell.length, ...rows.map((row) => (row[index] ?? '').length))
	);
	const line = (cells: readonly string[]) =>
		'  ' +
		cells
			.map((cell, index) => (cell ?? '').padEnd(widths[index] ?? 0))
			.join('  ')
			.trimEnd();

	return [line(header), line(widths.map((width) => '-'.repeat(width))), ...rows.map(line)].join(
		'\n'
	);
}

function fmt(value: number, places = 3): string {
	return value.toFixed(places);
}

async function formatJson(json: string): Promise<string> {
	try {
		const prettier = await import('prettier');
		const config = await prettier.resolveConfig(REPORT_PATH);
		return await prettier.format(json, { ...config, filepath: REPORT_PATH });
	} catch {
		// prettier is a dev dependency; an unformatted report beats no report
		return json;
	}
}

// #endregion

async function main() {
	const sources = await loadSources();
	const loaded = await sources.data.loadCatalog(LOCALE);
	if (loaded.issues.length > 0) {
		console.error(`catalog has ${loaded.issues.length} authoring issue(s); fix those first`);
		for (const issue of loaded.issues) {
			console.error(`  ${issue.path}[${issue.index}]: ${issue.message}`);
		}
	}
	const catalog = loaded.nudges;

	const runArm = (
		tuning: Partial<RecommendTuning>,
		cooldownDays = DEFAULT_COOLDOWN,
		enabledCategories?: readonly NudgeCategory[]
	) => {
		const perPersona = new Map<string, ArmMetrics>();
		PERSONAS.forEach((persona, index) => {
			perPersona.set(
				persona.id,
				runPersona({
					sources,
					catalog,
					persona,
					seed: SEEDS[index % SEEDS.length] as string,
					tuning,
					cooldownDays,
					enabledCategories
				})
			);
		});
		return { merged: mergeArms([...perPersona.values()]), perPersona };
	};

	const armResults = new Map<string, { merged: ArmMetrics; perPersona: Map<string, ArmMetrics> }>();
	for (const arm of ARMS) {
		armResults.set(
			arm.id,
			runArm(arm.tuning, arm.cooldownDays ?? DEFAULT_COOLDOWN, arm.enabledCategories)
		);
	}

	// every persona, not just one: a single run leaves +-0.005 of noise on ILD, which is
	// the same size as the effect the sweep is trying to read
	const sweeps: SweepPoint[] = [];
	for (const sweep of SWEEPS) {
		for (const value of sweep.values) {
			sweeps.push({
				knob: sweep.knob,
				value,
				metrics: runArm({ [sweep.knob]: value }).merged
			});
		}
	}

	const shipped = armResults.get('shipped')?.merged as ArmMetrics;
	const gateFailures: string[] = [];

	if (shipped.dark.length > 0) {
		gateFailures.push(
			`${shipped.dark.length} catalog item(s) were eligible >= ${DARK_MIN_ELIGIBLE_DAYS} days and never shown: ${shipped.dark.slice(0, 5).join(', ')}`
		);
	}
	if (shipped.coverage < COVERAGE_FLOOR) {
		gateFailures.push(
			`coverage ${fmt(shipped.coverage)} is below the ${COVERAGE_FLOOR.toFixed(2)} floor`
		);
	}
	if (shipped.completionRate < COMPLETION_FLOOR) {
		gateFailures.push(
			`completion rate ${fmt(shipped.completionRate)} is below the ${COMPLETION_FLOOR.toFixed(2)} floor`
		);
	}

	const beats = (
		arm: string,
		metric: keyof ArmMetrics,
		direction: 'up' | 'down',
		label: string
	) => {
		const other = armResults.get(arm)?.merged;
		if (!other) return;
		const mine = shipped[metric] as number;
		const theirs = other[metric] as number;
		const better = direction === 'up' ? mine > theirs : mine < theirs;
		if (!better) {
			gateFailures.push(
				`${label}: shipped ${fmt(mine)} does not beat ${arm} ${fmt(theirs)} (wanted ${direction === 'up' ? 'higher' : 'lower'})`
			);
		}
	};

	beats('unlearned', 'preferenceMatch', 'up', 'the learned layer finds the preference');
	beats('unlearned', 'completionRate', 'up', 'and that turns into completions');
	beats('no-mmr', 'ild4', 'up', 'MMR buys diversity');
	beats('no-calibration', 'categorySkew', 'down', 'calibration evens the category mix');
	const narrow = armResults.get('narrow')?.merged;
	const narrowFlat = armResults.get('narrow-no-satiation')?.merged;
	if (narrow && narrowFlat && !(narrow.showSkew < narrowFlat.showSkew)) {
		gateFailures.push(
			`satiation spreads exposure in a narrow pool: ${fmt(narrow.showSkew, 5)} does not beat ${fmt(narrowFlat.showSkew, 5)}`
		);
	}
	if (narrow && narrow.dark.length > 0) {
		gateFailures.push(
			`a narrow pool must still reach everything in it, and ${narrow.dark.length} item(s) went dark: ${narrow.dark.slice(0, 5).join(', ')}`
		);
	}

	const greedy = armResults.get('greedy')?.merged;
	if (greedy && greedy.dark.length > 0) {
		gateFailures.push(
			`even at full confidence nothing may go permanently dark, and ${greedy.dark.length} item(s) did: ${greedy.dark.slice(0, 5).join(', ')}`
		);
	}

	printReport(catalog, armResults, sweeps, shipped, gateFailures);
	await writeReport(catalog, armResults, sweeps, gateFailures);

	if (gateFailures.length > 0) process.exitCode = 1;
}

function printReport(
	catalog: readonly Nudge[],
	armResults: Map<string, { merged: ArmMetrics; perPersona: Map<string, ArmMetrics> }>,
	sweeps: readonly SweepPoint[],
	shipped: ArmMetrics,
	gateFailures: readonly string[]
) {
	const lines: string[] = [];
	const push = (text = '') => lines.push(text);

	push('recess recommender eval');
	push();
	push(`  catalog        ${catalog.length} nudges, locale ${LOCALE}`);
	push(`  simulation     ${DAYS} days x ${DAILY_COUNT} core + bonus, ${PERSONAS.length} personas`);
	push(`  personas       ${PERSONAS.map((persona) => persona.id).join(', ')}`);
	push(
		`  gate           no dark item, coverage >= ${COVERAGE_FLOOR.toFixed(2)}, completion >= ${COMPLETION_FLOOR.toFixed(2)},`
	);
	push('                 and shipped beats each ablation on the metric it exists for');
	push();

	push('arms');
	push(
		table(
			[
				'arm',
				'ILD@4',
				'reach cov',
				'completion',
				'pref match',
				'cat skew',
				'item skew',
				'dark',
				'unreachable'
			],
			[...armResults].map(([id, result]) => {
				const metrics = result.merged;
				return [
					id,
					fmt(metrics.ild4),
					fmt(metrics.reachableCoverage),
					fmt(metrics.completionRate),
					fmt(metrics.preferenceMatch),
					fmt(metrics.categorySkew, 4),
					fmt(metrics.showSkew, 5),
					String(metrics.dark.length),
					String(metrics.neverEligible)
				];
			})
		)
	);
	push('  every arm answers the same nudge on the same day with the same coin, so the');
	push('  completion column is a like-for-like comparison and not a fresh sample per arm');
	push('  ILD@4 is the mean pairwise 1 - similarity inside a day of 4; higher is more varied');
	push('  reach cov is the share of the reachable pool shown at least once, not of the catalog');
	push('  pref match is the mean scripted completion odds of what the deck offered');
	push('  cat skew and item skew are stdev from an even split; lower is more even');
	push('  unreachable counts items no scripted day made eligible, which the gate ignores');
	push();

	push('shipped arm, per persona');
	push(
		table(
			['persona', 'ILD@4', 'coverage', 'completion', 'pref match', 'cat skew', 'dark', 'bonus'],
			[...(armResults.get('shipped')?.perPersona ?? [])].map(([id, metrics]) => [
				id,
				fmt(metrics.ild4),
				fmt(metrics.coverage),
				fmt(metrics.completionRate),
				fmt(metrics.preferenceMatch),
				fmt(metrics.categorySkew, 4),
				String(metrics.dark.length),
				String(metrics.bonusOffered)
			])
		)
	);
	push();

	push('what the learned layer is worth, shipped minus unlearned');
	push(
		table(
			['persona', 'pref match', 'completion'],
			[...(armResults.get('shipped')?.perPersona ?? [])].map(([id, metrics]) => {
				const flat = armResults.get('unlearned')?.perPersona.get(id);
				const delta = (mine: number, theirs: number | undefined) =>
					theirs === undefined ? 'n/a' : `${mine - theirs >= 0 ? '+' : ''}${fmt(mine - theirs)}`;
				return [
					id,
					delta(metrics.preferenceMatch, flat?.preferenceMatch),
					delta(metrics.completionRate, flat?.completionRate)
				];
			})
		)
	);
	push('  the ceiling here is low on purpose: the category cap, the recency penalty and');
	push('  MMR all push away from a favourite, so exploitation is bounded by design');
	push();

	push('tuning sweeps, averaged over every persona');
	push(
		table(
			[
				'knob',
				'value',
				'ILD@4',
				'coverage',
				'completion',
				'pref match',
				'cat skew',
				'item skew',
				'dark'
			],
			sweeps.map((point) => [
				point.knob,
				String(point.value),
				fmt(point.metrics.ild4),
				fmt(point.metrics.coverage),
				fmt(point.metrics.completionRate),
				fmt(point.metrics.preferenceMatch),
				fmt(point.metrics.categorySkew, 4),
				fmt(point.metrics.showSkew, 5),
				String(point.metrics.dark.length)
			])
		)
	);
	push('  one knob moved at a time, everything else at its shipped value');
	push();

	if (shipped.dark.length > 0) {
		push('dark items in the shipped arm');
		for (const id of shipped.dark.slice(0, 20)) push(`  ${id}`);
		push();
	}

	if (gateFailures.length > 0) {
		push('GATE FAILED');
		for (const failure of gateFailures) push(`  ${failure}`);
	} else {
		push('gate passed');
	}
	push();
	push(`report written to ${REPORT_PATH}`);

	console.log(lines.join('\n'));
}

async function writeReport(
	catalog: readonly Nudge[],
	armResults: Map<string, { merged: ArmMetrics; perPersona: Map<string, ArmMetrics> }>,
	sweeps: readonly SweepPoint[],
	gateFailures: readonly string[]
) {
	const shape = (metrics: ArmMetrics) => ({
		ild4: round(metrics.ild4),
		coverage: round(metrics.coverage),
		completionRate: round(metrics.completionRate),
		preferenceMatch: round(metrics.preferenceMatch),
		showSkew: round(metrics.showSkew, 6),
		reachableCoverage: round(metrics.reachableCoverage),
		categorySkew: round(metrics.categorySkew),
		dark: metrics.dark,
		neverEligible: metrics.neverEligible,
		shown: metrics.shown,
		completed: metrics.completed,
		shortfallDays: metrics.shortfallDays,
		bonusOffered: metrics.bonusOffered,
		catalogSize: metrics.catalogSize
	});

	const report = {
		generatedAt: new Date().toISOString(),
		simulation: {
			days: DAYS,
			dailyCount: DAILY_COUNT,
			locale: LOCALE,
			start: START,
			catalogSize: catalog.length,
			darkMinEligibleDays: DARK_MIN_ELIGIBLE_DAYS,
			personas: PERSONAS.map((persona) => ({
				id: persona.id,
				interests: persona.interests,
				base: persona.base
			}))
		},
		arms: Object.fromEntries(
			ARMS.map((arm) => {
				const result = armResults.get(arm.id);
				return [
					arm.id,
					{
						why: arm.why,
						tuning: Object.fromEntries(
							Object.entries(arm.tuning).map(([key, value]) => [
								key,
								Number.isFinite(value) ? value : String(value)
							])
						),
						merged: shape(result?.merged as ArmMetrics),
						perPersona: Object.fromEntries(
							[...(result?.perPersona ?? [])].map(([id, metrics]) => [id, shape(metrics)])
						)
					}
				];
			})
		),
		sweeps: {
			personas: PERSONAS.map((persona) => persona.id),
			points: sweeps.map((point) => ({
				knob: point.knob,
				value: point.value,
				...shape(point.metrics)
			}))
		},
		gate: {
			coverageFloor: COVERAGE_FLOOR,
			completionFloor: COMPLETION_FLOOR,
			failures: gateFailures,
			passed: gateFailures.length === 0
		}
	};

	writeFileSync(REPORT_PATH, await formatJson(`${JSON.stringify(report, null, '\t')}\n`));
}

await main();
