import { describe, expect, it } from 'vitest';
import { WEATHER_MAX_AGE_MS } from '~/types/context';
import type { NudgeFilter } from '~/types/nudge';
import { ENUM_FILTER_TYPES, NUMERIC_FILTER_TYPES, nudgeFilterSchema } from '~/types/nudge';
import {
	evaluateFilter,
	evaluateFilters,
	partitionByFilters,
	passesFilters
} from '~/utils/filters';
import { FIXED_NOW, ctx, think, weather } from '../helpers';

const run = (filter: NudgeFilter, overrides = {}, subjectId?: string) =>
	evaluateFilter(filter, ctx(overrides), subjectId);

describe('numeric comparisons', () => {
	it('applies each operator', () => {
		expect(run({ type: 'hour', value: { equals: 14 } }).passed).toBe(true);
		expect(run({ type: 'hour', value: { equals: 15 } }).passed).toBe(false);
		expect(run({ type: 'hour', value: { greater_than: 13 } }).passed).toBe(true);
		expect(run({ type: 'hour', value: { greater_than: 14 } }).passed).toBe(false);
		expect(run({ type: 'hour', value: { greater_than_or_eq: 14 } }).passed).toBe(true);
		expect(run({ type: 'hour', value: { less_than: 15 } }).passed).toBe(true);
		expect(run({ type: 'hour', value: { less_than: 14 } }).passed).toBe(false);
		expect(run({ type: 'hour', value: { less_than_or_eq: 14 } }).passed).toBe(true);
	});

	it('treats between as inclusive', () => {
		expect(run({ type: 'hour', value: { between: [14, 18] } }).passed).toBe(true);
		expect(run({ type: 'hour', value: { between: [10, 14] } }).passed).toBe(true);
		expect(run({ type: 'hour', value: { between: [15, 18] } }).passed).toBe(false);
	});

	it('normalizes a reversed between range', () => {
		expect(run({ type: 'hour', value: { between: [18, 10] } }).passed).toBe(true);
	});

	it('ANDs several operators in one value', () => {
		expect(run({ type: 'hour', value: { greater_than_or_eq: 6, less_than: 20 } }).passed).toBe(
			true
		);
		expect(run({ type: 'hour', value: { greater_than_or_eq: 6, less_than: 12 } }).passed).toBe(
			false
		);
	});

	it('passes as indeterminate when the value is unknown', () => {
		const result = run({ type: 'daylight_remaining', value: { greater_than: 30 } });
		expect(result.passed).toBe(true);
		expect(result.indeterminate).toBe(true);
	});

	it('reads a never-completed nudge as infinitely long ago', () => {
		const result = run(
			{ type: 'days_since_completed', value: { greater_than_or_eq: 21 } },
			{},
			'nature.think.example'
		);
		expect(result.passed).toBe(true);
		expect(result.indeterminate).toBe(false);
	});

	it('blocks a nudge still inside its cooldown', () => {
		const twoDaysAgo = FIXED_NOW.getTime() - 2 * 86_400_000;
		const result = run(
			{ type: 'days_since_completed', value: { greater_than_or_eq: 21 } },
			{ completions: { 'nature.think.example': twoDaysAgo } },
			'nature.think.example'
		);
		expect(result.passed).toBe(false);
	});

	it('is indeterminate without a subject id', () => {
		expect(
			run({ type: 'days_since_completed', value: { greater_than_or_eq: 1 } }).indeterminate
		).toBe(true);
	});
});

