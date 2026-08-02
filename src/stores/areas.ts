import { defineStore } from 'pinia';
import type { AreaManifestEntry } from '~/types/places';

export const AREAS_KEY = 'recess.areas.v1';

export interface InstalledArea {
	id: string;
	label: string;
	/** real measured bytes on disk; never an estimate */
	bytes: number;
	places: number;
	installedAt: number;
	/** epoch ms of the OSM extract, so a stale pack can be spotted against the manifest */
	built_at: number;
}

export interface AreaProgress {
	id: string;
	loaded: number;
	total: number | null;
	ratio: number | null;
}

interface PersistedAreas {
	installed: Record<string, InstalledArea>;
	/** the pack the Out There tab is reading; null until one is chosen */
	active: string | null;
}

function isInstalledArea(value: unknown): value is InstalledArea {
	if (!value || typeof value !== 'object') return false;
	const record = value as Partial<InstalledArea>;
	return (
		typeof record.id === 'string' &&
		record.id.length > 0 &&
		typeof record.label === 'string' &&
		typeof record.bytes === 'number' &&
		Number.isFinite(record.bytes) &&
		typeof record.places === 'number' &&
		Number.isFinite(record.places)
	);
}

/**
 * Per-entry validation rather than a whole-blob cast.
 *
 * Same reasoning as the progress ledger: one corrupt entry should cost that one area, not every
 * area the user has downloaded.
 */
export function parseAreas(raw: unknown): PersistedAreas {
	const empty: PersistedAreas = { installed: {}, active: null };
	if (!raw || typeof raw !== 'object') return empty;

	const source = raw as Partial<PersistedAreas>;
	const installed: Record<string, InstalledArea> = {};

	if (source.installed && typeof source.installed === 'object') {
		for (const [id, entry] of Object.entries(source.installed)) {
			if (!isInstalledArea(entry)) continue;
			installed[id] = {
				id: entry.id,
				label: entry.label,
				bytes: Math.max(0, Math.round(entry.bytes)),
				places: Math.max(0, Math.round(entry.places)),
				installedAt: typeof entry.installedAt === 'number' ? entry.installedAt : 0,
				built_at: typeof entry.built_at === 'number' ? entry.built_at : 0
			};
		}
	}

	const active =
		typeof source.active === 'string' && installed[source.active] ? source.active : null;

	return { installed, active };
}

export const useAreasStore = defineStore('areas', () => {
	const installed = ref<Record<string, InstalledArea>>({});
	const active = ref<string | null>(null);
	const manifest = ref<AreaManifestEntry[]>([]);
	const progress = ref<AreaProgress | null>(null);
	const busy = ref<string | null>(null);
	const ready = ref(false);

	const list = computed(() => Object.values(installed.value));
	const totalBytes = computed(() => list.value.reduce((sum, area) => sum + area.bytes, 0));
	const activeArea = computed(() =>
		active.value ? (installed.value[active.value] ?? null) : null
	);

	function has(id: string): boolean {
		return installed.value[id] !== undefined;
	}

	async function load() {
		if (ready.value) return;
		const { get } = useSettings();
		await configurePreferencesGroup();

		const parsed = parseAreas(await get<unknown>(AREAS_KEY, null));
		installed.value = parsed.installed;
		active.value = parsed.active;
		ready.value = true;
	}

	async function persist() {
		const { set } = useSettings();
		await set(AREAS_KEY, {
			installed: installed.value,
			active: active.value
		} satisfies PersistedAreas);
	}

	async function markInstalled(area: InstalledArea) {
		installed.value = { ...installed.value, [area.id]: area };
		// first pack installed becomes the active one; there is nothing to choose between
		if (active.value === null) active.value = area.id;
		await persist();
	}

	async function markRemoved(id: string) {
		const next = { ...installed.value };
		delete next[id];
		installed.value = next;
		if (active.value === id) active.value = Object.keys(next)[0] ?? null;
		await persist();
	}

	async function setActive(id: string | null) {
		if (id !== null && !has(id)) return;
		active.value = id;
		await persist();
	}

	function setManifest(entries: AreaManifestEntry[]) {
		manifest.value = entries;
	}

	function setProgress(next: AreaProgress | null) {
		progress.value = next;
	}

	/** the pack on disk is older than what the manifest offers */
	function isStale(id: string): boolean {
		const local = installed.value[id];
		const remote = manifest.value.find((entry) => entry.id === id);
		if (!local || !remote) return false;
		return remote.built_at > local.built_at;
	}

	return {
		installed,
		active,
		manifest,
		progress,
		busy,
		ready,
		list,
		totalBytes,
		activeArea,
		has,
		load,
		persist,
		markInstalled,
		markRemoved,
		setActive,
		setManifest,
		setProgress,
		isStale
	};
});
