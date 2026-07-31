import { afterEach, describe, expect, it, vi } from 'vitest';

const { fsStat, fsMkdir } = vi.hoisted(() => ({
	fsStat: vi.fn(async () => ({})),
	fsMkdir: vi.fn(async () => ({}))
}));

vi.mock('@capacitor/filesystem', () => ({
	Filesystem: {
		stat: fsStat,
		mkdir: fsMkdir,
		readFile: vi.fn(async () => ({ data: '' })),
		writeFile: vi.fn(async () => ({ uri: '' })),
		deleteFile: vi.fn(async () => ({})),
		rmdir: vi.fn(async () => ({}))
	},
	Directory: { Data: 'DATA' },
	Encoding: { UTF8: 'utf8' }
}));

import { fetchPackBytes } from '~/composables/useModels';

interface Entry {
	path: string;
	size: number;
}

function tree(...entries: Entry[]) {
	return entries.map((entry) => ({ type: 'file', ...entry }));
}

function respondWith(body: unknown, ok = true) {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => ({ ok, json: async () => body }) as unknown as Response)
	);
}

const TOKENIZER: Entry[] = [
	{ path: 'tokenizer.json', size: 500_000 },
	{ path: 'config.json', size: 1_000 }
];

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('fetchPackBytes', () => {
	/**
	 * The dtype in the tier table is a transformers.js name, not a filename. `q8` maps
	 * to `_quantized`, so looking for `model_q8.onnx` matched nothing and every tier-1
	 * pack reported its size as unavailable.
	 */
	it('resolves q8 to the _quantized file the hub actually ships', async () => {
		respondWith(
			tree(
				{ path: 'onnx/model.onnx', size: 133_000_000 },
				{ path: 'onnx/model_quantized.onnx', size: 34_000_000 },
				{ path: 'onnx/model_fp16.onnx', size: 66_000_000 },
				...TOKENIZER
			)
		);

		expect(await fetchPackBytes('acme/embedder', 'q8')).toBe(34_000_000 + 501_000);
	});

	it.each([
		['fp16', '_fp16'],
		['q4', '_q4'],
		['q4f16', '_q4f16'],
		['int8', '_int8'],
		['uint8', '_uint8'],
		['bnb4', '_bnb4']
	])('maps %s to %s', async (dtype, suffix) => {
		respondWith(
			tree(
				{ path: 'onnx/model.onnx', size: 1 },
				{ path: `onnx/model${suffix}.onnx`, size: 7_000_000 },
				...TOKENIZER
			)
		);

		expect(await fetchPackBytes('acme/embedder', dtype)).toBe(7_000_000 + 501_000);
	});

	it('matches only the bare graph for fp32, not every suffixed sibling', async () => {
		respondWith(
			tree(
				{ path: 'onnx/model.onnx', size: 133_000_000 },
				{ path: 'onnx/model_fp16.onnx', size: 66_000_000 },
				{ path: 'onnx/model_quantized.onnx', size: 34_000_000 },
				...TOKENIZER
			)
		);

		expect(await fetchPackBytes('acme/embedder', 'fp32')).toBe(133_000_000 + 501_000);
	});

	/**
	 * ONNX external data. Past a size threshold a repo ships the graph in `model_x.onnx`
	 * and the weights beside it in `model_x.onnx_data`. Counting only the graph reported
	 * 413 KB for a 33 MB pack - a plausible-looking number that is wrong, which is worse
	 * than reporting nothing.
	 */
	it('counts the .onnx_data sidecar, where the real weights live', async () => {
		respondWith(
			tree(
				{ path: 'onnx/model_quantized.onnx', size: 413_666 },
				{ path: 'onnx/model_quantized.onnx_data', size: 33_393_408 },
				...TOKENIZER
			)
		);

		expect(await fetchPackBytes('acme/embedder', 'q8')).toBe(413_666 + 33_393_408 + 501_000);
	});

	it('pairs each sidecar with its own graph rather than summing all of them', async () => {
		respondWith(
			tree(
				{ path: 'onnx/model_quantized.onnx', size: 400_000 },
				{ path: 'onnx/model_quantized.onnx_data', size: 33_000_000 },
				{ path: 'onnx/model_fp16.onnx', size: 200_000 },
				{ path: 'onnx/model_fp16.onnx_data', size: 66_000_000 },
				...TOKENIZER
			)
		);

		expect(await fetchPackBytes('acme/embedder', 'fp16')).toBe(200_000 + 66_000_000 + 501_000);
	});

	/** a multi-tower repo like CLIP would otherwise report several pipelines' worth */
	it('keeps one file per tower and prefers a merged graph', async () => {
		respondWith(
			tree(
				{ path: 'onnx/text_model_quantized.onnx', size: 60_000_000 },
				{ path: 'onnx/vision_model_quantized.onnx', size: 90_000_000 },
				{ path: 'onnx/model_quantized.onnx', size: 150_000_000 },
				{ path: 'onnx/model_merged_quantized.onnx', size: 151_000_000 },
				...TOKENIZER
			)
		);

		// text + vision + one `model` tower, the merged variant winning
		expect(await fetchPackBytes('acme/clip', 'q8')).toBe(
			60_000_000 + 90_000_000 + 151_000_000 + 501_000
		);
	});

	it('sums encoder and decoder for a split repo like whisper', async () => {
		respondWith(
			tree(
				{ path: 'onnx/encoder_model_quantized.onnx', size: 9_000_000 },
				{ path: 'onnx/decoder_model_quantized.onnx', size: 30_000_000 },
				...TOKENIZER
			)
		);

		expect(await fetchPackBytes('acme/whisper', 'q8')).toBe(9_000_000 + 30_000_000 + 501_000);
	});

	it('returns null for an unknown dtype rather than guessing a file', async () => {
		respondWith(tree({ path: 'onnx/model.onnx', size: 1 }, ...TOKENIZER));
		expect(await fetchPackBytes('acme/embedder', 'made-up')).toBeNull();
	});

	it('returns null when the requested dtype is simply not published', async () => {
		respondWith(tree({ path: 'onnx/model.onnx', size: 1 }, ...TOKENIZER));
		expect(await fetchPackBytes('acme/embedder', 'q4f16')).toBeNull();
	});

	it('returns null on a missing repo instead of a fabricated size', async () => {
		respondWith({ error: 'Invalid username or password.' }, false);
		expect(await fetchPackBytes('acme/nope', 'q8')).toBeNull();
	});

	it('returns null when the listing is not an array', async () => {
		respondWith({ error: 'nope' });
		expect(await fetchPackBytes('acme/nope', 'q8')).toBeNull();
	});

	it('returns null rather than throwing when the network is gone', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new Error('offline');
			})
		);
		expect(await fetchPackBytes('acme/embedder', 'q8')).toBeNull();
	});
});