describe('enum comparisons', () => {
	it('matches is and is_not on a single token', () => {
		expect(run({ type: 'time_of_day', value: { is: ['day'] } }).passed).toBe(true);
		expect(run({ type: 'time_of_day', value: { is: ['night'] } }).passed).toBe(false);
		expect(run({ type: 'time_of_day', value: { is_not: ['night'] } }).passed).toBe(true);
		expect(run({ type: 'time_of_day', value: { is_not: ['day'] } }).passed).toBe(false);
	});

	it('ANDs is with is_not', () => {
		expect(
			run({ type: 'season', value: { is: ['summer', 'spring'], is_not: ['spring'] } }).passed
		).toBe(true);
	});

	it('matches a weekday token or its group', () => {
		// FIXED_NOW is a monday
		expect(run({ type: 'weekday', value: { is: ['mon'] } }).passed).toBe(true);
		expect(run({ type: 'weekday', value: { is: ['weekday'] } }).passed).toBe(true);
		expect(run({ type: 'weekday', value: { is: ['weekend'] } }).passed).toBe(false);
		expect(run({ type: 'weekday', value: { is_not: ['weekday'] } }).passed).toBe(false);
	});

	it('lets a region locale satisfy a base-language filter', () => {
		expect(run({ type: 'locale', value: { is: ['es'] } }, { locale: 'es-MX' }).passed).toBe(true);
		expect(run({ type: 'locale', value: { is: ['en'] } }, { locale: 'es-MX' }).passed).toBe(false);
	});
});

describe('set comparisons', () => {
	it('requires every listed permission to be granted', () => {
		expect(
			run({ type: 'permission', value: { is: ['camera'] } }, { granted_permissions: ['camera'] })
				.passed
		).toBe(true);
		expect(
			run(
				{ type: 'permission', value: { is: ['camera', 'location'] } },
				{ granted_permissions: ['camera'] }
			).passed
		).toBe(false);
	});

	it('requires every listed pack to be installed', () => {
		expect(
			run({ type: 'model_pack', value: { is: ['vision'] } }, { installed_packs: ['vision'] }).passed
		).toBe(true);
		expect(run({ type: 'model_pack', value: { is: ['vision'] } }).passed).toBe(false);
	});

	it('treats completed as a prerequisite list', () => {
		const completions = { 'people.task.a': 1, 'people.task.b': 2 };
		expect(
			run({ type: 'completed', value: { is: ['people.task.a'] } }, { completions }).passed
		).toBe(true);
		expect(
			run({ type: 'completed', value: { is: ['people.task.a', 'people.task.z'] } }, { completions })
				.passed
		).toBe(false);
		expect(
			run({ type: 'completed', value: { is_not: ['people.task.a'] } }, { completions }).passed
		).toBe(false);
	});
});

describe('weather filters', () => {
	it('matches a condition and a group', () => {
		const rainy = { weather: weather({ condition: 'heavy_rain' }) };
		expect(run({ type: 'weather', value: { is: ['any_rain'] } }, rainy).passed).toBe(true);
		expect(run({ type: 'weather', value: { is_not: ['any_precipitation'] } }, rainy).passed).toBe(
			false
		);
	});

	it('is indeterminate with no snapshot, and therefore passes', () => {
		const result = run({ type: 'weather', value: { is_not: ['any_rain'] } });
		expect(result.passed).toBe(true);
		expect(result.indeterminate).toBe(true);
	});

	it('ignores a stale snapshot', () => {
		const stale = {
			weather: weather({
				condition: 'heavy_rain',
				fetched_at: FIXED_NOW.getTime() - WEATHER_MAX_AGE_MS - 1000
			})
		};
		const result = run({ type: 'weather', value: { is_not: ['any_rain'] } }, stale);
		expect(result.indeterminate).toBe(true);
		expect(result.passed).toBe(true);
	});

	it('honours a snapshot right at the freshness boundary', () => {
		const edge = {
			weather: weather({
				condition: 'heavy_rain',
				fetched_at: FIXED_NOW.getTime() - WEATHER_MAX_AGE_MS
			})
		};
		expect(run({ type: 'weather', value: { is_not: ['any_rain'] } }, edge).passed).toBe(false);
	});

	it('converts temperature to the requested unit', () => {
		const warm = { weather: weather({ temperature_c: 25 }) };
		expect(run({ type: 'temperature', value: { greater_than: 24, unit: 'c' } }, warm).passed).toBe(
			true
		);
		// 25C is 77F, so a 78F floor must fail
		expect(run({ type: 'temperature', value: { greater_than: 78, unit: 'f' } }, warm).passed).toBe(
			false
		);
		expect(run({ type: 'temperature', value: { greater_than: 70, unit: 'f' } }, warm).passed).toBe(
			true
		);
	});

	it('reads wind, humidity and uv from the snapshot', () => {
		const gusty = { weather: weather({ wind_speed_kmh: 42, humidity: 91, uv_index: 8 }) };
		expect(run({ type: 'wind_speed', value: { greater_than: 40 } }, gusty).passed).toBe(true);
		expect(run({ type: 'humidity', value: { greater_than: 90 } }, gusty).passed).toBe(true);
		expect(run({ type: 'uv_index', value: { less_than: 5 } }, gusty).passed).toBe(false);
	});

	it('is indeterminate for measured filters with no snapshot', () => {
		for (const type of ['temperature', 'wind_speed', 'humidity', 'uv_index'] as const) {
			const filter = { type, value: { greater_than: 1 } } as NudgeFilter;
			expect(evaluateFilter(filter, ctx()).indeterminate).toBe(true);
		}
	});
});

