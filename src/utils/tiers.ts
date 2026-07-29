import type { Benchmark, DeviceTier } from '~/types/models';
import type { ModelPack } from '~/types/nudge';

export interface PackSpec {
	repo: string;
	/** transformers.js dtype; q8 on wasm, fp16 where WebGPU is available */
	dtype: 'q8' | 'fp16' | 'q4' | 'q4f16';
	task:
		| 'feature-extraction'
		| 'zero-shot-image-classification'
		| 'automatic-speech-recognition'
		| 'text-generation';
}

/** `null` means the pack does not exist for that locale at that tier */
export type TierPacks = Record<ModelPack, PackSpec | null>;

const CLIP_32 = 'Xenova/clip-vit-base-patch32';
const CLIP_16 = 'Xenova/clip-vit-base-patch16';

function packsFor(tier: DeviceTier, language: string): TierPacks {
	const spanish = language === 'es';
	const webgpu = tier >= 2;
	const embedDtype = webgpu ? 'fp16' : 'q8';

	/**
	 * Tier 3 keeps the larger vision and writing models and shares tier 2's embedder and
	 * transcriber.
	 *
	 * Measured, not assumed. `EVAL_REAL=1 test:eval --tiers` on an M2 Pro, with each tier
	 * given its own calibrated threshold rather than tier 2's:
	 *
	 *   tier 2  1200 MB  p95  41 ms  text F1 0.800 @ 0.74  audio F1 0.737 @ 0.72
	 *   tier 3  1830 MB  p95 149 ms  text F1 0.800 @ 0.78  audio F1 0.757 @ 0.77
	 *
	 * bge-large and whisper-small bought +0.020 audio F1 and *nothing* on text for +630 MB
	 * and 3.6x the p95. They also broke the single shipped threshold, because a different
	 * embedder has a different similarity distribution - at tier 2's 0.74 the larger model
	 * scored 0.718, worse than the smaller one. Sharing the embedder keeps one calibrated
	 * threshold correct for every tier.
	 *
	 * CLIP-16 stays because it is not a cost: 603.9 MB against tier 2's 610.6 MB for
	 * CLIP-32 at fp16. Its accuracy is untested - every photo fixture is caption-only - so
	 * this is a size decision, not an accuracy claim.
	 */
	if (tier === 3) {
		return {
			vision: { repo: CLIP_16, dtype: 'fp16', task: 'zero-shot-image-classification' },
			text: {
				// bge is english-only, so spanish takes the multilingual model instead
				repo: spanish ? 'Xenova/multilingual-e5-small' : 'onnx-community/bge-small-en-v1.5-ONNX',
				dtype: embedDtype,
				task: 'feature-extraction'
			},
			audio: {
				repo: spanish ? 'onnx-community/whisper-base' : 'onnx-community/whisper-base.en',
				dtype: 'q8',
				task: 'automatic-speech-recognition'
			},
			writing: {
				repo: 'onnx-community/Qwen2.5-0.5B-Instruct',
				dtype: 'q4f16',
				task: 'text-generation'
			}
		};
	}

	if (tier === 2) {
		return {
			vision: { repo: CLIP_32, dtype: 'fp16', task: 'zero-shot-image-classification' },
			text: {
				repo: spanish ? 'Xenova/multilingual-e5-small' : 'onnx-community/bge-small-en-v1.5-ONNX',
				dtype: embedDtype,
				task: 'feature-extraction'
			},
			audio: {
				repo: spanish ? 'onnx-community/whisper-base' : 'onnx-community/whisper-base.en',
				dtype: 'q8',
				task: 'automatic-speech-recognition'
			},
			writing: {
				repo: 'HuggingFaceTB/SmolLM2-360M-Instruct',
				dtype: 'q4',
				task: 'text-generation'
			}
		};
	}

	return {
		vision: { repo: CLIP_32, dtype: 'q8', task: 'zero-shot-image-classification' },
		text: {
			repo: spanish ? 'Xenova/multilingual-e5-small' : 'onnx-community/bge-small-en-v1.5-ONNX',
			dtype: 'q8',
			task: 'feature-extraction'
		},
		audio: {
			repo: spanish ? 'onnx-community/whisper-tiny' : 'onnx-community/whisper-tiny.en',
			dtype: 'q8',
			task: 'automatic-speech-recognition'
		},
		writing: {
			repo: 'HuggingFaceTB/SmolLM2-135M-Instruct',
			dtype: 'q4',
			task: 'text-generation'
		}
	};
}

export function tierPacks(tier: DeviceTier, locale: string): TierPacks {
	const language = locale.split('-')[0] ?? 'en';
	return packsFor(tier, language);
}

export function packSpec(pack: ModelPack, tier: DeviceTier, locale: string): PackSpec | null {
	return tierPacks(tier, locale)[pack];
}

/** the execution provider to ask transformers.js for */
export function deviceFor(tier: DeviceTier, webgpu: boolean): 'webgpu' | 'wasm' {
	return tier >= 2 && webgpu ? 'webgpu' : 'wasm';
}

// #region benchmarking

export const MATMUL_FAST_MS = 90;
export const MATMUL_OK_MS = 260;
export const TIER3_MIN_MEMORY_GB = 7;
export const TIER2_MIN_MEMORY_GB = 5;
export const TIER2_MIN_CORES = 6;

/**
 * reported specs lie on throttled and low-battery devices, so the timed matmul
 * gets a veto: a slow device cannot reach tier 3 no matter what it claims.
 */
export function tierFromBenchmark(
	input: Pick<Benchmark, 'webgpu' | 'cores' | 'memoryGb' | 'matmulMs'>
): DeviceTier {
	const { webgpu, cores, memoryGb, matmulMs } = input;

	if (!webgpu) return 1;
	if (matmulMs > MATMUL_OK_MS) return 1;

	const memoryUnknown = memoryGb <= 0;

	if (
		matmulMs <= MATMUL_FAST_MS &&
		cores >= 8 &&
		(memoryUnknown ? cores >= 8 : memoryGb >= TIER3_MIN_MEMORY_GB)
	) {
		return 3;
	}

	if (cores >= TIER2_MIN_CORES && (memoryUnknown || memoryGb >= TIER2_MIN_MEMORY_GB)) {
		return 2;
	}

	return 1;
}

export function tierLabel(tier: DeviceTier): string {
	switch (tier) {
		case 3:
			return 'Tier 3 - Larger Models';
		case 2:
			return 'Tier 2 - Balanced';
		default:
			return 'Tier 1 - Smallest Models';
	}
}

// #endregion
