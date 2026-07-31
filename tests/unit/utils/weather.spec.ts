import { describe, expect, it } from 'vitest';
import { WEATHER_CONDITIONS } from '~/types/nudge';
import {
	COLD_C,
	HOT_C,
	HUMID_PERCENT,
	UV_HIGH,
	WINDY_KMH,
	WMO_CONDITIONS,
	conditionForCode,
	matchesWeatherToken,
	openMeteoUrl,
	parseOpenMeteo,
	weatherTokensFor
} from '~/utils/weather';
import { weather } from '../helpers';

describe('WMO_CONDITIONS', () => {
	it('only maps to declared condition names', () => {
		for (const condition of Object.values(WMO_CONDITIONS)) {
			expect(WEATHER_CONDITIONS).toContain(condition);
		}
	});

	it('covers every code Open-Meteo reports', () => {
		const expected = [
			0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85,
			86, 95, 96, 99
		];
		expect(
			Object.keys(WMO_CONDITIONS)
				.map(Number)
				.sort((a, b) => a - b)
		).toEqual(expected);
	});
});

describe('conditionForCode', () => {
	it('maps exact codes', () => {
		expect(conditionForCode(0)).toBe('clear');
		expect(conditionForCode(2)).toBe('partly_cloudy');
		expect(conditionForCode(95)).toBe('thunderstorm');
		expect(conditionForCode(99)).toBe('thunderstorm_heavy_hail');
	});

	it('falls back to the nearest lower code in the same tens block', () => {
		// 62 is not reported, but it sits between light_rain (61) and rain (63)
		expect(conditionForCode(62)).toBe('light_rain');
	});

	it('does not cross a tens boundary when falling back', () => {
		expect(conditionForCode(60)).toBeUndefined();
	});

	it('returns undefined for codes with no family', () => {
		expect(conditionForCode(19)).toBeUndefined();
		expect(conditionForCode(200)).toBeUndefined();
	});

	it('returns undefined for non-numbers', () => {
		expect(conditionForCode(Number.NaN)).toBeUndefined();
	});
});

describe('matchesWeatherToken', () => {
	it('matches an exact condition', () => {
		expect(matchesWeatherToken(weather({ condition: 'rain' }), 'rain')).toBe(true);
		expect(matchesWeatherToken(weather({ condition: 'rain' }), 'snow')).toBe(false);
	});

	it('matches condition groups', () => {
		expect(matchesWeatherToken(weather({ condition: 'heavy_showers' }), 'any_rain')).toBe(true);
		expect(matchesWeatherToken(weather({ condition: 'snow_grains' }), 'any_snow')).toBe(true);
		expect(matchesWeatherToken(weather({ condition: 'mainly_clear' }), 'clear_ish')).toBe(true);
		expect(matchesWeatherToken(weather({ condition: 'rime_fog' }), 'foggy')).toBe(true);
	});

	it('puts every precipitation condition in any_precipitation', () => {
		for (const condition of ['drizzle', 'rain', 'snow', 'showers', 'thunderstorm'] as const) {
			expect(matchesWeatherToken(weather({ condition }), 'any_precipitation')).toBe(true);
		}
		expect(matchesWeatherToken(weather({ condition: 'clear' }), 'any_precipitation')).toBe(false);
	});

	it('treats freezing variants as both their family and any_freezing', () => {
		const snapshot = weather({ condition: 'freezing_rain' });
		expect(matchesWeatherToken(snapshot, 'any_freezing')).toBe(true);
		expect(matchesWeatherToken(snapshot, 'any_rain')).toBe(true);
	});

	it('groups all three hail/thunder codes under severe', () => {
		for (const condition of [
			'thunderstorm',
			'thunderstorm_hail',
			'thunderstorm_heavy_hail'
		] as const) {
			expect(matchesWeatherToken(weather({ condition }), 'severe')).toBe(true);
		}
	});

	it('resolves measured tokens from the numeric fields, not the code', () => {
		expect(matchesWeatherToken(weather({ temperature_c: HOT_C + 1 }), 'hot')).toBe(true);
		expect(matchesWeatherToken(weather({ temperature_c: HOT_C - 1 }), 'hot')).toBe(false);
		expect(matchesWeatherToken(weather({ temperature_c: COLD_C - 1 }), 'cold')).toBe(true);
		expect(matchesWeatherToken(weather({ wind_speed_kmh: WINDY_KMH }), 'windy')).toBe(true);
		expect(matchesWeatherToken(weather({ humidity: HUMID_PERCENT }), 'humid')).toBe(true);
		expect(matchesWeatherToken(weather({ uv_index: UV_HIGH }), 'uv_high')).toBe(true);
	});

	it('is false for an unrecognised token rather than throwing', () => {
		expect(matchesWeatherToken(weather(), 'tornado' as never)).toBe(false);
	});
});

