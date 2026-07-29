import type { ModelPack } from './nudge';

export type DeviceTier = 1 | 2 | 3;

export interface Benchmark {
	/** a WebGPU adapter was obtained */
	webgpu: boolean;
	cores: number;
	/** GB as reported by the OS, 0 when unavailable */
	memoryGb: number;
	/** ms for the fixed matmul workload; lower is faster */
	matmulMs: number;
	/** ms for one tiny warm inference, when a model was already present */
	inferenceMs: number | null;
	tier: DeviceTier;
	at: number;
}

export interface PackState {
	installed: boolean;
	/** measured on-disk bytes; never a hardcoded estimate */
	bytes: number;
	installedAt: number | null;
	/** repo id actually installed, so a tier change can detect a mismatch */
	repo: string | null;
	revision: string | null;
}

export type PackStates = Record<ModelPack, PackState>;

export interface PackProgress {
	pack: ModelPack;
	/** 0..1 when total is known, otherwise null for an indeterminate bar */
	ratio: number | null;
	loaded: number;
	total: number | null;
	file: string | null;
}

export function emptyPackState(): PackState {
	return { installed: false, bytes: 0, installedAt: null, repo: null, revision: null };
}
