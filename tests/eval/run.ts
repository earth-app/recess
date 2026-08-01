import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DeviceTier } from '~/types/models';
import type {
	AudioValidationData,
	ModelPack,
	Nudge,
	PhotoValidationData,
	TextValidationData
} from '~/types/nudge';
import type { Verdict } from '~/utils/validate';
import type { AudioCase, Corpus, PhotoCase, TextCase } from './fixtures';
import { FIXTURE_DIR, loadCorpus } from './fixtures';
import type { Sources } from './harness';
import { EVAL_DIR, loadPackBytes, loadSources } from './harness';
import type { CaseResult, Latency, Metrics, Sweep, ValidatorKind } from './metrics';
import { VALIDATOR_KINDS, latencyOf, metricsAtShipped, round, sweepThresholds } from './metrics';
import type { EvalBackend, FailureSink, PackRequest, WarmResult } from './scorers';
import { createRealBackend, createStubBackend } from './scorers';

const REPORT_PATH = join(EVAL_DIR, 'report.json');
const ALL_TIERS: DeviceTier[] = [1, 2, 3];

/** the language every fixture is written in; running another locale compares across it */
const CORPUS_LANGUAGE = 'en';

// #region options

interface Options {
	tiers: DeviceTier[];
	locale: string;
	minF1: number;
	real: boolean;
	webgpu: boolean;
	compareTiers: boolean;
}

function parseOptions(argv: readonly string[]): Options {
	const flags = new Set(argv.filter((arg) => arg.startsWith('--')));
	const value = (name: string): string | null => {
		const hit = argv.find((arg) => arg.startsWith(`--${name}=`));
		return hit ? hit.slice(name.length + 3) : null;
	};

	const compareTiers = flags.has('--tiers');
	const single = Number(value('tier') ?? '2');
	if (!ALL_TIERS.includes(single as DeviceTier)) {
		throw new Error(`--tier must be 1, 2 or 3; received ${single}`);
	}

	const minF1 = Number(process.env.EVAL_MIN_F1 ?? '0.7');
	if (!Number.isFinite(minF1) || minF1 < 0 || minF1 > 1) {
		throw new Error(`EVAL_MIN_F1 must be a number in 0-1; received ${process.env.EVAL_MIN_F1}`);
	}

	return {
		tiers: compareTiers ? ALL_TIERS : [single as DeviceTier],
		locale: value('locale') ?? 'en',
		minF1,
		real: process.env.EVAL_REAL === '1',
		webgpu: process.env.EVAL_WEBGPU === '1',
		compareTiers
	};
}

// #endregion

// #region corpus wiring

interface Target {
	nudge: Nudge;
	validator: ValidatorKind;
}

function targetsFrom(sources: Sources, nudges: readonly Nudge[]): Map<string, Target> {
	const targets = new Map<string, Target>();
	for (const nudge of nudges) {
		const validator = sources.nudge.nudgeValidationType(nudge);
		if (validator === 'text' || validator === 'photo' || validator === 'audio') {
			targets.set(nudge.id, { nudge, validator });
		}
	}
	return targets;
}

interface CorpusCheck {
	errors: string[];
	counts: Record<
		ValidatorKind,
		{ cases: number; nudges: number; positives: number; negatives: number }
	>;
}

function checkCorpus(
	targets: Map<string, Target>,
	byValidator: Record<ValidatorKind, { nudgeId: string; shouldPass: boolean }[]>
): CorpusCheck {
	const errors: string[] = [];
	const counts = {} as CorpusCheck['counts'];

	for (const kind of VALIDATOR_KINDS) {
		const cases = byValidator[kind];
		const covered = new Set<string>();

		for (const entry of cases) {
			const target = targets.get(entry.nudgeId);
			if (!target) {
				errors.push(`${kind}.json references ${entry.nudgeId}, which is not in the catalog`);
				continue;
			}
			if (target.validator !== kind) {
				errors.push(
					`${kind}.json references ${entry.nudgeId}, which is a ${target.validator} nudge`
				);
				continue;
			}
			covered.add(entry.nudgeId);
		}

		for (const [id, target] of targets) {
			if (target.validator === kind && !covered.has(id)) {
				errors.push(`${id} is a ${kind} nudge with no fixture case`);
			}
		}

		const positives = cases.filter((entry) => entry.shouldPass).length;
		const negatives = cases.length - positives;
		if (positives === 0 || negatives === 0) {
			errors.push(
				`${kind}.json needs both passing and failing cases to compute precision and recall`
			);
		}

		counts[kind] = { cases: cases.length, nudges: covered.size, positives, negatives };
	}

	return { errors, counts };
}

