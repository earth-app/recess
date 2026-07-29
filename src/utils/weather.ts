import type { WeatherSnapshot } from '~/types/context';
import {
	type WeatherCondition,
	type WeatherGroup,
	type WeatherToken,
	WEATHER_CONDITIONS,
	WEATHER_GROUPS
} from '~/types/nudge';

// #region wmo codes

export const WMO_CONDITIONS: Record<number, WeatherCondition> = {
	0: 'clear',
	1: 'mainly_clear',
	2: 'partly_cloudy',
	3: 'overcast',
	45: 'fog',
	48: 'rime_fog',
	51: 'light_drizzle',
	53: 'drizzle',
	55: 'heavy_drizzle',
	56: 'light_freezing_drizzle',
	57: 'freezing_drizzle',
	61: 'light_rain',
	63: 'rain',
	65: 'heavy_rain',
	66: 'light_freezing_rain',
	67: 'freezing_rain',
	71: 'light_snow',
	73: 'snow',
	75: 'heavy_snow',
	77: 'snow_grains',
	80: 'light_showers',
	81: 'showers',
	82: 'heavy_showers',
	85: 'light_snow_showers',
	86: 'snow_showers',
	95: 'thunderstorm',
	96: 'thunderstorm_hail',
	99: 'thunderstorm_heavy_hail'
};

/**
 * an unmapped code still needs a name. WMO orders codes by severity within each
 * family, so falling back to the nearest lower mapped code in the same tens
 * block is a better guess than dropping the reading entirely.
 */
export function conditionForCode(code: number): WeatherCondition | undefined {
	if (!Number.isFinite(code)) return undefined;
	const exact = WMO_CONDITIONS[code];
	if (exact) return exact;

	const block = Math.floor(code / 10) * 10;
	for (let candidate = code - 1; candidate >= block; candidate--) {
		const near = WMO_CONDITIONS[candidate];
		if (near) return near;
	}
	return undefined;
}

// #endregion

// #region groups

const CONDITION_GROUPS = {
	clear_ish: ['clear', 'mainly_clear'],
	cloudy_ish: ['partly_cloudy', 'overcast'],
	foggy: ['fog', 'rime_fog'],
	any_drizzle: [
		'light_drizzle',
		'drizzle',
		'heavy_drizzle',
		'light_freezing_drizzle',
		'freezing_drizzle'
	],
	any_rain: [
		'light_rain',
		'rain',
		'heavy_rain',
		'light_freezing_rain',
		'freezing_rain',
		'light_showers',
		'showers',
		'heavy_showers'
	],
	any_snow: [
		'light_snow',
		'snow',
		'heavy_snow',
		'snow_grains',
		'light_snow_showers',
		'snow_showers'
	],
	any_showers: ['light_showers', 'showers', 'heavy_showers', 'light_snow_showers', 'snow_showers'],
	any_freezing: [
		'light_freezing_drizzle',
		'freezing_drizzle',
		'light_freezing_rain',
		'freezing_rain'
	],
	any_precipitation: [
		'light_drizzle',
		'drizzle',
		'heavy_drizzle',
		'light_freezing_drizzle',
		'freezing_drizzle',
		'light_rain',
		'rain',
		'heavy_rain',
		'light_freezing_rain',
		'freezing_rain',
		'light_snow',
		'snow',
		'heavy_snow',
		'snow_grains',
		'light_showers',
		'showers',
		'heavy_showers',
		'light_snow_showers',
		'snow_showers',
		'thunderstorm',
		'thunderstorm_hail',
		'thunderstorm_heavy_hail'
	],
	any_thunderstorm: ['thunderstorm', 'thunderstorm_hail', 'thunderstorm_heavy_hail'],
	severe: ['thunderstorm', 'thunderstorm_hail', 'thunderstorm_heavy_hail']
} satisfies Partial<Record<WeatherGroup, readonly WeatherCondition[]>>;

