import { WEATHER_MAX_AGE_MS, type WeatherSnapshot } from '~/types/context';
import { WEATHER_CONDITIONS, type WeatherCondition } from '~/types/nudge';
import { openMeteoUrl, parseOpenMeteo } from '~/utils/weather';

export const WEATHER_KEY = 'recess.weather.v1';
const FETCH_TIMEOUT_MS = 8000;

/** refetching for a few hundred metres of movement is waste */
const COARSE_PRECISION = 2;

const snapshot = ref<WeatherSnapshot | null>(null);
const loading = ref(false);
let inFlight: Promise<WeatherSnapshot | null> | null = null;

function coarse(value: number): number {
	return Number(value.toFixed(COARSE_PRECISION));
}

export function isFresh(value: WeatherSnapshot | null, now = Date.now()): boolean {
	return value !== null && now - value.fetched_at <= WEATHER_MAX_AGE_MS;
}

function isCondition(value: unknown): value is WeatherCondition {
	return typeof value === 'string' && (WEATHER_CONDITIONS as readonly string[]).includes(value);
}

function finite(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Validate a stored snapshot instead of asserting its shape.
 *
 * There is no server to correct a bad read, so a field that survives as `null`
 * would be compared and formatted as 0 - reported as `cold`, rendered as a real
 * 0 C. Rejecting the whole snapshot means "weather unknown", which makes every
 * weather filter pass and costs one refetch.
 */
export function parseWeatherSnapshot(raw: unknown): WeatherSnapshot | null {
	if (!raw || typeof raw !== 'object') return null;
	const record = raw as Partial<Record<keyof WeatherSnapshot, unknown>>;

	const condition = record.condition;
	const code = finite(record.code);
	const temperature = finite(record.temperature_c);
	const wind = finite(record.wind_speed_kmh);
	const humidity = finite(record.humidity);
	const uv = finite(record.uv_index);
	const fetchedAt = finite(record.fetched_at);
	const latitude = finite(record.latitude);
	const longitude = finite(record.longitude);

	if (
		!isCondition(condition) ||
		typeof record.is_day !== 'boolean' ||
		code === null ||
		temperature === null ||
		wind === null ||
		humidity === null ||
		uv === null ||
		fetchedAt === null ||
		latitude === null ||
		longitude === null
	) {
		return null;
	}

	return {
		code,
		condition,
		temperature_c: temperature,
		wind_speed_kmh: wind,
		humidity,
		uv_index: uv,
		is_day: record.is_day,
		fetched_at: fetchedAt,
		latitude,
		longitude
	};
}

export function useWeather() {
	const { get, set } = useSettings();

	async function hydrate(): Promise<WeatherSnapshot | null> {
		if (snapshot.value) return snapshot.value;
		snapshot.value = parseWeatherSnapshot(await get<unknown>(WEATHER_KEY, null));
		return snapshot.value;
	}

	/**
	 * fetch only when the cache is stale, we are online, and coordinates are
	 * known. returns the cached value on any failure.
	 */
	async function refresh(
		latitude: number,
		longitude: number,
		options: { force?: boolean } = {}
	): Promise<WeatherSnapshot | null> {
		await hydrate();

		if (!options.force && isFresh(snapshot.value)) return snapshot.value;
		if (isOffline.value) return snapshot.value;
		if (inFlight) return inFlight;

		loading.value = true;
		inFlight = (async () => {
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

			try {
				const response = await fetch(openMeteoUrl(coarse(latitude), coarse(longitude)), {
					signal: controller.signal
				});
				if (!response.ok) return snapshot.value;

				const parsed = parseOpenMeteo(
					await response.json(),
					coarse(latitude),
					coarse(longitude),
					Date.now()
				);
				if (!parsed) return snapshot.value;

				snapshot.value = parsed;
				await set(WEATHER_KEY, parsed);
				return parsed;
			} catch {
				return snapshot.value;
			} finally {
				clearTimeout(timer);
				loading.value = false;
				inFlight = null;
			}
		})();

		return inFlight;
	}

	async function clear() {
		snapshot.value = null;
		const { remove } = useSettings();
		await remove(WEATHER_KEY);
	}

	return {
		snapshot: readonly(snapshot),
		loading: readonly(loading),
		fresh: computed(() => isFresh(snapshot.value)),
		hydrate,
		refresh,
		clear
	};
}