describe('evaluateFilters', () => {
	it('passes an empty filter list', () => {
		expect(evaluateFilters([], ctx()).passed).toBe(true);
	});

	it('stops at the first definite mismatch and names it', () => {
		const result = evaluateFilters(
			[
				{ type: 'hour', value: { greater_than_or_eq: 6 } },
				{ type: 'time_of_day', value: { is: ['night'] } },
				{ type: 'season', value: { is: ['winter'] } }
			],
			ctx()
		);
		expect(result.passed).toBe(false);
		expect(result.blockedBy?.type).toBe('time_of_day');
	});

	it('collects the indeterminate types it passed through', () => {
		const result = evaluateFilters(
			[
				{ type: 'weather', value: { is: ['clear'] } },
				{ type: 'hour', value: { less_than: 20 } }
			],
			ctx()
		);
		expect(result.passed).toBe(true);
		expect(result.indeterminate).toEqual(['weather']);
	});
});

describe('passesFilters and partitionByFilters', () => {
	it('reads the filters off the nudge and uses its id as the subject', () => {
		const nudge = think({
			filters: [{ type: 'days_since_completed', value: { greater_than_or_eq: 30 } }]
		});
		expect(passesFilters(nudge, ctx())).toBe(true);

		const recent = ctx({ completions: { [nudge.id]: FIXED_NOW.getTime() - 86_400_000 } });
		expect(passesFilters(nudge, recent)).toBe(false);
	});

	it('splits a pool and keeps the blocking reason', () => {
		const open = think({ id: 'nature.think.open', slug: 'open' });
		const shut = think({
			id: 'nature.think.shut',
			slug: 'shut',
			filters: [{ type: 'time_of_day', value: { is: ['night'] } }]
		});

		const { eligible, blocked } = partitionByFilters([open, shut], ctx());
		expect(eligible.map((n) => n.id)).toEqual(['nature.think.open']);
		expect(blocked).toHaveLength(1);
		expect(blocked[0]?.result.blockedBy?.type).toBe('time_of_day');
	});
});