// #endregion

// #region running cases

function makeSink(): { sink: FailureSink; reason: () => string | null } {
	let reason: string | null = null;
	return {
		sink: {
			record: (stage, message) => {
				reason = `${stage}: ${message}`;
			}
		},
		reason: () => reason
	};
}

function verdictToResult(
	base: Omit<CaseResult, 'status' | 'score' | 'detail' | 'latencyMs'>,
	verdict: Verdict,
	latencyMs: number,
	sinkReason: string | null
): CaseResult {
	const detail =
		verdict.status === 'unavailable' ? (sinkReason ?? verdict.reason) : (verdict.detail ?? null);

	return {
		...base,
		status: verdict.status,
		score: verdict.status === 'unavailable' ? null : (verdict.score ?? null),
		detail,
		latencyMs
	};
}

function skipped(
	base: Omit<CaseResult, 'status' | 'score' | 'detail' | 'latencyMs'>,
	reason: string
): CaseResult {
	return { ...base, status: 'unavailable', score: null, detail: reason, latencyMs: 0 };
}

async function runValidator<T>(
	cases: readonly T[],
	run: (entry: T) => Promise<CaseResult>
): Promise<CaseResult[]> {
	const results: CaseResult[] = [];
	// serial on purpose; concurrent inference would make the latency numbers meaningless
	for (const entry of cases) results.push(await run(entry));
	return results;
}

function hasMedia(file: string | undefined): boolean {
	return file !== undefined && existsSync(join(FIXTURE_DIR, file));
}

/** a real recording or photo when the corpus carries one; null falls back to the text stand-in */
function mediaBlob(dir: string, file: string | undefined): Blob | null {
	if (!hasMedia(file)) return null;
	return new Blob([readFileSync(join(dir, file as string))]);
}

interface RunContext {
	sources: Sources;
	backend: EvalBackend;
	tier: DeviceTier;
	locale: string;
	targets: Map<string, Target>;
}

async function runTextCases(
	context: RunContext,
	cases: readonly TextCase[]
): Promise<CaseResult[]> {
	const { sources, backend, tier, locale, targets } = context;

	return runValidator(cases, async (entry) => {
		const target = targets.get(entry.nudgeId);
		const data = validationData<TextValidationData>(target);
		const base = {
			nudgeId: entry.nudgeId,
			validator: 'text' as const,
			note: entry.note,
			shouldPass: entry.shouldPass,
			shippedThreshold: shippedThreshold(sources, data?.threshold)
		};
		if (!data) return skipped(base, 'the nudge is missing from the catalog');

		const { sink, reason } = makeSink();
		const started = performance.now();
		const verdict = await sources.validate.validateText(data, entry.text, {
			scorers: backend.scorers(tier, locale, sink)
		});
		return verdictToResult(base, verdict, performance.now() - started, reason());
	});
}

