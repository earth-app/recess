import { Capacitor } from '@capacitor/core';
import type { Benchmark } from '~/types/models';
import { tierFromBenchmark } from '~/utils/tiers';

// Reported specs lie on thermally-throttled and low-battery devices, so the tier
// is decided by a real timed workload with the reported numbers as context. The
// user can always override the result in Settings.

const MATMUL_SIZE = 128;
const MATMUL_ITERATIONS = 12;

interface GpuLike {
	requestAdapter(): Promise<unknown | null>;
}

export async function hasWebGpu(): Promise<boolean> {
	if (!import.meta.client) return false;
	const gpu = (navigator as unknown as { gpu?: GpuLike }).gpu;
	if (!gpu) return false;
	try {
		return (await gpu.requestAdapter()) !== null;
	} catch {
		return false;
	}
}

/**
 * a plain float32 matmul. crude on purpose - it measures the same arithmetic the
 * wasm backend does, needs no model, and finishes in well under a second even on
 * slow hardware.
 */
export function timeMatmul(size = MATMUL_SIZE, iterations = MATMUL_ITERATIONS): number {
	const a = new Float32Array(size * size);
	const b = new Float32Array(size * size);
	const out = new Float32Array(size * size);

	for (let i = 0; i < a.length; i++) {
		a[i] = (i % 17) / 17;
		b[i] = (i % 13) / 13;
	}

	const start = performance.now();
	for (let iteration = 0; iteration < iterations; iteration++) {
		for (let row = 0; row < size; row++) {
			for (let col = 0; col < size; col++) {
				let sum = 0;
				for (let k = 0; k < size; k++) {
					sum += (a[row * size + k] as number) * (b[k * size + col] as number);
				}
				out[row * size + col] = sum;
			}
		}
	}
	const elapsed = performance.now() - start;

	// keep the result observable so the loop cannot be optimized away
	if (!Number.isFinite(out[0] as number)) return Number.POSITIVE_INFINITY;
	return elapsed / iterations;
}

async function reportedMemoryGb(): Promise<number> {
	// deviceMemory is a coarse browser hint in GiB; Capacitor gives a real figure
	if (Capacitor.isNativePlatform()) {
		try {
			const { Device } = await import('@capacitor/device');
			const info = await Device.getInfo();
			if (typeof info.memUsed === 'number' && info.memUsed > 0) {
				// memUsed is bytes in use, not total, so it only ever gives a floor
				return Math.max(0, Math.round((info.memUsed / 1_073_741_824) * 10) / 10);
			}
		} catch {
			// fall through to the web hint
		}
	}

	const hint = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
	return typeof hint === 'number' && hint > 0 ? hint : 0;
}

export function useCapability() {
	const models = useModelsStore();

	async function measure(): Promise<Omit<Benchmark, 'tier' | 'at'>> {
		const [webgpu, memoryGb] = await Promise.all([hasWebGpu(), reportedMemoryGb()]);
		const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;

		// yield first so the measurement does not land inside a paint
		await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

		return { webgpu, cores, memoryGb, matmulMs: timeMatmul(), inferenceMs: null };
	}

	/** run the benchmark and persist the resulting tier */
	async function benchmark(): Promise<Benchmark> {
		await models.load();
		return models.setBenchmark(await measure());
	}

	/** benchmark once, then trust the stored result */
	async function ensure(): Promise<Benchmark | null> {
		await models.load();
		if (models.benchmark) return models.benchmark;
		if (!import.meta.client) return null;
		return benchmark();
	}

	return {
		tier: computed(() => models.tier),
		detectedTier: computed(() => models.detectedTier),
		benchmark: computed(() => models.benchmark),
		tierFromBenchmark,
		measure,
		runBenchmark: benchmark,
		ensure
	};
}