describe('filter schema', () => {
	it('accepts every declared filter type', () => {
		for (const type of ENUM_FILTER_TYPES) {
			const value =
				type === 'locale' || type === 'completed' ? { is: ['en'] } : { is: sampleEnum(type) };
			const parsed = nudgeFilterSchema.safeParse({ type, value });
			expect(parsed.success, `${type} should parse`).toBe(true);
		}

		for (const type of NUMERIC_FILTER_TYPES) {
			const parsed = nudgeFilterSchema.safeParse({ type, value: { greater_than: 1 } });
			expect(parsed.success, `${type} should parse`).toBe(true);
		}
	});

	it('rejects an enum filter with neither is nor is_not', () => {
		expect(nudgeFilterSchema.safeParse({ type: 'time_of_day', value: {} }).success).toBe(false);
	});

	it('rejects a numeric filter with no comparison', () => {
		expect(nudgeFilterSchema.safeParse({ type: 'hour', value: {} }).success).toBe(false);
	});

	it('rejects an unknown filter type', () => {
		expect(nudgeFilterSchema.safeParse({ type: 'tornado', value: { is: ['yes'] } }).success).toBe(
			false
		);
	});

	it('rejects an unknown enum member', () => {
		expect(
			nudgeFilterSchema.safeParse({ type: 'time_of_day', value: { is: ['teatime'] } }).success
		).toBe(false);
	});

	it('defaults the temperature unit to celsius', () => {
		const parsed = nudgeFilterSchema.parse({ type: 'temperature', value: { greater_than: 20 } });
		expect(parsed.value).toMatchObject({ unit: 'c' });
	});
});

function sampleEnum(type: string): string[] {
	switch (type) {
		case 'time_of_day':
			return ['day'];
		case 'season':
			return ['summer'];
		case 'weekday':
			return ['mon'];
		case 'weather':
			return ['clear'];
		case 'moon_phase':
			return ['full'];
		case 'permission':
			return ['camera'];
		case 'model_pack':
			return ['vision'];
		case 'nearby':
			return ['sit'];
		default:
			return ['en'];
	}
}

describe('nearby', () => {
	/**
	 * The fail-open contract, stated as a test.
	 *
	 * No area pack or no position leaves `reachable_affordances` undefined, and an undefined
	 * context value has to read as "unanswerable" rather than "nothing nearby". A user who never
	 * opened Out There must never have a nudge withheld because of it.
	 */
	it('passes and reports indeterminate when nothing is known', () => {
		const result = run({ type: 'nearby', value: { is: ['sit'] } });
		expect(result.passed).toBe(true);
		expect(result.indeterminate).toBe(true);
	});

	it('passes on a definite match', () => {
		const result = run(
			{ type: 'nearby', value: { is: ['sit'] } },
			{ reachable_affordances: ['sit', 'green'] }
		);
		expect(result.passed).toBe(true);
		expect(result.indeterminate).toBe(false);
	});

	it('blocks definitely when the pack is loaded and holds nothing that fits', () => {
		const result = run(
			{ type: 'nearby', value: { is: ['water'] } },
			{ reachable_affordances: ['sit'] }
		);
		expect(result.passed).toBe(false);
		expect(result.indeterminate).toBe(false);
	});

	// AND, matching permission and model_pack rather than the enum filters
	it('requires every listed affordance, not any of them', () => {
		expect(
			run(
				{ type: 'nearby', value: { is: ['sit', 'quiet'] } },
				{ reachable_affordances: ['sit', 'quiet', 'green'] }
			).passed
		).toBe(true);
		expect(
			run({ type: 'nearby', value: { is: ['sit', 'quiet'] } }, { reachable_affordances: ['sit'] })
				.passed
		).toBe(false);
	});

	it('supports is_not for a nudge that wants you away from something', () => {
		expect(
			run(
				{ type: 'nearby', value: { is_not: ['people'] } },
				{ reachable_affordances: ['green', 'quiet'] }
			).passed
		).toBe(true);
		expect(
			run(
				{ type: 'nearby', value: { is_not: ['people'] } },
				{ reachable_affordances: ['green', 'people'] }
			).passed
		).toBe(false);
	});

	// an empty pack is a real answer, not a missing one
	it('blocks when the pack loaded but reached nothing at all', () => {
		expect(
			run({ type: 'nearby', value: { is: ['sit'] } }, { reachable_affordances: [] }).passed
		).toBe(false);
	});
});
