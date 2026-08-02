import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import type { AreaManifestEntry, AreaPack } from '~/types/places';
import { areaManifestSchema, areaPackSchema } from '~/types/places';
import type { Coordinate } from '~/utils/geo';
import { distanceMetres } from '~/utils/geo';
import { isPackUsable } from '~/utils/places';

/**
 * Area packs live in a public Hugging Face dataset repo.
 *
 * Not R2 and not a server of our own: recess already downloads model packs from Hugging Face
 * through `useModels.ts`, so this reuses a proven code path with no new infrastructure and no
 * running cost. A public URL also happens to discharge the ODbL obligation to keep the derived
 * database available, which a private bucket would not.
 */
export const AREA_REPO = 'earth-app/recess-areas';
const BASE = `https://huggingface.co/datasets/${AREA_REPO}/resolve/main`;

export const areaManifestUrl = () => `${BASE}/manifest.json`;
export const areaPackUrl = (id: string) => `${BASE}/packs/${id}.json`;

const PACK_DIR = 'areas';
const FETCH_TIMEOUT_MS = 20_000;

/** the loaded pack, kept in memory for the session; only one is active at a time */
const pack = ref<AreaPack | null>(null);
const loading = ref(false);

function packPath(id: string) {
	return `${PACK_DIR}/${id}.json`;
}

async function ensureDir() {
	try {
		await Filesystem.stat({ path: PACK_DIR, directory: Directory.Data });
	} catch {
		try {
			await Filesystem.mkdir({ path: PACK_DIR, directory: Directory.Data, recursive: true });
		} catch {
			// already created by a concurrent call
		}
	}
}

async function fetchJson(url: string): Promise<unknown | null> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	try {
		const response = await fetch(url, { signal: controller.signal });
		if (!response.ok) return null;
		return await response.json();
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Which packs cover a point, nearest centre first.
 *
 * Pure, so the "which area am I in" question is testable without any network or disk.
 */
export function areasCovering(
	entries: readonly AreaManifestEntry[],
	at: Coordinate | null
): AreaManifestEntry[] {
	if (!at) return [];

	return entries
		.filter((entry) => {
			const [west, south, east, north] = entry.bbox;
			return (
				at.longitude >= Math.min(west, east) &&
				at.longitude <= Math.max(west, east) &&
				at.latitude >= Math.min(south, north) &&
				at.latitude <= Math.max(south, north)
			);
		})
		.sort((a, b) => {
			const centre = (entry: AreaManifestEntry): Coordinate => ({
				latitude: (entry.bbox[1] + entry.bbox[3]) / 2,
				longitude: (entry.bbox[0] + entry.bbox[2]) / 2
			});
			return distanceMetres(at, centre(a)) - distanceMetres(at, centre(b));
		});
}

export function useAreas() {
	const store = useAreasStore();

	/** the catalogue of packs available to download; empty when offline, which is not an error */
	async function refreshManifest(): Promise<AreaManifestEntry[]> {
		if (isOffline.value) return store.manifest;

		const parsed = areaManifestSchema.safeParse(await fetchJson(areaManifestUrl()));
		if (!parsed.success) return store.manifest;

		store.setManifest(parsed.data.areas);
		return parsed.data.areas;
	}

	async function readFromDisk(id: string): Promise<AreaPack | null> {
		try {
			const file = await Filesystem.readFile({
				path: packPath(id),
				directory: Directory.Data,
				encoding: Encoding.UTF8
			});
			const parsed = areaPackSchema.safeParse(JSON.parse(file.data as string));
			return parsed.success ? parsed.data : null;
		} catch {
			return null;
		}
	}

	/** bring the active pack into memory; a missing or corrupt pack reads as "no pack" */
	async function load(id?: string): Promise<AreaPack | null> {
		await store.load();
		const target = id ?? store.active;
		if (!target) return null;
		if (pack.value?.id === target) return pack.value;

		loading.value = true;
		try {
			pack.value = await readFromDisk(target);
			return pack.value;
		} finally {
			loading.value = false;
		}
	}

	async function download(id: string): Promise<{ ok: boolean; reason?: string }> {
		await store.load();

		const gate = downloadGate();
		if (!gate.allowed) return { ok: false, reason: 'offline' };

		store.busy = id;
		store.setProgress({ id, loaded: 0, total: null, ratio: null });

		try {
			const raw = await fetchJson(areaPackUrl(id));
			if (raw === null) return { ok: false, reason: 'failed' };

			const parsed = areaPackSchema.safeParse(raw);
			if (!parsed.success) return { ok: false, reason: 'malformed' };

			// a pack too thin to build a surface on is refused rather than installed and
			// then found to be empty; see isPackUsable for why this counts affordances
			if (!isPackUsable(parsed.data)) return { ok: false, reason: 'too-thin' };

			const body = JSON.stringify(parsed.data);
			await ensureDir();
			await Filesystem.writeFile({
				path: packPath(id),
				data: body,
				directory: Directory.Data,
				encoding: Encoding.UTF8
			});

			await store.markInstalled({
				id: parsed.data.id,
				label: parsed.data.label,
				// real size, measured from what was actually written
				bytes: new TextEncoder().encode(body).length,
				places: parsed.data.places.length,
				installedAt: Date.now(),
				built_at: parsed.data.built_at
			});

			pack.value = parsed.data;
			return { ok: true };
		} catch {
			return { ok: false, reason: 'failed' };
		} finally {
			store.busy = null;
			store.setProgress(null);
		}
	}

	async function remove(id: string) {
		await store.load();
		try {
			await Filesystem.deleteFile({ path: packPath(id), directory: Directory.Data });
		} catch {
			// nothing on disk; the registry entry still has to go
		}
		if (pack.value?.id === id) pack.value = null;
		await store.markRemoved(id);
	}

	/** install a pack the app already holds, used by the dev panel and the e2e harness */
	async function adopt(candidate: unknown): Promise<boolean> {
		const parsed = areaPackSchema.safeParse(candidate);
		if (!parsed.success) return false;

		const body = JSON.stringify(parsed.data);
		await ensureDir();
		try {
			await Filesystem.writeFile({
				path: packPath(parsed.data.id),
				data: body,
				directory: Directory.Data,
				encoding: Encoding.UTF8
			});
		} catch {
			// in-memory only is still useful for a dev session
		}

		await store.markInstalled({
			id: parsed.data.id,
			label: parsed.data.label,
			bytes: new TextEncoder().encode(body).length,
			places: parsed.data.places.length,
			installedAt: Date.now(),
			built_at: parsed.data.built_at
		});

		pack.value = parsed.data;
		return true;
	}

	function suggestFor(at: Coordinate | null): AreaManifestEntry[] {
		return areasCovering(store.manifest, at);
	}

	return {
		pack: readonly(pack),
		loading: readonly(loading),
		manifest: computed(() => store.manifest),
		installed: computed(() => store.list),
		active: computed(() => store.activeArea),
		totalBytes: computed(() => store.totalBytes),
		progress: computed(() => store.progress),
		busy: computed(() => store.busy),
		refreshManifest,
		load,
		download,
		remove,
		adopt,
		suggestFor,
		setActive: (id: string | null) => store.setActive(id)
	};
}