describe('weatherTokensFor', () => {
	it('includes the condition, its groups and any measured tokens', () => {
		const tokens = weatherTokensFor(
			weather({ condition: 'heavy_rain', temperature_c: 30, wind_speed_kmh: 40 })
		);
		expect(tokens).toContain('heavy_rain');
		expect(tokens).toContain('any_rain');
		expect(tokens).toContain('any_precipitation');
		expect(tokens).toContain('hot');
		expect(tokens).toContain('windy');
	});

	it('does not repeat a token', () => {
		const tokens = weatherTokensFor(weather({ condition: 'showers' }));
		expect(new Set(tokens).size).toBe(tokens.length);
	});
});

describe('parseOpenMeteo', () => {
	const payload = {
		current: {
			weather_code: 63,
			temperature_2m: 12.5,
			wind_speed_10m: 18,
			relative_humidity_2m: 82,
			uv_index: 2,
			is_day: 1
		}
	};

	it('maps a well-formed response', () => {
		const snapshot = parseOpenMeteo(payload, 41.881, -87.632, 1000);
		expect(snapshot).toMatchObject({
			code: 63,
			condition: 'rain',
			temperature_c: 12.5,
			wind_speed_kmh: 18,
			humidity: 82,
			uv_index: 2,
			is_day: true,
			fetched_at: 1000
		});
	});

	it('returns null when the code is unmappable', () => {
		expect(parseOpenMeteo({ current: { weather_code: 19 } }, 0, 0, 0)).toBeNull();
	});

	it('returns null for a missing or malformed envelope', () => {
		expect(parseOpenMeteo(null, 0, 0, 0)).toBeNull();
		expect(parseOpenMeteo({}, 0, 0, 0)).toBeNull();
		expect(parseOpenMeteo({ current: 'nope' }, 0, 0, 0)).toBeNull();
		expect(parseOpenMeteo('nope', 0, 0, 0)).toBeNull();
	});

	it('substitutes defaults for absent numeric fields', () => {
		const snapshot = parseOpenMeteo({ current: { weather_code: 0 } }, 0, 0, 0);
		expect(snapshot).toMatchObject({
			temperature_c: 15,
			wind_speed_kmh: 0,
			humidity: 50,
			uv_index: 0
		});
	});

	it('treats an absent is_day as daytime', () => {
		expect(parseOpenMeteo({ current: { weather_code: 0 } }, 0, 0, 0)?.is_day).toBe(true);
		expect(parseOpenMeteo({ current: { weather_code: 0, is_day: 0 } }, 0, 0, 0)?.is_day).toBe(
			false
		);
	});
});

describe('openMeteoUrl', () => {
	it('requests exactly the fields the snapshot needs', () => {
		const url = openMeteoUrl(41.8812, -87.6321);
		expect(url).toContain('latitude=41.881');
		expect(url).toContain('longitude=-87.632');
		for (const field of [
			'weather_code',
			'temperature_2m',
			'wind_speed_10m',
			'relative_humidity_2m',
			'uv_index',
			'is_day'
		]) {
			expect(decodeURIComponent(url)).toContain(field);
		}
	});

	it('rounds coordinates to three places so small moves do not refetch', () => {
		expect(openMeteoUrl(41.88123456, -87.6)).toContain('latitude=41.881');
	});
});
