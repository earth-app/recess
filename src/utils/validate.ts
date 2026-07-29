import type {
	AudioValidationData,
	BarcodeValidationData,
	CountValidationData,
	Nudge,
	PhotoValidationData,
	TextValidationData,
	ValidationType
} from '~/types/nudge';
import { TEXT_LENGTH_CEILING, TEXT_LENGTH_FLOOR, isValidated } from '~/types/nudge';
import { checkBarcode, type BarcodeScan } from '~/utils/barcode';
import {
	normalizeThreshold,
	positiveMass,
	rubricTexts,
	scoreAgainstRubric,
	softmax
} from '~/utils/rubric';

export const DEFAULT_INFERENCE_TIMEOUT_MS = 30_000;
export const DEFAULT_TEXT_MIN_LENGTH = 120;

export type Verdict =
	| { status: 'passed'; score?: number; threshold?: number; detail?: string }
	| { status: 'missed'; score?: number; threshold?: number; detail?: string; observed?: string[] }
	| { status: 'unavailable'; reason: string };

export interface ValidationScorers {
	/** batch text embedding; index 0 is the subject, the rest are rubric ideals */
	embed?: (texts: string[]) => Promise<number[][]>;
	/** raw CLIP logits aligned to the supplied label list */
	clipLogits?: (image: Blob, labels: string[]) => Promise<number[]>;
	transcribe?: (audio: Blob) => Promise<string>;
}

export interface ValidateOptions {
	timeoutMs?: number;
	scorers?: ValidationScorers;
}

const unavailable = (reason: string): Verdict => ({ status: 'unavailable', reason });

/** never resolves to a pass; a timeout is an unavailable validator, not a miss */
async function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T | null> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const timeout = new Promise<null>((resolve) => {
			timer = setTimeout(() => resolve(null), timeoutMs);
		});
		return await Promise.race([work, timeout]);
	} catch {
		return null;
	} finally {
		if (timer) clearTimeout(timer);
	}
}

// #region text

export function textLengthWindow(data: TextValidationData): { min: number; max: number } {
	const clamp = (n: number) =>
		Math.min(TEXT_LENGTH_CEILING, Math.max(TEXT_LENGTH_FLOOR, Math.floor(n)));

	const min = clamp(data.min_length ?? DEFAULT_TEXT_MIN_LENGTH);
	const max = Math.max(min, clamp(data.max_length ?? TEXT_LENGTH_CEILING));
	return { min, max };
}

export async function validateText(
	data: TextValidationData,
	text: string,
	options: ValidateOptions = {}
): Promise<Verdict> {
	const trimmed = text.trim();
	const { min, max } = textLengthWindow(data);

	if (trimmed.length < min) {
		return {
			status: 'missed',
			detail: `A little more - ${min} characters at least, you're at ${trimmed.length}.`
		};
	}
	if (trimmed.length > max) {
		return { status: 'missed', detail: `That's past the ${max} character limit.` };
	}

	const threshold = normalizeThreshold(data.threshold);
	if (!threshold.ok) return unavailable(threshold.message ?? 'bad threshold');

	const embed = options.scorers?.embed;
	if (!embed) return unavailable('the writing model is not installed');

	const embeddings = await withTimeout(
		embed(rubricTexts(trimmed, data.rubric)),
		options.timeoutMs ?? DEFAULT_INFERENCE_TIMEOUT_MS
	);
	if (!embeddings) return unavailable('the writing model timed out');

	try {
		const result = scoreAgainstRubric(embeddings, data.rubric);
		return result.score >= threshold.value
			? { status: 'passed', score: result.score, threshold: threshold.value }
			: {
					status: 'missed',
					score: result.score,
					threshold: threshold.value,
					detail: 'That reads a bit far from what the nudge asked for.'
				};
	} catch (error) {
		return unavailable(error instanceof Error ? error.message : 'scoring failed');
	}
}

// #endregion

// #region photo

/**
 * CLIP zero-shot. labels and negatives share one softmax, so the score answers
 * "does this look more like a wanted label than an unwanted one" rather than
 * reporting a bare similarity that would pass on almost anything.
 */
export function photoLabelSet(data: PhotoValidationData): {
	labels: string[];
	positiveCount: number;
} {
	const negatives =
		data.negative_labels && data.negative_labels.length > 0
			? data.negative_labels
			: ['a photo of something else', 'a screenshot of a screen'];

	return { labels: [...data.labels, ...negatives], positiveCount: data.labels.length };
}

export async function validatePhoto(
	data: PhotoValidationData,
	image: Blob,
	options: ValidateOptions = {}
): Promise<Verdict> {
	const threshold = normalizeThreshold(data.threshold);
	if (!threshold.ok) return unavailable(threshold.message ?? 'bad threshold');

	const clip = options.scorers?.clipLogits;
	if (!clip) return unavailable('the photo model is not installed');

	const { labels, positiveCount } = photoLabelSet(data);
	const logits = await withTimeout(
		clip(image, labels),
		options.timeoutMs ?? DEFAULT_INFERENCE_TIMEOUT_MS
	);
	if (!logits || logits.length !== labels.length) {
		return unavailable('the photo model timed out');
	}

	const probabilities = softmax(logits);
	const score = positiveMass(probabilities, positiveCount);

	// what the model thought it saw, so a miss is never a black box
	const observed = labels
		.map((label, index) => ({ label, p: probabilities[index] ?? 0 }))
		.sort((a, b) => b.p - a.p)
		.slice(0, 3)
		.map((entry) => `${entry.label} (${Math.round(entry.p * 100)}%)`);

	return score >= threshold.value
		? { status: 'passed', score, threshold: threshold.value }
		: { status: 'missed', score, threshold: threshold.value, observed };
}