async function runPhotoCases(
	context: RunContext,
	cases: readonly PhotoCase[]
): Promise<CaseResult[]> {
	const { sources, backend, tier, locale, targets } = context;

	return runValidator(cases, async (entry) => {
		const target = targets.get(entry.nudgeId);
		const data = validationData<PhotoValidationData>(target);
		const base = {
			nudgeId: entry.nudgeId,
			validator: 'photo' as const,
			note: entry.note,
			shouldPass: entry.shouldPass,
			shippedThreshold: shippedThreshold(sources, data?.threshold)
		};
		if (!data) return skipped(base, 'the nudge is missing from the catalog');

		const real = mediaBlob(FIXTURE_DIR, entry.image);
		if (backend.id === 'real' && !real) {
			return skipped(base, 'no real image in the corpus; a caption cannot be shown to CLIP');
		}

		// the stub reads this blob back as text; that is the caption-for-image approximation
		const image = real ?? new Blob([entry.describedAs], { type: 'text/plain' });

		const { sink, reason } = makeSink();
		const started = performance.now();
		const verdict = await sources.validate.validatePhoto(data, image, {
			scorers: backend.scorers(tier, locale, sink)
		});
		return verdictToResult(base, verdict, performance.now() - started, reason());
	});
}

async function runAudioCases(
	context: RunContext,
	cases: readonly AudioCase[]
): Promise<CaseResult[]> {
	const { sources, backend, tier, locale, targets } = context;

	return runValidator(cases, async (entry) => {
		const target = targets.get(entry.nudgeId);
		const data = validationData<AudioValidationData>(target);
		const base = {
			nudgeId: entry.nudgeId,
			validator: 'audio' as const,
			note: entry.note,
			shouldPass: entry.shouldPass,
			shippedThreshold: shippedThreshold(sources, data?.threshold)
		};
		if (!data) return skipped(base, 'the nudge is missing from the catalog');

		const real = mediaBlob(FIXTURE_DIR, entry.audio);
		// the stub reads the transcript back out of this blob, keeping ml.transcribe in the
		// path; real whisper cannot decode text, so it gets the transcript injected below
		const audio = real ?? new Blob([entry.transcript], { type: 'text/plain' });

		const { sink, reason } = makeSink();
		const scorers = backend.scorers(tier, locale, sink);
		const withTranscript =
			backend.id === 'real' && !real
				? { ...scorers, transcribe: async () => entry.transcript }
				: scorers;

		const started = performance.now();
		const verdict = await sources.validate.validateAudio(data, audio, entry.seconds, {
			scorers: withTranscript
		});
		return verdictToResult(base, verdict, performance.now() - started, reason());
	});
}

function validationData<T>(target: Target | undefined): T | null {
	if (!target) return null;
	const nudge = target.nudge as Nudge & { validation_data?: unknown };
	return (nudge.validation_data as T | undefined) ?? null;
}

function shippedThreshold(sources: Sources, raw: unknown): number | null {
	const normalized = sources.rubric.normalizeThreshold(raw);
	return normalized.ok ? normalized.value : null;
}

// #endregion

// #region tiers

interface PackReport {
	pack: ModelPack;
	repo: string | null;
	dtype: string | null;
	bytes: number | null;
	bytesUnavailable: string | null;
}

interface TierRun {
	tier: DeviceTier;
	packs: PackReport[];
	totalBytes: number | null;
	totalBytesUnavailable: string | null;
	/** stub only: the repos transformers.js was actually asked for matched the tier table */
	wiring: 'verified' | 'not-instrumented' | 'mismatch';
	requests: PackRequest[];
	warm: WarmResult[];
	validators: Record<ValidatorKind, { metrics: Metrics; sweep: Sweep; latency: Latency }>;
	results: CaseResult[];
}

async function packReports(
	sources: Sources,
	tier: DeviceTier,
	locale: string,
	bytesOf: (repo: string, dtype: string) => Promise<{ bytes: number | null; reason: string | null }>
): Promise<PackReport[]> {
	const table = sources.tiers.tierPacks(tier, locale);

	const reports: PackReport[] = [];
	for (const pack of sources.nudge.MODEL_PACKS) {
		const spec = table[pack];
		if (!spec) {
			reports.push({
				pack,
				repo: null,
				dtype: null,
				bytes: null,
				bytesUnavailable: 'no pack at this tier'
			});
			continue;
		}
		const size = await bytesOf(spec.repo, spec.dtype);
		reports.push({
			pack,
			repo: spec.repo,
			dtype: spec.dtype,
			bytes: size.bytes,
			bytesUnavailable: size.reason
		});
	}
	return reports;
}

