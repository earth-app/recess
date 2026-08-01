import type { DeviceTier } from '~/types/models';
import type { ModelPack } from '~/types/nudge';
import type { TransformersLike } from '~/utils/ml';
import type { ValidationScorers } from '~/utils/validate';
import type { Sources } from './harness';
import type { ValidatorKind } from './metrics';

export const EMBEDDING_DIMS = 256;

/**
 * How much a shared character trigram counts against a shared whole word. Kept low on
 * purpose: English text shares so many trigrams that a heavier weight lifts unrelated
 * strings to a 0.63-0.72 normalized score, and `rubric.ts` documents unrelated text as
 * landing near 0.5. At 0.1 off-topic answers measure 0.55-0.59, which is the band the
 * shipped thresholds were authored against.
 */
export const TRIGRAM_WEIGHT = 0.1;

/**
 * CLIP's own logit scale, so the stub's softmax is as sharp as the real one rather
 * than flat across twenty labels. Not a measurement; a documented convention.
 */
export const CLIP_LOGIT_SCALE = 100;

/** the highest-frequency English function words; they otherwise dominate the bag */
const STOP_WORDS = new Set([
	'a',
	'an',
	'and',
	'are',
	'as',
	'at',
	'be',
	'but',
	'by',
	'for',
	'from',
	'had',
	'has',
	'have',
	'i',
	'in',
	'is',
	'it',
	'its',
	'of',
	'on',
	'or',
	'that',
	'the',
	'then',
	'there',
	'this',
	'to',
	'was',
	'were',
	'with'
]);

function words(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim()
		.split(' ')
		.filter(Boolean);
}

/** fnv-1a; cheap, stable across runs, and good enough to spread features */
function hash(value: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < value.length; i++) {
		h ^= value.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h;
}

/**
 * Hashed word + character-trigram bag, L2 normalized. Lexically related strings score
 * higher than unrelated ones, which is enough to exercise the scoring pipeline; it is
 * not a semantic model and must never be reported as one.
 */
export function stubEmbedding(text: string, dims = EMBEDDING_DIMS): number[] {
	const vector = new Array<number>(dims).fill(0);
	const add = (feature: string, weight: number) => {
		const index = hash(feature) % dims;
		vector[index] = (vector[index] ?? 0) + weight;
	};

	for (const word of words(text)) {
		if (STOP_WORDS.has(word)) continue;
		add(`w:${word}`, 1);
		// trigrams give partial credit for shared stems (handwriting / handwritten)
		const padded = `#${word}#`;
		for (let i = 0; i + 3 <= padded.length; i++) {
			add(`t:${padded.slice(i, i + 3)}`, TRIGRAM_WEIGHT);
		}
	}

	let sumSquares = 0;
	for (const value of vector) sumSquares += value * value;
	if (sumSquares === 0) return vector;

	const magnitude = Math.sqrt(sumSquares);
	return vector.map((value) => value / magnitude);
}

async function blobText(url: string): Promise<string> {
	const response = await fetch(url);
	return response.text();
}

export interface PackRequest {
	pack: ModelPack;
	repo: string;
	dtype: string;
	device: string;
}

/**
 * `validate.ts` collapses a scorer rejection into "the model timed out", so the real
 * reason is captured here instead of being guessed at from the verdict.
 */
export interface FailureSink {
	record(stage: 'embed' | 'clip' | 'transcribe', message: string): void;
}

export interface WarmResult {
	pack: ModelPack;
	ms: number;
	loaded: boolean;
	repo: string | null;
}

export interface EvalBackend {
	id: 'stub' | 'real';
	label: string;
	/** true only when real weights produced the numbers */
	measuresModelAccuracy: boolean;
	/** what each validator's numbers actually mean under this backend */
	claims: Record<ValidatorKind, string>;
	scorers(tier: DeviceTier, locale: string, sink?: FailureSink): ValidationScorers;
	/**
	 * load the packs before any case is timed, so the one-time pipeline build lands in a
	 * cold-start number instead of inside the first case's inference timeout
	 */
	warm(tier: DeviceTier, locale: string, packs: readonly ModelPack[]): Promise<WarmResult[]>;
	/** repos and dtypes the run actually asked transformers.js for, in load order */
	requests(): PackRequest[];
	/** drop every memoized pipeline so the next tier loads its own packs */
	reset(): void;
}

// #region stub

/**
 * Deterministic, offline, no weights. Drives the real `ml.ts` scorers through
 * `__setTransformers`, so `loadPack`, `packSpec`, `embedTexts` and `clipLogits` are all
 * exercised; only the numbers inside the tensors are synthetic.
 */
