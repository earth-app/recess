import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WEATHER_MAX_AGE_MS, type WeatherSnapshot } from '~/types/context';

const store = new Map<string, string>();

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

import { networkOffline } from '~/composables/useNetwork';
import { formatTemperature } from '~/composables/useSettings';
import { isFresh, parseWeatherSnapshot, useWeather, WEATHER_KEY } from '~/composables/useWeather';
import { matchesWeatherToken, parseOpenMeteo } from '~/utils/weather';
import { weather } from '../helpers';

const OPEN_METEO_BODY = {
	current: {
		weather_code: 63,
		temperature_2m: 12.5,
		wind_speed_10m: 18,
		relative_humidity_2m: 82,
		uv_index: 2,
		is_day: 1
	}
};

function respondWith(body: unknown, ok = true) {
	const mock = vi.fn(
		async (_url: string) => ({ ok, json: async () => body }) as unknown as Response
	);
	vi.stubGlobal('fetch', mock);
	return mock;
}

function seed(value: unknown) {
	store.set(WEATHER_KEY, JSON.stringify(value));
}

/** a stored record with one field replaced by something storage could really hold */
function weatherWith(overrides: Record<string, unknown>): Record<string, unknown> {
	return { ...weather(), ...overrides };
}

/** valid, but older than WEATHER_MAX_AGE_MS */
function stale(): WeatherSnapshot {
	return weather({ condition: 'overcast', fetched_at: Date.now() - WEATHER_MAX_AGE_MS - 1000 });
}

