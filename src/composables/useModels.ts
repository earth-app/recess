import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import type { ModelPack } from '~/types/nudge';
import { MODEL_PACKS } from '~/types/nudge';
import { loadPack, unload } from '~/utils/ml';
import { packSpec } from '~/utils/tiers';

// Weights land in Cache Storage (transformers.js owns that) and are mirrored into
// Filesystem, because Cache carries the same no-persistence-guarantee caveat as
// localStorage and re-downloading hundreds of megabytes on a low-disk device
// would be a genuinely bad failure.

/** transformers.js's own cache name; an implementation detail we depend on */
const TRANSFORMERS_CACHE = 'transformers-cache';
const MIRROR_DIR = 'models';

export const HF_API = 'https://huggingface.co/api/models';

interface HfTreeEntry {
	type?: string;
	path?: string;
	size?: number;
}

/**
 * transformers.js dtype -> the filename suffix the hub actually uses.
 *
 * Mirrors `DEFAULT_DTYPE_SUFFIX_MAPPING` in `@huggingface/transformers`. This is not
 * cosmetic: `q8` is the tier-1 dtype for most packs and the hub file is
 * `model_quantized.onnx`, so looking for `model_q8.onnx` found nothing and every
 * tier-1 pack reported its size as unavailable.
 */
const DTYPE_SUFFIX: Record<string, string> = {
	fp32: '',
	fp16: '_fp16',
	int8: '_int8',
	uint8: '_uint8',
	q8: '_quantized',
	q4: '_q4',
	q2: '_q2',
	q1: '_q1',
	q4f16: '_q4f16',
	q2f16: '_q2f16',
	q1f16: '_q1f16',
	bnb4: '_bnb4'
};

/**
 * Real byte total from the hub file listing, summing one pipeline's worth of
 * weights rather than every file in the repo. Never a hardcoded estimate - a made
 * up "~50 MB" in the UI is a fabricated fact the user would read as real.
 *
 * Three traps this avoids:
 *
 * 1. The dtype in our tier table is a transformers.js name, not a filename. See
 *    `DTYPE_SUFFIX`.
 * 2. **ONNX external data.** Repos past a size threshold ship the graph in
 *    `model_x.onnx` and the weights beside it in `model_x.onnx_data`. Summing only
 *    `.onnx` reported 413 KB for a 33 MB pack - a plausible-looking number that is
 *    wrong, which is worse than reporting nothing.
 * 3. A multi-tower repo like CLIP ships `model`, `text_model`, `vision_model` and
 *    `*_merged` variants; summing all of them reports several times what one
 *    pipeline actually downloads.
 */
export async function fetchPackBytes(repo: string, dtype: string): Promise<number | null> {
	try {
		const response = await fetch(`${HF_API}/${repo}/tree/main?recursive=1`);
		if (!response.ok) return null;

		const tree = (await response.json()) as HfTreeEntry[];
		if (!Array.isArray(tree)) return null;

		const files = tree.filter(
			(entry): entry is HfTreeEntry & { path: string; size: number } =>
				entry.type === 'file' && typeof entry.size === 'number' && typeof entry.path === 'string'
		);

		const suffix = DTYPE_SUFFIX[dtype];
		if (suffix === undefined) return null;

		const graphs = files.filter((entry) => entry.path.endsWith(`${suffix}.onnx`));

		// an empty suffix would also match `model_fp16.onnx`, so fp32 needs the graph name
		// to end exactly at `model`
		const matching =
			suffix === '' ? graphs.filter((entry) => /(^|\/)[^/]*model\.onnx$/.test(entry.path)) : graphs;

		if (matching.length === 0) return null;

		// weights that live beside the graph rather than inside it
		const sidecars = new Map<string, number>();
		for (const entry of files) {
			if (entry.path.endsWith('.onnx_data')) {
				sidecars.set(entry.path.replace(/\.onnx_data$/, '.onnx'), entry.size);
			}
		}

		// group by tower (the filename with the dtype suffix stripped) and keep one
		// file per tower, preferring a merged graph when the repo ships both
		const byTower = new Map<string, number>();
		for (const entry of matching) {
			const name = entry.path.split('/').pop() ?? entry.path;
			const tower = name.replace(/_merged/, '').replace(/(_[a-z0-9]+)?\.onnx$/, '');
			const isMerged = name.includes('_merged');
			const total = entry.size + (sidecars.get(entry.path) ?? 0);
			const existing = byTower.get(tower);
			if (existing === undefined || isMerged) byTower.set(tower, total);
		}

		const weights = [...byTower.values()].reduce((sum, size) => sum + size, 0);

		// tokenizer and config are small but real; anything else is noise
		const support = files
			.filter((entry) =>
				/\/?(tokenizer|config|preprocessor|vocab|merges|special_tokens)[^/]*\.(json|txt)$/.test(
					entry.path
				)
			)
			.reduce((sum, entry) => sum + entry.size, 0);

		return weights + support;
	} catch {
		return null;
	}
}

