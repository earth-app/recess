import type { DeviceTier } from '~/types/models';
import type { ModelPack } from '~/types/nudge';
import { deviceFor, packSpec } from '~/utils/tiers';

// transformers.js is only ever reached through a dynamic import, so none of it
// enters the entry chunk. Singletons are memoized at module scope, and a failed
// load resets its promise so a later attempt can retry.

type Pipeline = (...args: unknown[]) => Promise<unknown>;

interface Loaded {
	pipeline: Pipeline;
	repo: string;
}

const loaded = new Map<ModelPack, Loaded>();
const loading = new Map<ModelPack, Promise<Loaded | null>>();

export interface LoadOptions {
	tier: DeviceTier;
	locale: string;
	webgpu?: boolean;
	onProgress?: (progress: { file?: string; loaded?: number; total?: number }) => void;
	/** fetch from the hub when absent locally; false once a pack is installed */
	allowRemote?: boolean;
}

/** module-scope so tests can assert what was requested without a real download */
export interface TransformersLike {
	pipeline: (task: string, model: string, options?: Record<string, unknown>) => Promise<Pipeline>;
	env: Record<string, unknown>;
}

let transformersOverride: TransformersLike | null = null;

/** @internal test seam; lets the eval lane and specs drive a fake runtime */
export function __setTransformers(module: TransformersLike | null) {
	transformersOverride = module;
	loaded.clear();
	loading.clear();
}

async function getTransformers(): Promise<TransformersLike> {
	if (transformersOverride) return transformersOverride;
	return (await import('@huggingface/transformers')) as unknown as TransformersLike;
}

export function isLoaded(pack: ModelPack): boolean {
	return loaded.has(pack);
}

export function loadedRepo(pack: ModelPack): string | null {
	return loaded.get(pack)?.repo ?? null;
}

export function unload(pack: ModelPack) {
	loaded.delete(pack);
	loading.delete(pack);
}

/**
 * resolve a pack's pipeline, loading it if needed. returns null instead of
 * throwing, because every caller degrades to self-attestation rather than
 * blocking the user.
 */
/**
 * The execution provider, adjusted for the runtime rather than just the tier.
 *
 * `wasm` is a browser provider; onnxruntime-node offers `cpu`, `coreml` and `webgpu`
 * and rejects `wasm` outright. The eval lane imports this module directly under bun,
 * so without the translation every real-weight run failed to load and the whole tier
 * comparison reported each case as unavailable rather than measuring anything.
 */
export function resolveDevice(tier: DeviceTier, webgpu: boolean): string {
	const device = deviceFor(tier, webgpu);
	if (device === 'wasm' && typeof window === 'undefined') return 'cpu';
	return device;
}

export async function loadPack(pack: ModelPack, options: LoadOptions): Promise<Loaded | null> {
	const existing = loaded.get(pack);
	if (existing) return existing;

	const inFlight = loading.get(pack);
	if (inFlight) return inFlight;

	const spec = packSpec(pack, options.tier, options.locale);
	if (!spec) return null;

	const attempt = (async (): Promise<Loaded | null> => {
		try {
			const { pipeline, env } = await getTransformers();

			// once a pack is installed, refuse the network so the app is genuinely offline
			if (options.allowRemote === false) env.allowRemoteModels = false;

			const built = await pipeline(spec.task, spec.repo, {
				dtype: spec.dtype,
				device: resolveDevice(options.tier, options.webgpu ?? false),
				progress_callback: options.onProgress
					? (progress: { file?: string; loaded?: number; total?: number }) =>
							options.onProgress?.(progress)
					: undefined
			});

			const entry: Loaded = { pipeline: built, repo: spec.repo };
			loaded.set(pack, entry);
			return entry;
		} catch (error) {
			console.warn(`[ml] ${pack} failed to load:`, error);
			return null;
		} finally {
			// clear either way so a failure can be retried later
			loading.delete(pack);
		}
	})();

	loading.set(pack, attempt);
	return attempt;
}

// #region scorers

/** batch text embedding, mean-pooled and normalized, as the rubric scorer expects */
export async function embedTexts(
	texts: string[],
	options: LoadOptions
): Promise<number[][] | null> {
	const entry = await loadPack('text', options);
	if (!entry) return null;

	try {
		const output = (await entry.pipeline(texts, { pooling: 'mean', normalize: true })) as {
			tolist?: () => number[][];
			data?: Float32Array;
			dims?: number[];
		};

		if (typeof output.tolist === 'function') return output.tolist();

		// fall back to reshaping the flat tensor when tolist is absent
		if (output.data && output.dims && output.dims.length === 2) {
			const [rows, cols] = output.dims as [number, number];
			return Array.from({ length: rows }, (_, row) =>
				Array.from({ length: cols }, (_, col) => output.data![row * cols + col] as number)
			);
		}

		return null;
	} catch (error) {
		console.warn('[ml] embedding failed:', error);
		return null;
	}
}

/**
 * CLIP zero-shot. transformers.js returns per-label scores already softmaxed, so
 * we convert back to a log space for our own softmax to combine positives and
 * negatives consistently.
 */
export async function clipLogits(
	image: Blob,
	labels: string[],
	options: LoadOptions
): Promise<number[] | null> {
	const entry = await loadPack('vision', options);
	if (!entry) return null;

	try {
		const url = URL.createObjectURL(image);
		try {
			const output = (await entry.pipeline(url, labels)) as { label: string; score: number }[];
			if (!Array.isArray(output)) return null;

			const byLabel = new Map(output.map((item) => [item.label, item.score]));
			// log of the reported probability recovers a usable logit up to a constant
			return labels.map((label) => Math.log(Math.max(1e-9, byLabel.get(label) ?? 1e-9)));
		} finally {
			URL.revokeObjectURL(url);
		}
	} catch (error) {
		console.warn('[ml] clip failed:', error);
		return null;
	}
}

export async function transcribe(audio: Blob, options: LoadOptions): Promise<string | null> {
	const entry = await loadPack('audio', options);
	if (!entry) return null;

	try {
		const url = URL.createObjectURL(audio);
		try {
			const output = (await entry.pipeline(url)) as { text?: string } | { text?: string }[];
			const text = Array.isArray(output) ? output[0]?.text : output.text;
			return typeof text === 'string' ? text.trim() : null;
		} finally {
			URL.revokeObjectURL(url);
		}
	} catch (error) {
		console.warn('[ml] transcription failed:', error);
		return null;
	}
}

export interface GenerateOptions extends LoadOptions {
	maxTokens?: number;
	temperature?: number;
}

/** short, low-temperature generation for feedback lines and weekly reflections */
export async function generate(prompt: string, options: GenerateOptions): Promise<string | null> {
	const entry = await loadPack('writing', options);
	if (!entry) return null;

	try {
		const output = (await entry.pipeline([{ role: 'user', content: prompt }], {
			max_new_tokens: options.maxTokens ?? 60,
			temperature: options.temperature ?? 0.7,
			do_sample: true,
			return_full_text: false
		})) as { generated_text?: unknown }[];

		const raw = output?.[0]?.generated_text;
		if (typeof raw === 'string') return raw.trim();

		// chat pipelines return the message array rather than a string
		if (Array.isArray(raw)) {
			const last = raw[raw.length - 1] as { content?: string } | undefined;
			return typeof last?.content === 'string' ? last.content.trim() : null;
		}

		return null;
	} catch (error) {
		console.warn('[ml] generation failed:', error);
		return null;
	}
}

// #endregion