export function createStubBackend(sources: Sources): EvalBackend {
	const requests: PackRequest[] = [];

	function transformers(): TransformersLike {
		return {
			env: {},
			pipeline: async (task, model, options) => {
				requests.push({
					pack: packFor(task),
					repo: model,
					dtype: String(options?.dtype ?? 'unknown'),
					device: String(options?.device ?? 'unknown')
				});

				switch (task) {
					case 'feature-extraction':
						return async (...args: unknown[]) => {
							const texts = args[0] as string[];
							return { tolist: () => texts.map((text) => stubEmbedding(text)) };
						};
					case 'zero-shot-image-classification':
						return async (...args: unknown[]) => {
							const caption = await blobText(args[0] as string);
							const labels = args[1] as string[];
							return captionScores(sources, caption, labels);
						};
					case 'automatic-speech-recognition':
						return async (...args: unknown[]) => ({ text: await blobText(args[0] as string) });
					default:
						throw new Error(`the stub backend has no ${task} pipeline`);
				}
			}
		};
	}

	sources.ml.__setTransformers(transformers());

	return {
		id: 'stub',
		label: 'stub (hashed word and character-trigram bag; no weights, no network)',
		measuresModelAccuracy: false,
		claims: {
			text: 'pipeline only: length window, rubric weighting, threshold handling. Lexical overlap stands in for meaning.',
			photo:
				'pipeline only: label/negative softmax and positive mass. Caption text stands in for image content, so nothing here measures what CLIP sees.',
			audio:
				'pipeline only: duration guard, empty-transcript guard, transcript-then-rubric scoring. Transcription itself is not exercised.'
		},
		scorers: (tier, locale, sink) => mlScorers(sources, tier, locale, false, sink),
		warm: (tier, locale, packs) => warmPacks(sources, tier, locale, false, packs),
		requests: () => [...requests],
		reset: () => {
			requests.length = 0;
			// __setTransformers clears the memoized pipelines, so each tier loads its own
			sources.ml.__setTransformers(transformers());
		}
	};
}

function packFor(task: string): ModelPack {
	switch (task) {
		case 'feature-extraction':
			return 'text';
		case 'zero-shot-image-classification':
			return 'vision';
		case 'automatic-speech-recognition':
			return 'audio';
		default:
			return 'writing';
	}
}

/** the shape transformers.js returns from a zero-shot image pipeline */
function captionScores(
	sources: Sources,
	caption: string,
	labels: string[]
): { label: string; score: number }[] {
	const subject = stubEmbedding(caption);
	const logits = labels.map(
		(label) => sources.rubric.cosineSimilarity(subject, stubEmbedding(label)) * CLIP_LOGIT_SCALE
	);
	const probabilities = sources.rubric.softmax(logits);
	return labels.map((label, index) => ({ label, score: probabilities[index] ?? 0 }));
}

// #endregion

// #region real

/**
 * Real weights through the same `ml.ts` entry points. Opt-in via `EVAL_REAL=1` because
 * it downloads hundreds of megabytes on first run.
 */
export function createRealBackend(sources: Sources, webgpu: boolean): EvalBackend {
	sources.ml.__setTransformers(null);

	return {
		id: 'real',
		// deviceFor decides wasm vs webgpu from the tier as well, so the flag is a request
		label: `real (@huggingface/transformers weights, webgpu ${webgpu ? 'on' : 'off'})`,
		measuresModelAccuracy: true,
		claims: {
			text: 'model accuracy: the shipped embedder scores the shipped rubrics.',
			photo:
				'model accuracy, but only for cases carrying a real image; caption-only cases are reported unavailable.',
			audio:
				'model accuracy of transcript-then-rubric scoring. Cases without a real recording skip transcription, so Whisper accuracy is not measured.'
		},
		scorers: (tier, locale, sink) => mlScorers(sources, tier, locale, webgpu, sink),
		warm: (tier, locale, packs) => warmPacks(sources, tier, locale, webgpu, packs),
		// transformers.js is not instrumented under the real backend; the tier table and
		// ml.loadedRepo are what the runner reports instead
		requests: () => [],
		reset: () => {
			for (const pack of sources.nudge.MODEL_PACKS) sources.ml.unload(pack);
		}
	};
}

// #endregion

async function warmPacks(
	sources: Sources,
	tier: DeviceTier,
	locale: string,
	webgpu: boolean,
	packs: readonly ModelPack[]
): Promise<WarmResult[]> {
	const results: WarmResult[] = [];
	for (const pack of packs) {
		const started = performance.now();
		const entry = await sources.ml.loadPack(pack, { tier, locale, webgpu, allowRemote: true });
		results.push({
			pack,
			ms: performance.now() - started,
			loaded: entry !== null,
			repo: entry?.repo ?? null
		});
	}
	return results;
}

function mlScorers(
	sources: Sources,
	tier: DeviceTier,
	locale: string,
	webgpu: boolean,
	sink?: FailureSink
): ValidationScorers {
	const options = { tier, locale, webgpu, allowRemote: true };

	return {
		embed: async (texts) => {
			const embeddings = await sources.ml.embedTexts(texts, options);
			if (!embeddings) {
				sink?.record('embed', 'embedTexts returned null');
				throw new Error('embedding failed');
			}
			return embeddings;
		},
		clipLogits: async (image, labels) => {
			const logits = await sources.ml.clipLogits(image, labels, options);
			if (!logits) {
				sink?.record('clip', 'clipLogits returned null');
				throw new Error('clip failed');
			}
			return logits;
		},
		transcribe: async (audio) => {
			const text = await sources.ml.transcribe(audio, options);
			if (text === null) {
				sink?.record('transcribe', 'transcribe returned null');
				throw new Error('transcription failed');
			}
			return text;
		}
	};
}
