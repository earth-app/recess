import { beforeEach, describe, expect, it, vi } from 'vitest';
import { areaPackSchema, type AreaManifestEntry, type AreaPack } from '~/types/places';
import fixture from '../../fixtures/areas/us-il-chicago-loop.json';

const store = new Map<string, string>();
const disk = new Map<string, string>();

const { prefsGet, prefsSet, prefsRemove } = vi.hoisted(() => ({
	prefsGet: vi.fn(),
	prefsSet: vi.fn(),
	prefsRemove: vi.fn()
}));

vi.mock('@capacitor/preferences', () => ({
	Preferences: {
		configure: vi.fn(async () => {}),
		get: prefsGet,
		set: prefsSet,
		remove: prefsRemove,
		clear: vi.fn(async () => {})
	}
}));

vi.mock('@capacitor/filesystem', () => ({
	Directory: { Data: 'DATA' },
	Encoding: { UTF8: 'utf8' },
	Filesystem: {
		stat: vi.fn(async () => ({})),
		mkdir: vi.fn(async () => {}),
		writeFile: vi.fn(async ({ path, data }: { path: string; data: string }) => {
			disk.set(path, data);
		}),
		readFile: vi.fn(async ({ path }: { path: string }) => {
			const value = disk.get(path);
			if (value === undefined) throw new Error('missing');
			return { data: value };
		}),
		deleteFile: vi.fn(async ({ path }: { path: string }) => {
			disk.delete(path);
		})
	}
}));

import { areasCovering, useAreas } from '~/composables/useAreas';
import { networkOffline } from '~/composables/useNetwork';
import { parseAreas } from '~/stores/areas';

/**
 * The committed fixture is a real OSM cut of the Chicago Loop, not invented data.
 *
 * Parsed through the shipping schema rather than cast, so the fixture itself is checked - if the
 * pack format ever changes without the fixture being rebuilt, every case here fails loudly
 * instead of testing a shape the app no longer reads.
 */
const FIXTURE: AreaPack = areaPackSchema.parse(fixture);

function manifestEntry(overrides: Partial<AreaManifestEntry> = {}): AreaManifestEntry {
	return {
		id: 'us-il-chicago-loop',
		label: 'Chicago Loop',
		bbox: [-87.65, 41.87, -87.61, 41.9],
		bytes: 17_600,
		places: 1111,
		built_at: 1_700_000_000_000,
		...overrides
	};
}

beforeEach(async () => {
	store.clear();
	disk.clear();
	vi.clearAllMocks();
	networkOffline.value = false;
	useSettings().cache.clear();

	prefsGet.mockImplementation(async ({ key }: { key: string }) => ({
		value: store.get(key) ?? null
	}));
	prefsSet.mockImplementation(async ({ key, value }: { key: string; value: string }) => {
		store.set(key, value);
	});
	prefsRemove.mockImplementation(async ({ key }: { key: string }) => {
		store.delete(key);
	});
});

describe('the committed fixture', () => {
	it('is a real pack with real places', () => {
		expect(FIXTURE.version).toBe(1);
		expect(FIXTURE.places.length).toBeGreaterThan(500);
		expect(FIXTURE.attribution).toMatch(/OpenStreetMap/);
	});

	// ODbL: the source has to be named in the data itself so it cannot drift from it
	it('carries its own attribution rather than relying on the UI to remember', () => {
		expect(FIXTURE.attribution).toMatch(/ODbL/);
	});

	it('holds coordinates already snapped to the privacy grid', () => {
		for (const place of FIXTURE.places.slice(0, 50)) {
			expect(Number(place.lat.toFixed(6))).toBe(place.lat);
			expect(Number(place.lon.toFixed(6))).toBe(place.lon);
		}
	});
});

describe('parseAreas', () => {
	it('returns an empty registry for junk', () => {
		expect(parseAreas(null)).toEqual({ installed: {}, active: null });
		expect(parseAreas('nope')).toEqual({ installed: {}, active: null });
	});

	// one bad entry costs that area, not every area the user downloaded
	it('drops only the corrupt entry', () => {
		const parsed = parseAreas({
			installed: {
				good: { id: 'good', label: 'Good', bytes: 10, places: 5, installedAt: 1, built_at: 1 },
				bad: { id: 'bad', label: 42 }
			},
			active: 'good'
		});

		expect(Object.keys(parsed.installed)).toEqual(['good']);
		expect(parsed.active).toBe('good');
	});

	it('refuses an active id that is not installed', () => {
		expect(parseAreas({ installed: {}, active: 'ghost' }).active).toBeNull();
	});
});

