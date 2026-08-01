export type ValidatorKind = 'text' | 'photo' | 'audio';

export const VALIDATOR_KINDS = [
	'text',
	'photo',
	'audio'
] as const satisfies readonly ValidatorKind[];

export const SWEEP_MIN_CENTS = 50;
export const SWEEP_MAX_CENTS = 90;

export interface CaseResult {
	nudgeId: string;
	validator: ValidatorKind;
	note: string;
	shouldPass: boolean;
	status: 'passed' | 'missed' | 'unavailable';
	/** null when the validator rejected before scoring, or could not run at all */
	score: number | null;
	shippedThreshold: number | null;
	detail: string | null;
	latencyMs: number;
}

export interface Confusion {
	truePass: number;
	falsePass: number;
	trueMiss: number;
	falseMiss: number;
}

export interface Metrics {
	cases: number;
	/** counted apart from the confusion matrix; an unavailable validator predicted nothing */
	unavailable: number;
	/** rejected by a length / duration / empty-transcript guard, before any scoring */
	guardRejected: number;
	/** cases that reached the model and came back with a number; what a sweep can move */
	scored: number;
	confusion: Confusion;
	precision: number | null;
	recall: number | null;
	f1: number | null;
	accuracy: number | null;
}

export interface SweepPoint {
	threshold: number;
	precision: number | null;
	recall: number | null;
	f1: number | null;
}

export interface Sweep {
	points: SweepPoint[];
	/** the point at the recommended threshold, which is the middle of the widest plateau */
	best: SweepPoint | null;
	/** every threshold in the widest run that ties for the best F1 */
	plateau: { from: number; to: number } | null;
}

export interface Latency {
	p50: number | null;
	p95: number | null;
	max: number | null;
}

function ratio(numerator: number, denominator: number): number | null {
	return denominator === 0 ? null : numerator / denominator;
}

/** F1 is 0 rather than null once something was predicted but nothing landed right */
function harmonic(precision: number | null, recall: number | null): number | null {
	if (precision === null || recall === null) return null;
	if (precision + recall === 0) return 0;
	return (2 * precision * recall) / (precision + recall);
}

function confusionFrom(predictions: { predictedPass: boolean; shouldPass: boolean }[]): Confusion {
	const confusion: Confusion = { truePass: 0, falsePass: 0, trueMiss: 0, falseMiss: 0 };
	for (const entry of predictions) {
		if (entry.predictedPass) {
			if (entry.shouldPass) confusion.truePass++;
			else confusion.falsePass++;
		} else if (entry.shouldPass) confusion.falseMiss++;
		else confusion.trueMiss++;
	}
	return confusion;
}

function metricsFromConfusion(
	confusion: Confusion
): Pick<Metrics, 'precision' | 'recall' | 'f1' | 'accuracy'> {
	const predictedPass = confusion.truePass + confusion.falsePass;
	const actualPass = confusion.truePass + confusion.falseMiss;
	const total = predictedPass + confusion.trueMiss + confusion.falseMiss;

	// a validator that predicts no passes at all has 0 precision, not an undefined one;
	// undefined is reserved for "the corpus had nothing to measure"
	let precision: number | null;
	if (actualPass === 0 && predictedPass === 0) precision = null;
	else if (predictedPass === 0) precision = 0;
	else precision = confusion.truePass / predictedPass;

	const recall = ratio(confusion.truePass, actualPass);

	return {
		precision,
		recall,
		f1: harmonic(precision, recall),
		accuracy: ratio(confusion.truePass + confusion.trueMiss, total)
	};
}

/** metrics as the app behaves today, each case judged at its own shipped threshold */
export function metricsAtShipped(results: readonly CaseResult[]): Metrics {
	const scorable = results.filter((result) => result.status !== 'unavailable');
	const confusion = confusionFrom(
		scorable.map((result) => ({
			predictedPass: result.status === 'passed',
			shouldPass: result.shouldPass
		}))
	);

	const guardRejected = scorable.filter((result) => result.score === null).length;

	return {
		cases: results.length,
		unavailable: results.length - scorable.length,
		guardRejected,
		scored: scorable.length - guardRejected,
		confusion,
		...metricsFromConfusion(confusion)
	};
}

/**
 * F1 every threshold from 0.50 to 0.90 would have achieved. Guard rejections carry a
 * null score and stay rejected at every threshold, because no threshold could have
 * saved them. Many thresholds usually tie, so the recommendation is the middle of the
 * widest tying run rather than the first index that happens to reach the maximum.
 */
export function sweepThresholds(results: readonly CaseResult[]): Sweep {
	const scorable = results.filter((result) => result.status !== 'unavailable');
	const points: SweepPoint[] = [];

	for (let cents = SWEEP_MIN_CENTS; cents <= SWEEP_MAX_CENTS; cents++) {
		const threshold = cents / 100;
		const confusion = confusionFrom(
			scorable.map((result) => ({
				predictedPass: result.score !== null && result.score >= threshold,
				shouldPass: result.shouldPass
			}))
		);
		const { precision, recall, f1 } = metricsFromConfusion(confusion);
		points.push({ threshold, precision, recall, f1 });
	}

	return { points, ...bestOf(points) };
}

const TIE = 1e-12;

function bestOf(points: readonly SweepPoint[]): Pick<Sweep, 'best' | 'plateau'> {
	const scored = points.filter((point) => point.f1 !== null);
	if (scored.length === 0) return { best: null, plateau: null };

	const top = Math.max(...scored.map((point) => point.f1 as number));

	let widest: SweepPoint[] = [];
	let run: SweepPoint[] = [];
	for (const point of points) {
		if (point.f1 !== null && Math.abs(point.f1 - top) <= TIE) {
			run.push(point);
			if (run.length > widest.length) widest = [...run];
		} else {
			run = [];
		}
	}

	const first = widest[0] as SweepPoint;
	const last = widest[widest.length - 1] as SweepPoint;
	const middle = widest[Math.floor((widest.length - 1) / 2)] as SweepPoint;

	return { best: middle, plateau: { from: first.threshold, to: last.threshold } };
}

/** nearest-rank percentile; no interpolation, so the number is always a real sample */
export function percentile(values: readonly number[], p: number): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const rank = Math.ceil((p / 100) * sorted.length);
	return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))] ?? null;
}

export function latencyOf(results: readonly CaseResult[]): Latency {
	const samples = results.map((result) => result.latencyMs);
	return {
		p50: percentile(samples, 50),
		p95: percentile(samples, 95),
		max: samples.length === 0 ? null : Math.max(...samples)
	};
}

export function round(value: number | null, places = 4): number | null {
	if (value === null || !Number.isFinite(value)) return null;
	const factor = 10 ** places;
	return Math.round(value * factor) / factor;
}