beforeEach(async () => {
	store.clear();
	networkOffline.value = false;
	// useSettings' cache is module-scope, and so is the weather snapshot itself, so a
	// value adopted in one case would otherwise still be there for the next
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

	await useWeather().clear();
	prefsGet.mockClear();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

/**
 * The storage read is the one weather path with no server behind it. A snapshot
 * whose shape was merely asserted rather than validated flows straight into the
 * filters and the UI, where a missing number reads as a real measurement.
 */
describe('parseWeatherSnapshot', () => {
	it('accepts a well-formed snapshot unchanged', () => {
		const snapshot = weather();
		expect(parseWeatherSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot);
	});

	/** the write path must never produce something the read path throws away */
	it('accepts everything parseOpenMeteo produces', () => {
		const fetched = parseOpenMeteo(OPEN_METEO_BODY, 41.88, -87.63, 1000);
		expect(parseWeatherSnapshot(JSON.parse(JSON.stringify(fetched)))).toEqual(fetched);
	});

	it('rejects anything that is not a record', () => {
		for (const bad of [null, undefined, 'clear', 42, []]) {
			expect(parseWeatherSnapshot(bad), String(bad)).toBeNull();
		}
	});

	it('rejects a condition that is not a declared WeatherCondition', () => {
		// tornado is a WMO code Open-Meteo never emits, so it is not one of ours
		for (const condition of ['tornado', 'Clear', '', 42, null, undefined]) {
			expect(parseWeatherSnapshot(weatherWith({ condition })), String(condition)).toBeNull();
		}
	});

	it.each([
		'code',
		'temperature_c',
		'wind_speed_kmh',
		'humidity',
		'uv_index',
		'fetched_at',
		'latitude',
		'longitude'
	])('rejects a %s that is not a finite number', (field) => {
		for (const bad of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY, '18']) {
			expect(parseWeatherSnapshot(weatherWith({ [field]: bad })), `${field}=${bad}`).toBeNull();
		}
	});

	it('rejects a non-boolean is_day', () => {
		for (const bad of [1, 0, 'true', null]) {
			expect(parseWeatherSnapshot(weatherWith({ is_day: bad })), String(bad)).toBeNull();
		}
	});
});

describe('useWeather.hydrate', () => {
	it('adopts a stored snapshot', async () => {
		const snapshot = weather({ condition: 'showers', fetched_at: Date.now() });
		seed(snapshot);

		const { hydrate, fresh, loading } = useWeather();
		expect(await hydrate()).toEqual(snapshot);
		expect(fresh.value).toBe(true);
		expect(loading.value).toBe(false);
	});

	it('reports a stale snapshot as adopted but not fresh', async () => {
		seed(stale());

		const { hydrate, fresh } = useWeather();
		expect(await hydrate()).not.toBeNull();
		expect(fresh.value).toBe(false);
	});

	/**
	 * The old guard checked two of ten fields, and `condition` only as a string. A
	 * `temperature_c: null` walked through it and was then compared as 0 - reported as
	 * `cold`, and rendered as a real 0 C / 32 F reading.
	 */
	it('rejects a snapshot that passes a fetched_at + condition check but has a null field', async () => {
		seed({ ...weather(), temperature_c: null });

		const { hydrate, snapshot } = useWeather();
		expect(await hydrate()).toBeNull();
		expect(snapshot.value).toBeNull();

		// what the surviving null would have produced downstream
		const nulled = { ...weather(), temperature_c: null as unknown as number };
		expect(formatTemperature(nulled.temperature_c, 'metric')).toBe('0°C');
		expect(formatTemperature(nulled.temperature_c, 'imperial')).toBe('32°F');
		expect(matchesWeatherToken(nulled, 'cold')).toBe(true);
	});

	it('rejects a condition string that is not a real condition', async () => {
		seed({ ...weather(), condition: 'tornado' });
		expect(await useWeather().hydrate()).toBeNull();
	});

	it('returns null when nothing is stored', async () => {
		expect(await useWeather().hydrate()).toBeNull();
	});

	it('reads storage once and keeps the adopted snapshot', async () => {
		seed(weather());

		const { hydrate } = useWeather();
		const first = await hydrate();
		const calls = prefsGet.mock.calls.length;

		expect(await hydrate()).toBe(first);
		expect(prefsGet.mock.calls.length).toBe(calls);
	});
});

describe('isFresh', () => {
	it('is false without a snapshot', () => {
		expect(isFresh(null)).toBe(false);
	});

	it('holds right up to the max age and not past it', () => {
		const snapshot = weather({ fetched_at: 1_000_000 });
		expect(isFresh(snapshot, 1_000_000 + WEATHER_MAX_AGE_MS)).toBe(true);
		expect(isFresh(snapshot, 1_000_000 + WEATHER_MAX_AGE_MS + 1)).toBe(false);
	});
});

describe('useWeather.refresh', () => {
	it('fetches, adopts and stores a snapshot its own parser accepts', async () => {
		respondWith(OPEN_METEO_BODY);

		const result = await useWeather().refresh(41.881_234, -87.632_1);

		expect(result).toMatchObject({ condition: 'rain', temperature_c: 12.5, humidity: 82 });
		expect(parseWeatherSnapshot(JSON.parse(String(store.get(WEATHER_KEY))))).toEqual(result);
	});

	it('coarsens the coordinates so a few hundred metres does not refetch', async () => {
		const fetchMock = respondWith(OPEN_METEO_BODY);

		await useWeather().refresh(41.881_234, -87.632_1);

		expect(String(fetchMock.mock.calls[0]?.[0])).toContain('latitude=41.880');
		expect(String(fetchMock.mock.calls[0]?.[0])).toContain('longitude=-87.630');
	});

	it('keeps the cached snapshot when the response is not ok', async () => {
		seed(stale());
		respondWith({ error: true }, false);

		expect(await useWeather().refresh(1, 2)).toMatchObject({ condition: 'overcast' });
	});

	it('keeps the cached snapshot when the body is unusable', async () => {
		seed(stale());
		respondWith({ current: { weather_code: 19 } });

		expect(await useWeather().refresh(1, 2)).toMatchObject({ condition: 'overcast' });
	});

	it('keeps the cached snapshot rather than throwing when the network is gone', async () => {
		seed(stale());
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new Error('offline');
			})
		);

		expect(await useWeather().refresh(1, 2)).toMatchObject({ condition: 'overcast' });
	});

	it('does not fetch while offline', async () => {
		seed(stale());
		const fetchMock = respondWith(OPEN_METEO_BODY);
		networkOffline.value = true;

		expect(await useWeather().refresh(1, 2)).toMatchObject({ condition: 'overcast' });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('does not fetch while the cache is fresh, unless forced', async () => {
		seed(weather({ condition: 'clear', fetched_at: Date.now() }));
		const fetchMock = respondWith(OPEN_METEO_BODY);

		const { refresh } = useWeather();
		expect(await refresh(1, 2)).toMatchObject({ condition: 'clear' });
		expect(fetchMock).not.toHaveBeenCalled();

		expect(await refresh(1, 2, { force: true })).toMatchObject({ condition: 'rain' });
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('shares one request between concurrent callers', async () => {
		const fetchMock = respondWith(OPEN_METEO_BODY);

		const { refresh } = useWeather();
		const first = refresh(1, 2);
		const second = refresh(1, 2);

		expect(await first).toBe(await second);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('leaves nothing in storage when there was nothing to store', async () => {
		respondWith({ current: { weather_code: 19 } });

		expect(await useWeather().refresh(1, 2)).toBeNull();
		expect(store.has(WEATHER_KEY)).toBe(false);
	});
});

describe('useWeather.clear', () => {
	it('drops the snapshot and the stored key', async () => {
		seed(weather());

		const { hydrate, clear, snapshot } = useWeather();
		await hydrate();
		await clear();

		expect(snapshot.value).toBeNull();
		expect(store.has(WEATHER_KEY)).toBe(false);
	});
});