export const HOT_C = 27;
export const COLD_C = 4;
export const WINDY_KMH = 30;
export const HUMID_PERCENT = 80;
export const UV_HIGH = 6;

// the groups no weather code can express; resolved from the snapshot's other fields
const MEASURED = {
	hot: (s: WeatherSnapshot) => s.temperature_c >= HOT_C,
	cold: (s: WeatherSnapshot) => s.temperature_c <= COLD_C,
	windy: (s: WeatherSnapshot) => s.wind_speed_kmh >= WINDY_KMH,
	humid: (s: WeatherSnapshot) => s.humidity >= HUMID_PERCENT,
	uv_high: (s: WeatherSnapshot) => s.uv_index >= UV_HIGH
} satisfies Partial<Record<WeatherGroup, (snapshot: WeatherSnapshot) => boolean>>;

type GroupRule = readonly WeatherCondition[] | ((snapshot: WeatherSnapshot) => boolean);

/**
 * every group resolves through exactly one of the two tables above; a new
 * WeatherGroup that reaches neither stops this from compiling
 */
const GROUP_RULES = { ...CONDITION_GROUPS, ...MEASURED } satisfies Record<WeatherGroup, GroupRule>;

/** does this snapshot satisfy one authored weather token */
export function matchesWeatherToken(snapshot: WeatherSnapshot, token: WeatherToken): boolean {
	if ((WEATHER_CONDITIONS as readonly string[]).includes(token)) {
		return snapshot.condition === token;
	}

	const rule: GroupRule | undefined = GROUP_RULES[token as WeatherGroup];
	if (typeof rule === 'function') return rule(snapshot);
	// an unrecognised token reaches neither table, so it describes nothing
	return rule ? rule.includes(snapshot.condition) : false;
}

/** every token that currently describes the snapshot; useful for UI and debugging */
export function weatherTokensFor(snapshot: WeatherSnapshot): WeatherToken[] {
	const tokens: WeatherToken[] = [snapshot.condition];
	for (const group of WEATHER_GROUPS) {
		if (matchesWeatherToken(snapshot, group)) tokens.push(group);
	}
	return [...new Set(tokens)];
}

// #endregion

// #region open-meteo

export const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';

interface OpenMeteoCurrent {
	weather_code?: number;
	temperature_2m?: number;
	wind_speed_10m?: number;
	relative_humidity_2m?: number;
	uv_index?: number;
	is_day?: number;
}

/**
 * parse a forecast response into a snapshot. returns null rather than throwing
 * on any shape surprise, because a missing snapshot simply makes weather
 * filters pass.
 */
export function parseOpenMeteo(
	payload: unknown,
	latitude: number,
	longitude: number,
	now: number
): WeatherSnapshot | null {
	if (!payload || typeof payload !== 'object') return null;
	const current = (payload as { current?: OpenMeteoCurrent }).current;
	if (!current || typeof current !== 'object') return null;

	const condition = conditionForCode(Number(current.weather_code));
	if (!condition) return null;

	const num = (value: unknown, fallback: number) =>
		typeof value === 'number' && Number.isFinite(value) ? value : fallback;

	return {
		code: Number(current.weather_code),
		condition,
		temperature_c: num(current.temperature_2m, 15),
		wind_speed_kmh: num(current.wind_speed_10m, 0),
		humidity: num(current.relative_humidity_2m, 50),
		uv_index: num(current.uv_index, 0),
		is_day: current.is_day === undefined ? true : current.is_day === 1,
		fetched_at: now,
		latitude,
		longitude
	};
}

export function openMeteoUrl(latitude: number, longitude: number): string {
	const params = new URLSearchParams({
		latitude: latitude.toFixed(3),
		longitude: longitude.toFixed(3),
		current: 'weather_code,temperature_2m,wind_speed_10m,relative_humidity_2m,uv_index,is_day',
		timezone: 'auto'
	});
	return `${OPEN_METEO_URL}?${params}`;
}

// #endregion