// #endregion

// #region audio

export async function validateAudio(
	data: AudioValidationData,
	audio: Blob,
	durationSeconds: number,
	options: ValidateOptions = {}
): Promise<Verdict> {
	if (data.min_seconds !== undefined && durationSeconds < data.min_seconds) {
		return {
			status: 'missed',
			detail: `Hold on a little longer - ${data.min_seconds} seconds at least.`
		};
	}

	const threshold = normalizeThreshold(data.threshold);
	if (!threshold.ok) return unavailable(threshold.message ?? 'bad threshold');

	const transcribe = options.scorers?.transcribe;
	const embed = options.scorers?.embed;
	if (!transcribe) return unavailable('the audio model is not installed');
	if (!embed) return unavailable('the writing model is not installed');

	const timeoutMs = options.timeoutMs ?? DEFAULT_INFERENCE_TIMEOUT_MS;
	const transcript = await withTimeout(transcribe(audio), timeoutMs);
	if (transcript === null) return unavailable('the audio model timed out');

	const spoken = transcript.trim();
	if (spoken.length === 0) {
		return { status: 'missed', detail: "We couldn't make out any words in that." };
	}

	const embeddings = await withTimeout(embed(rubricTexts(spoken, data.rubric)), timeoutMs);
	if (!embeddings) return unavailable('the writing model timed out');

	try {
		const result = scoreAgainstRubric(embeddings, data.rubric);
		return result.score >= threshold.value
			? { status: 'passed', score: result.score, threshold: threshold.value, detail: spoken }
			: {
					status: 'missed',
					score: result.score,
					threshold: threshold.value,
					detail: spoken,
					observed: [spoken]
				};
	} catch (error) {
		return unavailable(error instanceof Error ? error.message : 'scoring failed');
	}
}

// #endregion

// #region deterministic validators

export function validateBarcode(data: BarcodeValidationData, scan: BarcodeScan): Verdict {
	const check = checkBarcode(scan, data.kind, data.require_checksum ?? true);
	return check.ok
		? { status: 'passed', detail: check.describes }
		: { status: 'missed', detail: check.reason };
}

export function validateCount(data: CountValidationData, value: number): Verdict {
	if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
		return { status: 'missed', detail: 'A whole number, please.' };
	}
	if (value < data.min) {
		return { status: 'missed', detail: `That seems low - the nudge expects at least ${data.min}.` };
	}
	if (value > data.max) {
		return { status: 'missed', detail: `That seems high - the nudge expects at most ${data.max}.` };
	}
	return { status: 'passed' };
}

export function validateConfirm(): Verdict {
	return { status: 'passed' };
}

// #endregion

// #region dispatch

export type Submission =
	| { kind: 'confirm' }
	| { kind: 'text'; text: string }
	| { kind: 'photo'; image: Blob }
	| { kind: 'audio'; audio: Blob; durationSeconds: number }
	| { kind: 'barcode'; scan: BarcodeScan }
	| { kind: 'count'; value: number };

/** the submission kind a nudge expects, or null when it needs no validator */
export function expectedSubmission(nudge: Nudge): ValidationType | null {
	return isValidated(nudge) ? nudge.validation_type : null;
}

export async function validateSubmission(
	nudge: Nudge,
	submission: Submission,
	options: ValidateOptions = {}
): Promise<Verdict> {
	if (!isValidated(nudge)) return validateConfirm();

	if (nudge.validation_type !== submission.kind) {
		return unavailable(`expected a ${nudge.validation_type} submission`);
	}

	/**
	 * Switched on `nudge.validation_type`, not `submission.kind`.
	 *
	 * Both are checked equal just above, but only the nudge's own discriminant narrows
	 * `nudge.validation_data` - so switching on the submission forced five
	 * `as XValidationData` casts that threw the guarantee away. If that equality check is ever
	 * loosened or reordered, a photo nudge routed into `validateText` reaches
	 * `rubricTexts(trimmed, data.rubric)` with `rubric === undefined`, and that call sits
	 * outside the try, so it rejects the promise instead of returning `unavailable` - breaking
	 * the rule that every failure path degrades to an explicit self-attest offer.
	 *
	 * The submission is re-checked inside each arm so exhaustiveness lives on the nudge side,
	 * where the payload is, and a future validation type cannot be silently forgotten.
	 */
	switch (nudge.validation_type) {
		case 'confirm':
			return validateConfirm();
		case 'text':
			if (submission.kind !== 'text') return unavailable('expected a text submission');
			return validateText(nudge.validation_data, submission.text, options);
		case 'photo':
			if (submission.kind !== 'photo') return unavailable('expected a photo submission');
			return validatePhoto(nudge.validation_data, submission.image, options);
		case 'audio':
			if (submission.kind !== 'audio') return unavailable('expected an audio submission');
			return validateAudio(
				nudge.validation_data,
				submission.audio,
				submission.durationSeconds,
				options
			);
		case 'barcode':
			if (submission.kind !== 'barcode') return unavailable('expected a barcode submission');
			return validateBarcode(nudge.validation_data, submission.scan);
		case 'count':
			if (submission.kind !== 'count') return unavailable('expected a count submission');
			return validateCount(nudge.validation_data, submission.value);
		default: {
			const exhaustive: never = nudge;
			return exhaustive;
		}
	}
}

// #endregion