/**
 * which packs this run actually puts weights behind. The stub goes through `ml.ts` for
 * all three; the real backend only needs vision or audio once the corpus carries real
 * media, because a caption cannot go to CLIP and a transcript is injected past Whisper.
 */
function packsNeeded(backend: EvalBackend, corpus: Corpus): ModelPack[] {
	if (backend.id === 'stub') return ['text', 'vision', 'audio'];

	const packs: ModelPack[] = ['text'];
	if (corpus.photo.some((entry) => hasMedia(entry.image))) packs.push('vision');
	if (corpus.audio.some((entry) => hasMedia(entry.audio))) packs.push('audio');
	return packs;
}

function wiringOf(
	sources: Sources,
	tier: DeviceTier,
	locale: string,
	requests: PackRequest[]
): TierRun['wiring'] {
	if (requests.length === 0) return 'not-instrumented';
	const table = sources.tiers.tierPacks(tier, locale);
	for (const request of requests) {
		const spec = table[request.pack];
		if (!spec || spec.repo !== request.repo || spec.dtype !== request.dtype) return 'mismatch';
	}
	return 'verified';
}

// #endregion

// #region report

interface Recommendation {
	threshold: number | null;
	f1: number | null;
	shippable: boolean;
	why: string;
}

function recommendationFor(
	backend: EvalBackend,
	kind: ValidatorKind,
	sweep: Sweep,
	metrics: Metrics
): Recommendation {
	if (metrics.scored === 0 || !sweep.best) {
		return {
			threshold: null,
			f1: null,
			shippable: false,
			why: `unavailable: ${metrics.unavailable} of ${metrics.cases} cases could not run and the rest never reached a score`
		};
	}

	const on = `measured on ${metrics.scored} scored case(s)`;

	if (!backend.measuresModelAccuracy) {
		return {
			threshold: sweep.best.threshold,
			f1: sweep.best.f1,
			shippable: false,
			why: `${on}, but the stub scores lexical overlap and its similarity scale is not the shipped embedder's; read this as a pipeline regression check, never as data to ship`
		};
	}

	const why: Record<ValidatorKind, string> = {
		text: `${on} through real embedder weights against the shipped rubrics`,
		photo: `${on} carrying a real image, through real CLIP weights`,
		audio: `${on} through real embedder weights; the threshold applies to the rubric score, which is what this measures, not to transcription`
	};

	return {
		threshold: sweep.best.threshold,
		f1: sweep.best.f1,
		shippable: true,
		why: why[kind]
	};
}

function fmt(value: number | null, places = 3): string {
	return value === null ? 'n/a' : value.toFixed(places);
}

