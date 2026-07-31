import { describe, expect, it } from 'vitest';
import { MODEL_PACKS } from '~/types/nudge';
import {
	MATMUL_FAST_MS,
	MATMUL_OK_MS,
	deviceFor,
	packSpec,
	tierFromBenchmark,
	tierLabel,
	tierPacks
} from '~/utils/tiers';

const flagship = { webgpu: true, cores: 8, memoryGb: 8, matmulMs: 40 };

describe('tierFromBenchmark', () => {
	it('puts a flagship on tier 3', () => {
		expect(tierFromBenchmark(flagship)).toBe(3);
	});

	it('drops to tier 1 without WebGPU no matter the specs', () => {
		expect(tierFromBenchmark({ ...flagship, webgpu: false })).toBe(1);
	});

	it('lets a slow matmul veto a device that looks good on paper', () => {
		expect(tierFromBenchmark({ ...flagship, matmulMs: MATMUL_OK_MS + 1 })).toBe(1);
	});

	it('keeps a mid device on tier 2', () => {
		expect(tierFromBenchmark({ webgpu: true, cores: 6, memoryGb: 6, matmulMs: 150 })).toBe(2);
	});

	it('does not promote to tier 3 on a merely acceptable matmul', () => {
		expect(tierFromBenchmark({ ...flagship, matmulMs: MATMUL_FAST_MS + 1 })).toBe(2);
	});

	it('does not promote to tier 3 on too little memory', () => {
		expect(tierFromBenchmark({ ...flagship, memoryGb: 6 })).toBe(2);
	});

	it('keeps a 4GB device on tier 1 however fast it looks', () => {
		expect(tierFromBenchmark({ ...flagship, memoryGb: 4 })).toBe(1);
	});

	it('falls back to cores when memory is unreported', () => {
		expect(tierFromBenchmark({ ...flagship, memoryGb: 0 })).toBe(3);
		expect(tierFromBenchmark({ webgpu: true, cores: 4, memoryGb: 0, matmulMs: 150 })).toBe(1);
	});

	it('never returns anything outside 1..3', () => {
		for (const cores of [1, 4, 8, 16]) {
			for (const memoryGb of [0, 2, 6, 12]) {
				for (const matmulMs of [10, 100, 500]) {
					const tier = tierFromBenchmark({ webgpu: true, cores, memoryGb, matmulMs });
					expect([1, 2, 3]).toContain(tier);
				}
			}
		}
	});
});

describe('tierPacks', () => {
	it('defines every pack at every tier', () => {
		for (const tier of [1, 2, 3] as const) {
			const packs = tierPacks(tier, 'en');
			for (const pack of MODEL_PACKS) {
				expect(packs[pack], `${pack} at tier ${tier}`).not.toBeNull();
				expect(packs[pack]?.repo).toBeTruthy();
			}
		}
	});

	it('gives spanish a multilingual text model, since bge is english-only', () => {
		expect(tierPacks(1, 'en').text?.repo).toContain('bge-small-en');
		expect(tierPacks(1, 'es').text?.repo).not.toContain('-en-');
	});

	it('resolves a region locale by its language', () => {
		expect(tierPacks(1, 'es-MX').text?.repo).toBe(tierPacks(1, 'es').text?.repo);
		expect(tierPacks(1, 'en-GB').text?.repo).toBe(tierPacks(1, 'en').text?.repo);
	});

	it('uses an english-only whisper for english and multilingual otherwise', () => {
		expect(tierPacks(1, 'en').audio?.repo).toContain('.en');
		expect(tierPacks(1, 'es').audio?.repo).not.toContain('.en');
	});

	it('scales the transcriber from tier 1 to tier 2', () => {
		expect(tierPacks(1, 'en').audio?.repo).toContain('tiny');
		expect(tierPacks(2, 'en').audio?.repo).toContain('base');
	});

	/**
	 * Tier 3 shares tier 2's embedder and transcriber, measured rather than assumed:
	 * whisper-small and bge-large bought +0.020 audio F1 and nothing on text for +630 MB
	 * and 3.6x the p95, and they broke the single shipped threshold because a different
	 * embedder has a different similarity distribution.
	 */
	it('shares tier 2s embedder and transcriber at tier 3', () => {
		expect(tierPacks(3, 'en').audio?.repo).toBe(tierPacks(2, 'en').audio?.repo);
		expect(tierPacks(3, 'en').text?.repo).toBe(tierPacks(2, 'en').text?.repo);
		expect(tierPacks(3, 'en').audio?.repo).not.toContain('small');
	});

	it('still gives tier 3 the larger vision and writing models', () => {
		expect(tierPacks(3, 'en').vision?.repo).not.toBe(tierPacks(2, 'en').vision?.repo);
		expect(tierPacks(3, 'en').writing?.repo).not.toBe(tierPacks(2, 'en').writing?.repo);
	});

	it('uses the larger CLIP only at tier 3', () => {
		expect(tierPacks(1, 'en').vision?.repo).toContain('patch32');
		expect(tierPacks(2, 'en').vision?.repo).toContain('patch32');
		expect(tierPacks(3, 'en').vision?.repo).toContain('patch16');
	});

	it('picks a wasm-friendly dtype at tier 1 and fp16 above it', () => {
		expect(tierPacks(1, 'en').vision?.dtype).toBe('q8');
		expect(tierPacks(2, 'en').vision?.dtype).toBe('fp16');
	});

	it('assigns each pack the right pipeline task', () => {
		const packs = tierPacks(2, 'en');
		expect(packs.vision?.task).toBe('zero-shot-image-classification');
		expect(packs.text?.task).toBe('feature-extraction');
		expect(packs.audio?.task).toBe('automatic-speech-recognition');
		expect(packs.writing?.task).toBe('text-generation');
	});

	it('exposes a single pack through packSpec', () => {
		expect(packSpec('vision', 3, 'en')?.repo).toBe(tierPacks(3, 'en').vision?.repo);
	});
});

describe('deviceFor', () => {
	it('only asks for webgpu when the tier and the adapter both allow it', () => {
		expect(deviceFor(3, true)).toBe('webgpu');
		expect(deviceFor(2, true)).toBe('webgpu');
		expect(deviceFor(1, true)).toBe('wasm');
		expect(deviceFor(3, false)).toBe('wasm');
	});
});

describe('tierLabel', () => {
	it('names each tier distinctly', () => {
		const labels = [tierLabel(1), tierLabel(2), tierLabel(3)];
		expect(new Set(labels).size).toBe(3);
	});
});
