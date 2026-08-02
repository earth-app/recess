import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POSITION_MAX_AGE_MS, POSITION_USABLE_AGE_MS } from '~/types/context';

const store = new Map<string, string>();

const {
	prefsGet,
	prefsSet,
	prefsRemove,
	getCurrentPosition,
	checkPermissions,
	requestPermissions
} = vi.hoisted(() => ({
	prefsGet: vi.fn(),
	prefsSet: vi.fn(),
	prefsRemove: vi.fn(),
	getCurrentPosition: vi.fn(),
	checkPermissions: vi.fn(),
	requestPermissions: vi.fn()
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

vi.mock('@capacitor/geolocation', () => ({
	Geolocation: { getCurrentPosition, checkPermissions, requestPermissions }
}));

vi.mock('@capacitor/core', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@capacitor/core')>();
	return { ...actual, Capacitor: { ...actual.Capacitor, isNativePlatform: () => true } };
});

import {
	isPositionFresh,
	isPositionUsable,
	parsePositionSnapshot,
	POSITION_KEY,
	usePosition
} from '~/composables/usePosition';
import { distanceMetres, GRID_METRES, snapToGrid } from '~/utils/geo';

const RAW = { latitude: 41.881944, longitude: -87.627778 };

function fixAt(latitude: number, longitude: number, accuracy = 30) {
	return { coords: { latitude, longitude, accuracy } };
}

function seed(value: unknown) {
	store.set(POSITION_KEY, JSON.stringify(value));
}

function storedRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		latitude: RAW.latitude,
		longitude: RAW.longitude,
		accuracy: 30,
		fetched_at: Date.now(),
		manual: false,
		...overrides
	};
}