async function ensureDir(path: string) {
	try {
		await Filesystem.stat({ path, directory: Directory.Data });
	} catch {
		try {
			await Filesystem.mkdir({ path, directory: Directory.Data, recursive: true });
		} catch {
			// already created by a concurrent call
		}
	}
}

function mirrorName(pack: ModelPack, url: string): string {
	// flatten the url into one filename so no nested dirs are needed
	const safe = url.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9._-]/g, '_');
	return `${MIRROR_DIR}/${pack}/${safe}`;
}

async function openCache(): Promise<Cache | null> {
	if (typeof caches === 'undefined') return null;
	try {
		return await caches.open(TRANSFORMERS_CACHE);
	} catch {
		return null;
	}
}

function toBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = '';
	// chunked so a large weight file cannot blow the argument limit
	for (let i = 0; i < bytes.length; i += 8192) {
		binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
	}
	return btoa(binary);
}

function fromBase64(base64: string): ArrayBuffer {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes.buffer;
}

/** copy every cached entry for a repo into Filesystem, returning the byte total */
async function mirrorToFilesystem(pack: ModelPack, repo: string): Promise<number> {
	const cache = await openCache();
	if (!cache) return 0;

	await ensureDir(`${MIRROR_DIR}/${pack}`);

	let bytes = 0;
	for (const request of await cache.keys()) {
		if (!request.url.includes(repo)) continue;

		const response = await cache.match(request);
		if (!response) continue;

		const buffer = await response.clone().arrayBuffer();
		bytes += buffer.byteLength;

		try {
			await Filesystem.writeFile({
				path: mirrorName(pack, request.url),
				data: toBase64(buffer),
				directory: Directory.Data,
				encoding: Encoding.UTF8
			});
		} catch {
			// out of disk; the Cache copy still works this session
		}
	}

	return bytes;
}

/** put the mirrored files back when the OS has reclaimed Cache Storage */
export async function reseedFromFilesystem(pack: ModelPack): Promise<boolean> {
	const cache = await openCache();
	if (!cache) return false;

	try {
		const listing = await Filesystem.readdir({
			path: `${MIRROR_DIR}/${pack}`,
			directory: Directory.Data
		});

		let restored = 0;
		for (const file of listing.files) {
			const stored = await Filesystem.readFile({
				path: `${MIRROR_DIR}/${pack}/${file.name}`,
				directory: Directory.Data,
				encoding: Encoding.UTF8
			});

			// the flattened name is the url with separators replaced; recover it
			const url = `https://${file.name.replace(/_/g, '/')}`;
			await cache.put(url, new Response(fromBase64(stored.data as string)));
			restored++;
		}

		return restored > 0;
	} catch {
		return false;
	}
}

async function removeMirror(pack: ModelPack) {
	try {
		await Filesystem.rmdir({
			path: `${MIRROR_DIR}/${pack}`,
			directory: Directory.Data,
			recursive: true
		});
	} catch {
		// nothing mirrored
	}
}