function bytesLabel(bytes: number | null, reason: string | null): string {
	if (bytes === null) return `unavailable (${reason ?? 'no reason recorded'})`;
	return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

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

// #endregion

async function main() {
	const options = parseOptions(process.argv.slice(2));
	const sources = await loadSources();

	const catalog = await sources.data.loadCatalog(options.locale);
	if (catalog.issues.length > 0) {
		console.error(
			`catalog has ${catalog.issues.length} authoring issue(s); fix those before trusting this run`
		);
		for (const issue of catalog.issues)
			console.error(`  ${issue.path}[${issue.index}]: ${issue.message}`);
	}

	const targets = targetsFrom(sources, catalog.nudges);
	const corpus = loadCorpus();
	const check = checkCorpus(targets, {
		text: corpus.text,
		photo: corpus.photo,
		audio: corpus.audio
	});

	const backend = options.real
		? createRealBackend(sources, options.webgpu)
		: createStubBackend(sources);

	const bytesCache = new Map<string, { bytes: number | null; reason: string | null }>();
	const packBytes = await loadPackBytes();
	const bytesOf = async (repo: string, dtype: string) => {
		const key = `${repo}|${dtype}`;
		const cached = bytesCache.get(key);
		if (cached) return cached;

		let entry: { bytes: number | null; reason: string | null };
		if (!packBytes.ok) {
			entry = { bytes: null, reason: packBytes.reason };
		} else {
			const bytes = await packBytes.fetchPackBytes(repo, dtype);
			entry = {
				bytes,
				reason:
					bytes === null ? 'the hub file listing returned no size for this repo and dtype' : null
			};
		}
		bytesCache.set(key, entry);
		return entry;
	};

	const needed = packsNeeded(backend, corpus);

	const runs: TierRun[] = [];
	for (const tier of options.tiers) {
		backend.reset();
		const context: RunContext = { sources, backend, tier, locale: options.locale, targets };
		const warm = await backend.warm(tier, options.locale, needed);

		const results: Record<ValidatorKind, CaseResult[]> = {
			text: await runTextCases(context, corpus.text),
			photo: await runPhotoCases(context, corpus.photo),
			audio: await runAudioCases(context, corpus.audio)
		};

		const validators = {} as TierRun['validators'];
		for (const kind of VALIDATOR_KINDS) {
			validators[kind] = {
				metrics: metricsAtShipped(results[kind]),
				sweep: sweepThresholds(results[kind]),
				latency: latencyOf(results[kind])
			};
		}

		const packs = await packReports(sources, tier, options.locale, bytesOf);
		const wanted = packs.filter((pack) => pack.repo !== null);
		const missing = wanted.filter((pack) => pack.bytes === null);
		const requests = backend.requests();

		runs.push({
			tier,
			packs,
			// a partial sum would read as a total, so one missing pack makes the total unavailable
			totalBytes:
				missing.length > 0 ? null : wanted.reduce((sum, pack) => sum + (pack.bytes ?? 0), 0),
			totalBytesUnavailable:
				missing.length > 0
					? `${missing.length} of ${wanted.length} packs returned no size: ${missing.map((pack) => pack.pack).join(', ')}`
					: null,
			wiring: wiringOf(sources, tier, options.locale, requests),
			requests,
			warm,
			validators,
			results: [...results.text, ...results.photo, ...results.audio]
		});
	}

	// tier 2 is the baseline the tier 3 question is asked against, so it stays primary
	const primary = runs.find((run) => run.tier === 2) ?? runs[0];
	if (!primary) throw new Error('no tier produced a run');

	const recommendations = {} as Record<ValidatorKind, Recommendation>;
	for (const kind of VALIDATOR_KINDS) {
		const { sweep, metrics } = primary.validators[kind];
		recommendations[kind] = recommendationFor(backend, kind, sweep, metrics);
	}

	const gateFailures: string[] = [...check.errors];
	for (const kind of VALIDATOR_KINDS) {
		const best = primary.validators[kind].sweep.best;
		if (best === null || best.f1 === null) {
			gateFailures.push(
				`${kind}: no threshold produced a measurable F1 (every case was unavailable)`
			);
			continue;
		}
		if (best.f1 < options.minF1) {
			gateFailures.push(
				`${kind}: best achievable F1 ${best.f1.toFixed(3)} is below the ${options.minF1.toFixed(2)} floor`
			);
		}
	}

	printReport(options, backend, catalog.chain, check, runs, primary, recommendations, gateFailures);
	await writeReport(options, backend, check, runs, primary, recommendations, gateFailures);

	if (gateFailures.length > 0) process.exitCode = 1;
}

function printReport(
	options: Options,
	backend: EvalBackend,
	chain: readonly string[],
	check: CorpusCheck,
	runs: readonly TierRun[],
	primary: TierRun,
	recommendations: Record<ValidatorKind, Recommendation>,
	gateFailures: readonly string[]
) {
	const lines: string[] = [];
	const push = (text = '') => lines.push(text);

	push('recess offline validator eval');
	push();
	push(`  backend        ${backend.label}`);
	push(
		`  measures       ${backend.measuresModelAccuracy ? 'MODEL ACCURACY' : 'PIPELINE ONLY - not model accuracy'}`
	);
	push(`  locale         ${options.locale} (chain ${chain.join(' > ')})`);
	push(
		`  tiers          ${runs.map((run) => run.tier).join(', ')}${options.compareTiers ? '' : '  (pass --tiers to compare)'}`
	);
	push(
		`  gate           best-achievable F1 >= ${options.minF1.toFixed(2)} per validator (EVAL_MIN_F1)`
	);
	push();

	push('corpus');
	if (options.locale !== CORPUS_LANGUAGE) {
		push(
			`  every case is written in ${CORPUS_LANGUAGE}, so these scores compare ${CORPUS_LANGUAGE} answers`
		);
		push(`  against the ${options.locale} rubrics and are not a measurement of ${options.locale}`);
	}
	push(
		table(
			['validator', 'cases', 'nudges', 'should pass', 'should miss'],
			VALIDATOR_KINDS.map((kind) => {
				const counts = check.counts[kind];
				return [
					kind,
					String(counts.cases),
					String(counts.nudges),
					String(counts.positives),
					String(counts.negatives)
				];
			})
		)
	);
	push();

	push(`at the shipped thresholds (tier ${primary.tier})`);
	push(
		table(
			['validator', 'TP', 'FP', 'TN', 'FN', 'guard', 'unavail', 'prec', 'recall', 'F1', 'acc'],
			VALIDATOR_KINDS.map((kind) => {
				const { metrics } = primary.validators[kind];
				const c = metrics.confusion;
				return [
					kind,
					String(c.truePass),
					String(c.falsePass),
					String(c.trueMiss),
					String(c.falseMiss),
					String(metrics.guardRejected),
					String(metrics.unavailable),
					fmt(metrics.precision),
					fmt(metrics.recall),
					fmt(metrics.f1),
					fmt(metrics.accuracy)
				];
			})
		)
	);
	push();

	push('threshold sweep 0.50 - 0.90 in 0.01 steps');
	push(
		table(
			[
				'validator',
				'shipped',
				'F1 shipped',
				'best t',
				'ties over',
				'F1 best',
				'prec',
				'recall',
				'shippable'
			],
			VALIDATOR_KINDS.map((kind) => {
				const { metrics, sweep } = primary.validators[kind];
				const best = sweep.best;
				const recommendation = recommendations[kind];
				return [
					kind,
					shippedRange(primary.results, kind),
					fmt(metrics.f1),
					best ? best.threshold.toFixed(2) : 'n/a',
					sweep.plateau ? `${sweep.plateau.from.toFixed(2)}-${sweep.plateau.to.toFixed(2)}` : 'n/a',
					best ? fmt(best.f1) : 'n/a',
					best ? fmt(best.precision) : 'n/a',
					best ? fmt(best.recall) : 'n/a',
					recommendation.shippable ? 'yes' : 'NO'
				];
			})
		)
	);
	push('  best t is the middle of the widest run of thresholds that tie for the best F1');
	push();

	push('recommendation');
	for (const kind of VALIDATOR_KINDS) {
		const recommendation = recommendations[kind];
		push(
			`  ${kind.padEnd(6)} ${recommendation.threshold === null ? 'unavailable' : recommendation.threshold.toFixed(2)}  ${recommendation.why}`
		);
	}
	push();

	push('what these numbers do and do not cover');
	for (const kind of VALIDATOR_KINDS) push(`  ${kind.padEnd(6)} ${backend.claims[kind]}`);
	push();

	push(`cold start, one time per pack (tier ${primary.tier})`);
	push(
		table(
			['pack', 'loaded', 'ms', 'repo'],
			primary.warm.map((entry) => [
				entry.pack,
				entry.loaded ? 'yes' : 'NO',
				fmt(entry.ms, 1),
				entry.repo ?? 'none'
			])
		)
	);
	push('  measured before any case runs, so it stays out of the per-case timeout');
	push();

	push(`latency per case (tier ${primary.tier}, serial, warm)`);
	push(
		table(
			['validator', 'p50 ms', 'p95 ms', 'max ms'],
			VALIDATOR_KINDS.map((kind) => {
				const { latency } = primary.validators[kind];
				return [kind, fmt(latency.p50, 2), fmt(latency.p95, 2), fmt(latency.max, 2)];
			})
		)
	);
	if (!backend.measuresModelAccuracy) {
		push('  these are harness latencies, not inference latencies; no weights ran');
	}
	push();

	const failedToWarm = primary.warm.filter((entry) => !entry.loaded);
	if (backend.id === 'real' && failedToWarm.length > 0) {
		push('a pack did not load');
		push(
			`  ${failedToWarm.map((entry) => entry.pack).join(', ')} returned null from loadPack, so every`
		);
		push('  case needing it is unavailable rather than scored.');
		push('  under node, transformers.js accepts coreml / webgpu / cpu but not wasm, and');
		push('  tiers.deviceFor returns wasm for tier 1 and for tier 2-3 without webgpu. So a real');
		push('  run here needs EVAL_WEBGPU=1 with --tier=2 or --tier=3. In the app the same code');
		push('  runs in a WebView, where wasm is the correct device.');
		push();
	}

	if (options.compareTiers) push(tierSection(runs, backend));

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

function shippedRange(results: readonly CaseResult[], kind: ValidatorKind): string {
	const thresholds = [
		...new Set(
			results
				.filter((result) => result.validator === kind && result.shippedThreshold !== null)
				.map((result) => result.shippedThreshold as number)
		)
	].sort((a, b) => a - b);

	if (thresholds.length === 0) return 'n/a';
	const first = thresholds[0] as number;
	const last = thresholds[thresholds.length - 1] as number;
	return first === last ? first.toFixed(2) : `${first.toFixed(2)}-${last.toFixed(2)}`;
}

function tierSection(runs: readonly TierRun[], backend: EvalBackend): string {
	const lines: string[] = [];
	const baseline = runs.find((run) => run.tier === 2);

	lines.push('tier comparison');
	lines.push(
		table(
			['tier', 'pack', 'repo', 'dtype', 'download'],
			runs.flatMap((run) =>
				run.packs.map((pack, index) => [
					index === 0 ? String(run.tier) : '',
					pack.pack,
					pack.repo ?? 'none',
					pack.dtype ?? '-',
					bytesLabel(pack.bytes, pack.bytesUnavailable)
				])
			)
		)
	);
	lines.push('');
	lines.push(
		table(
			[
				'tier',
				'total download',
				'wiring',
				...VALIDATOR_KINDS.map((kind) => `${kind} acc`),
				'p50 ms',
				'p95 ms'
			],
			runs.map((run) => {
				const all = run.results;
				return [
					String(run.tier),
					bytesLabel(run.totalBytes, run.totalBytesUnavailable),
					run.wiring,
					...VALIDATOR_KINDS.map((kind) => fmt(run.validators[kind].metrics.accuracy)),
					fmt(latencyOf(all).p50, 2),
					fmt(latencyOf(all).p95, 2)
				];
			})
		)
	);
	lines.push('');

	lines.push('is tier 3 worth its weight');
	const tier3 = runs.find((run) => run.tier === 3);
	if (!tier3 || !baseline) {
		lines.push('  unavailable: tier 2 and tier 3 were not both run');
	} else if (!backend.measuresModelAccuracy) {
		lines.push(
			'  unanswerable under the stub backend. The stub returns the same synthetic embeddings'
		);
		lines.push(
			'  whichever repo a tier asks for, so any accuracy delta below is structurally zero and is'
		);
		lines.push('  not evidence. Re-run with EVAL_REAL=1 for a real answer.');
		lines.push('  what IS measured here: each tier asks for the repo and dtype its table promises');
		lines.push(
			`  (wiring ${runs.map((run) => `t${run.tier}=${run.wiring}`).join(' ')}), and the download cost above.`
		);
	} else {
		for (const kind of VALIDATOR_KINDS) {
			const high = tier3.validators[kind].metrics.accuracy;
			const mid = baseline.validators[kind].metrics.accuracy;
			const delta = high === null || mid === null ? null : high - mid;
			lines.push(
				`  ${kind.padEnd(6)} tier3 ${fmt(high)} vs tier2 ${fmt(mid)}  delta ${delta === null ? 'n/a' : delta.toFixed(3)}`
			);
		}
		const extra =
			tier3.totalBytes === null || baseline.totalBytes === null
				? 'unavailable'
				: `${((tier3.totalBytes - baseline.totalBytes) / 1_000_000).toFixed(1)} MB`;
		lines.push(`  extra download for tier 3: ${extra}`);
	}

	return lines.join('\n') + '\n';
}

async function writeReport(
	options: Options,
	backend: EvalBackend,
	check: CorpusCheck,
	runs: readonly TierRun[],
	primary: TierRun,
	recommendations: Record<ValidatorKind, Recommendation>,
	gateFailures: readonly string[]
) {
	const report = {
		generatedAt: new Date().toISOString(),
		backend: {
			id: backend.id,
			label: backend.label,
			measuresModelAccuracy: backend.measuresModelAccuracy,
			claims: backend.claims
		},
		options: {
			locale: options.locale,
			corpusLanguage: CORPUS_LANGUAGE,
			tiers: options.tiers,
			primaryTier: primary.tier,
			minF1: options.minF1,
			webgpu: options.webgpu
		},
		corpus: check.counts,
		corpusErrors: check.errors,
		recommendations: Object.fromEntries(
			VALIDATOR_KINDS.map((kind) => [
				kind,
				{
					...recommendations[kind],
					f1: round(recommendations[kind].f1)
				}
			])
		),
		tiers: runs.map((run) => ({
			tier: run.tier,
			wiring: run.wiring,
			packs: run.packs,
			totalBytes: run.totalBytes,
			totalBytesUnavailable: run.totalBytesUnavailable,
			requests: run.requests,
			coldStart: run.warm.map((entry) => ({ ...entry, ms: round(entry.ms, 3) })),
			validators: Object.fromEntries(
				VALIDATOR_KINDS.map((kind) => {
					const { metrics, sweep, latency } = run.validators[kind];
					return [
						kind,
						{
							atShippedThresholds: {
								...metrics,
								precision: round(metrics.precision),
								recall: round(metrics.recall),
								f1: round(metrics.f1),
								accuracy: round(metrics.accuracy)
							},
							sweep: {
								plateau: sweep.plateau,
								best: sweep.best
									? {
											threshold: sweep.best.threshold,
											precision: round(sweep.best.precision),
											recall: round(sweep.best.recall),
											f1: round(sweep.best.f1)
										}
									: null,
								points: sweep.points.map((point) => ({
									threshold: point.threshold,
									precision: round(point.precision),
									recall: round(point.recall),
									f1: round(point.f1)
								}))
							},
							latencyMs: {
								p50: round(latency.p50, 3),
								p95: round(latency.p95, 3),
								max: round(latency.max, 3)
							}
						}
					];
				})
			),
			cases: run.results.map((result) => ({
				...result,
				score: round(result.score),
				latencyMs: round(result.latencyMs, 3)
			}))
		})),
		gate: {
			metric: 'best achievable F1 over the 0.50-0.90 sweep',
			floor: options.minF1,
			failures: gateFailures,
			passed: gateFailures.length === 0
		}
	};

	writeFileSync(REPORT_PATH, await formatJson(`${JSON.stringify(report, null, '\t')}\n`));
}

/**
 * report.json is committed and covered by `prettier --check`, and JSON.stringify never
 * collapses a short array the way prettier does, so run the output through prettier
 * itself rather than trying to match its rules by hand.
 */
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

await main();