beforeEach(async () => {
	store.clear();
	vi.clearAllMocks();
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

	checkPermissions.mockResolvedValue({ location: 'granted', coarseLocation: 'granted' });
	requestPermissions.mockResolvedValue({ location: 'granted', coarseLocation: 'granted' });
	getCurrentPosition.mockResolvedValue(fixAt(RAW.latitude, RAW.longitude));

	// the snapshot ref is module-scope, so it survives between cases
	await usePosition().clear();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('parsePositionSnapshot', () => {
	it('reads a well-formed record', () => {
		const parsed = parsePositionSnapshot(storedRecord());
		expect(parsed).not.toBeNull();
		expect(parsed?.manual).toBe(false);
	});

	/**
	 * The reason this validates rather than casts: a null latitude coerced to 0 is a real
	 * coordinate in the Gulf of Guinea, so every distance would be wrong by thousands of km while
	 * still looking like a number.
	 */
	it.each([
		['null', null],
		['a string', 'here'],
		['a missing latitude', { longitude: -87.6, fetched_at: 1 }],
		['a null latitude', storedRecord({ latitude: null })],
		['a null longitude', storedRecord({ longitude: null })],
		['a missing timestamp', storedRecord({ fetched_at: null })],
		['an out-of-range latitude', storedRecord({ latitude: 120 })],
		['an out-of-range longitude', storedRecord({ longitude: -400 })]
	])('rejects the whole record for %s', (_label, value) => {
		expect(parsePositionSnapshot(value)).toBeNull();
	});

	it('re-snaps on read, so a record from an older grid cannot survive unsnapped', () => {
		const parsed = parsePositionSnapshot(
			storedRecord({ latitude: 41.8819447, longitude: -87.6277781 })
		);
		expect(parsed).toEqual(expect.objectContaining(snapToGrid(41.8819447, -87.6277781)));
	});

	it('defaults manual to false rather than trusting a stray value', () => {
		expect(parsePositionSnapshot(storedRecord({ manual: 'yes' }))?.manual).toBe(false);
		expect(parsePositionSnapshot(storedRecord({ manual: true }))?.manual).toBe(true);
	});
});

describe('freshness', () => {
	const base = { latitude: 1, longitude: 2, accuracy: null, manual: false };

	it('is not fresh or usable when absent', () => {
		expect(isPositionFresh(null)).toBe(false);
		expect(isPositionUsable(null)).toBe(false);
	});

	it('is fresh inside the window and stale past it', () => {
		const now = 1_000_000_000_000;
		expect(isPositionFresh({ ...base, fetched_at: now - 1000 }, now)).toBe(true);
		expect(isPositionFresh({ ...base, fetched_at: now - POSITION_MAX_AGE_MS - 1 }, now)).toBe(
			false
		);
	});

	// the two windows are deliberately different; see POSITION_USABLE_AGE_MS
	it('stays usable well after it stops being fresh', () => {
		const now = 1_000_000_000_000;
		const yesterday = { ...base, fetched_at: now - POSITION_MAX_AGE_MS - 1 };
		expect(isPositionFresh(yesterday, now)).toBe(false);
		expect(isPositionUsable(yesterday, now)).toBe(true);
	});

	it('stops being usable past a week, so it cannot start lying about the hemisphere', () => {
		const now = 1_000_000_000_000;
		const ancient = { ...base, fetched_at: now - POSITION_USABLE_AGE_MS - 1 };
		expect(isPositionUsable(ancient, now)).toBe(false);
	});

	it('never expires a hand-pinned area, because the user asserted it', () => {
		const now = 1_000_000_000_000;
		const pinned = { ...base, manual: true, fetched_at: now - POSITION_USABLE_AGE_MS * 10 };
		expect(isPositionFresh(pinned, now)).toBe(true);
		expect(isPositionUsable(pinned, now)).toBe(true);
	});
});

describe('locate', () => {
	it('stores a snapped fix, never the raw one', async () => {
		const { locate } = usePosition();
		const result = await locate();

		expect(result).not.toBeNull();
		expect(result).toEqual(expect.objectContaining(snapToGrid(RAW.latitude, RAW.longitude)));
		// the raw coordinate must not survive anywhere in storage
		expect(store.get(POSITION_KEY)).not.toContain(String(RAW.latitude));
	});

	it('keeps the stored fix within one grid cell of the truth', async () => {
		const { locate } = usePosition();
		const result = await locate();
		expect(distanceMetres(result!, RAW)).toBeLessThan(GRID_METRES);
	});

	it('asks for a cached system fix rather than powering the radio', async () => {
		await usePosition().locate();
		expect(getCurrentPosition).toHaveBeenCalledWith(
			expect.objectContaining({ enableHighAccuracy: false, maximumAge: expect.any(Number) })
		);
		expect(getCurrentPosition.mock.calls[0]?.[0]?.maximumAge).toBeGreaterThan(0);
	});

	it('does not refetch while the cached fix is fresh', async () => {
		const { locate } = usePosition();
		await locate();
		await locate();
		expect(getCurrentPosition).toHaveBeenCalledTimes(1);
	});

	it('refetches when forced', async () => {
		const { locate } = usePosition();
		await locate();
		await locate({ force: true });
		expect(getCurrentPosition).toHaveBeenCalledTimes(2);
	});

	it('dedupes concurrent callers into one fix', async () => {
		const { locate } = usePosition();
		await Promise.all([locate(), locate(), locate()]);
		expect(getCurrentPosition).toHaveBeenCalledTimes(1);
	});

	it('requests permission only when it is not already granted', async () => {
		checkPermissions.mockResolvedValue({ location: 'granted', coarseLocation: 'granted' });
		await usePosition().locate();
		expect(requestPermissions).not.toHaveBeenCalled();
	});

	it('marks itself blocked and keeps the cache when permission is refused', async () => {
		seed(storedRecord({ fetched_at: Date.now() - POSITION_MAX_AGE_MS - 1 }));
		checkPermissions.mockResolvedValue({ location: 'denied', coarseLocation: 'denied' });
		requestPermissions.mockResolvedValue({ location: 'denied', coarseLocation: 'denied' });

		const position = usePosition();
		const result = await position.locate();

		expect(position.blocked.value).toBe(true);
		// the previous answer is better than nothing, so it survives a refusal
		expect(result).not.toBeNull();
		expect(getCurrentPosition).not.toHaveBeenCalled();
	});

	it('returns the cache rather than throwing when the fix errors', async () => {
		seed(storedRecord({ fetched_at: Date.now() - POSITION_MAX_AGE_MS - 1 }));
		getCurrentPosition.mockRejectedValue(new Error('no provider'));

		const result = await usePosition().locate();
		expect(result).not.toBeNull();
	});

	it('returns the cache when the fix resolves without usable coordinates', async () => {
		seed(storedRecord({ fetched_at: Date.now() - POSITION_MAX_AGE_MS - 1 }));
		getCurrentPosition.mockResolvedValue({ coords: { latitude: null, longitude: null } });

		const result = await usePosition().locate();
		expect(result?.latitude).not.toBeNull();
	});

	it('does not quietly replace a hand-pinned area', async () => {
		const position = usePosition();
		await position.setManual(51.5074, -0.1278);
		await position.locate();

		expect(getCurrentPosition).not.toHaveBeenCalled();
		expect(position.snapshot.value?.manual).toBe(true);
	});
});

describe('setManual', () => {
	it('snaps the pinned point like any other', async () => {
		const result = await usePosition().setManual(51.507351, -0.127758);
		expect(result).toEqual(expect.objectContaining(snapToGrid(51.507351, -0.127758)));
		expect(result.manual).toBe(true);
		expect(result.accuracy).toBeNull();
	});

	it('persists so a relaunch keeps the pin', async () => {
		await usePosition().setManual(51.5074, -0.1278);
		expect(store.has(POSITION_KEY)).toBe(true);
	});
});

describe('hydrate and clear', () => {
	it('reads a stored position without prompting', async () => {
		seed(storedRecord());
		const result = await usePosition().hydrate();

		expect(result).not.toBeNull();
		expect(checkPermissions).not.toHaveBeenCalled();
		expect(getCurrentPosition).not.toHaveBeenCalled();
	});

	it('returns null on a fresh install rather than inventing a coordinate', async () => {
		expect(await usePosition().hydrate()).toBeNull();
	});

	it('survives a corrupt stored value', async () => {
		store.set(POSITION_KEY, '{"latitude":');
		expect(await usePosition().hydrate()).toBeNull();
	});

	it('clear removes the record and the blocked flag', async () => {
		const position = usePosition();
		await position.setManual(1, 2);
		await position.clear();

		expect(position.snapshot.value).toBeNull();
		expect(store.has(POSITION_KEY)).toBe(false);
	});
});