describe('areasCovering', () => {
	const chicago = manifestEntry();
	const london = manifestEntry({ id: 'gb-london', bbox: [-0.2, 51.4, 0.05, 51.6] });

	it('returns nothing without a position', () => {
		expect(areasCovering([chicago], null)).toEqual([]);
	});

	it('picks the pack whose box contains you', () => {
		const found = areasCovering([london, chicago], { latitude: 41.88, longitude: -87.63 });
		expect(found.map((entry) => entry.id)).toEqual(['us-il-chicago-loop']);
	});

	it('returns nothing when no pack covers you, rather than the nearest wrong one', () => {
		expect(areasCovering([chicago, london], { latitude: -33.87, longitude: 151.2 })).toEqual([]);
	});

	it('orders overlapping packs by how central you are in them', () => {
		const wide = manifestEntry({ id: 'wide', bbox: [-88, 41, -87, 42] });
		const found = areasCovering([wide, chicago], { latitude: 41.885, longitude: -87.63 });
		expect(found[0]?.id).toBe('us-il-chicago-loop');
	});
});

describe('download', () => {
	function respondWith(body: unknown, ok = true) {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ ok, json: async () => body }) as unknown as Response)
		);
	}

	it('installs a real pack and records its measured size', async () => {
		respondWith(FIXTURE);
		const areas = useAreas();

		const result = await areas.download(FIXTURE.id);

		expect(result.ok).toBe(true);
		expect(areas.pack.value?.places.length).toBe(FIXTURE.places.length);
		// the recorded size is what was actually written, never an estimate
		expect(areas.installed.value[0]?.bytes).toBeGreaterThan(1000);
		expect(areas.installed.value[0]?.places).toBe(FIXTURE.places.length);
	});

	it('refuses offline rather than half-installing', async () => {
		networkOffline.value = true;
		const result = await useAreas().download(FIXTURE.id);
		expect(result).toEqual({ ok: false, reason: 'offline' });
	});

	it('rejects a malformed pack instead of storing it', async () => {
		respondWith({ version: 1, id: 'x' });
		const result = await useAreas().download('x');
		expect(result.ok).toBe(false);
		expect(result.reason).toBe('malformed');
	});

	/**
	 * Coverage, not count. Johnson et al. (CHI 2016) found rural OSM carries more features per
	 * capita than urban while local editors supply a fraction of the tokens, so a pack can be
	 * large and still have nothing worth pointing at. Refusing it beats installing it and then
	 * showing an empty map.
	 */
	it('refuses a pack too thin to build a surface on', async () => {
		// plenty of places, but only two distinct affordances between them - the shape a
		// thinly-mapped rural area actually takes
		respondWith({
			...FIXTURE,
			places: FIXTURE.places
				.filter((place) => place.a.length === 1 && (place.a[0] === 'sit' || place.a[0] === 'art'))
				.slice(0, 200)
		});

		const result = await useAreas().download(FIXTURE.id);
		expect(result).toEqual({ ok: false, reason: 'too-thin' });
	});

	it('returns a failure rather than throwing when the fetch dies', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new Error('network');
			})
		);
		const result = await useAreas().download(FIXTURE.id);
		expect(result.ok).toBe(false);
	});
});

describe('load and remove', () => {
	it('reads an installed pack back off disk', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ ok: true, json: async () => FIXTURE }) as unknown as Response)
		);
		const areas = useAreas();
		await areas.download(FIXTURE.id);

		const loaded = await areas.load(FIXTURE.id);
		expect(loaded?.places.length).toBe(FIXTURE.places.length);
	});

	it('reads as no pack when the file is gone', async () => {
		const areas = useAreas();
		expect(await areas.load('never-installed')).toBeNull();
	});

	it('remove clears the registry even when the file is already missing', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ ok: true, json: async () => FIXTURE }) as unknown as Response)
		);
		const areas = useAreas();
		await areas.download(FIXTURE.id);
		disk.clear();

		await areas.remove(FIXTURE.id);
		expect(areas.installed.value).toHaveLength(0);
	});
});