async function purgeCache(repo: string) {
	const cache = await openCache();
	if (!cache) return;
	for (const request of await cache.keys()) {
		if (request.url.includes(repo)) await cache.delete(request);
	}
}

export type DownloadResult =
	{ ok: true; bytes: number } | { ok: false; reason: 'offline' | 'failed' | 'unknown-pack' };

export function useModels() {
	const store = useModelsStore();
	const settings = useAppSettingsState();
	const { ensure: ensureBenchmark } = useCapability();

	function specFor(pack: ModelPack) {
		return packSpec(pack, store.tier, settings.value.locale);
	}

	async function loadOptions(allowRemote: boolean) {
		const benchmark = await ensureBenchmark();
		return {
			tier: store.tier,
			locale: settings.value.locale,
			webgpu: benchmark?.webgpu ?? false,
			allowRemote
		};
	}

	/** real size for the pack this device would actually download */
	async function sizeOf(pack: ModelPack): Promise<number | null> {
		const spec = specFor(pack);
		if (!spec) return null;
		if (isOffline.value) return null;
		return fetchPackBytes(spec.repo, spec.dtype);
	}

	async function download(pack: ModelPack): Promise<DownloadResult> {
		await store.load();

		const gate = downloadGate();
		if (!gate.allowed) return { ok: false, reason: 'offline' };

		const spec = specFor(pack);
		if (!spec) return { ok: false, reason: 'unknown-pack' };

		store.busy = pack;
		store.setProgress({ pack, ratio: null, loaded: 0, total: null, file: null });

		try {
			const entry = await loadPack(pack, {
				...(await loadOptions(true)),
				onProgress: ({ file, loaded, total }) => {
					store.setProgress({
						pack,
						loaded: loaded ?? 0,
						total: total ?? null,
						ratio: total && total > 0 ? Math.min(1, (loaded ?? 0) / total) : null,
						file: file ?? null
					});
				}
			});

			if (!entry) return { ok: false, reason: 'failed' };

			const bytes = await mirrorToFilesystem(pack, spec.repo);
			await store.markInstalled(pack, { bytes, repo: spec.repo });
			return { ok: true, bytes };
		} catch {
			return { ok: false, reason: 'failed' };
		} finally {
			store.busy = null;
			store.setProgress(null);
		}
	}

	async function remove(pack: ModelPack) {
		await store.load();
		const repo = store.packs[pack].repo ?? specFor(pack)?.repo;

		unload(pack);
		if (repo) await purgeCache(repo);
		await removeMirror(pack);
		await store.markRemoved(pack);
	}

	/**
	 * make an installed pack usable this session. re-seeds Cache Storage from the
	 * Filesystem mirror when the OS has reclaimed it.
	 */
	async function warm(pack: ModelPack): Promise<boolean> {
		await store.load();
		if (!store.has(pack)) return false;

		const options = await loadOptions(false);
		if (await loadPack(pack, options)) return true;

		if (await reseedFromFilesystem(pack)) {
			return (await loadPack(pack, options)) !== null;
		}

		return false;
	}

	/** a tier or locale change can leave an installed pack pointing at the wrong repo */
	function isStale(pack: ModelPack): boolean {
		const installed = store.packs[pack];
		if (!installed.installed || !installed.repo) return false;
		return installed.repo !== specFor(pack)?.repo;
	}

	const staleePacks = computed(() => MODEL_PACKS.filter(isStale));

	return {
		packs: computed(() => store.packs),
		progress: computed(() => store.progress),
		busy: computed(() => store.busy),
		tier: computed(() => store.tier),
		installed: computed(() => store.installed),
		totalBytes: computed(() => store.totalBytes),
		stalePacks: staleePacks,
		specFor,
		sizeOf,
		download,
		remove,
		warm,
		isStale
	};
}
