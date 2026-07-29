import { WEATHER_MAX_AGE_MS, type NudgeContext } from '~/types/context';
import type { Nudge, NudgeFilter, WeatherToken } from '~/types/nudge';
import { dayKey, daysBetween, isWeekend, weekdayTokenFor } from '~/utils/day';
import { matchesWeatherToken } from '~/utils/weather';

export interface FilterResult {
	passed: boolean;
	/** true when the context could not answer the question, which counts as a pass */
	indeterminate: boolean;
	reason?: string;
}

const PASS: FilterResult = { passed: true, indeterminate: false };
const UNKNOWN: FilterResult = { passed: true, indeterminate: true };

const block = (reason: string): FilterResult => ({ passed: false, indeterminate: false, reason });

// #region primitives

interface Comparison {
	equals?: number;
	greater_than?: number;
	greater_than_or_eq?: number;
	less_than?: number;
	less_than_or_eq?: number;
	between?: [number, number];
}

/** every supplied comparison must hold; an unknown actual value passes */
function compareNumber(actual: number | undefined, spec: Comparison): FilterResult {
	if (actual === undefined || !Number.isFinite(actual)) return UNKNOWN;

	if (spec.equals !== undefined && actual !== spec.equals) {
		return block(`${actual} != ${spec.equals}`);
	}
	if (spec.greater_than !== undefined && !(actual > spec.greater_than)) {
		return block(`${actual} <= ${spec.greater_than}`);
	}
	if (spec.greater_than_or_eq !== undefined && !(actual >= spec.greater_than_or_eq)) {
		return block(`${actual} < ${spec.greater_than_or_eq}`);
	}
	if (spec.less_than !== undefined && !(actual < spec.less_than)) {
		return block(`${actual} >= ${spec.less_than}`);
	}
	if (spec.less_than_or_eq !== undefined && !(actual <= spec.less_than_or_eq)) {
		return block(`${actual} > ${spec.less_than_or_eq}`);
	}
	if (spec.between !== undefined) {
		const [low, high] = spec.between;
		const min = Math.min(low, high);
		const max = Math.max(low, high);
		if (actual < min || actual > max) return block(`${actual} outside [${min}, ${max}]`);
	}

	return PASS;
}

/** the actual value is a single token: `is` means one of, `is_not` means none of */
function compareToken(
	actual: string | undefined,
	spec: { is?: readonly string[]; is_not?: readonly string[] }
): FilterResult {
	if (actual === undefined) return UNKNOWN;
	if (spec.is && !spec.is.includes(actual))
		return block(`${actual} not in [${spec.is.join(', ')}]`);
	if (spec.is_not && spec.is_not.includes(actual)) return block(`${actual} excluded`);
	return PASS;
}

/**
 * the actual value is a set: `is` requires EVERY listed token to be present
 * (a prerequisite list), `is_not` requires none of them.
 */
function compareSet(
	actual: readonly string[] | undefined,
	spec: { is?: readonly string[]; is_not?: readonly string[] }
): FilterResult {
	if (actual === undefined) return UNKNOWN;

	if (spec.is) {
		const missing = spec.is.filter((token) => !actual.includes(token));
		if (missing.length > 0) return block(`missing ${missing.join(', ')}`);
	}
	if (spec.is_not) {
		const present = spec.is_not.filter((token) => actual.includes(token));
		if (present.length > 0) return block(`has ${present.join(', ')}`);
	}

	return PASS;
}

function freshWeather(ctx: NudgeContext) {
	const snapshot = ctx.weather;
	if (!snapshot) return undefined;
	return ctx.now.getTime() - snapshot.fetched_at <= WEATHER_MAX_AGE_MS ? snapshot : undefined;
}

// #endregion

// #region evaluation

/**
 * `subjectId` is the nudge the filter belongs to; only `days_since_completed`
 * needs it, since that question is about the nudge itself.
 */
export function evaluateFilter(
	filter: NudgeFilter,
	ctx: NudgeContext,
	subjectId?: string
): FilterResult {
	switch (filter.type) {
		case 'time_of_day':
			return compareToken(ctx.time_of_day, filter.value);
		case 'season':
			return compareToken(ctx.season, filter.value);
		case 'moon_phase':
			return compareToken(ctx.moon_phase, filter.value);
		case 'locale':
			// a region locale should satisfy a filter naming its base language
			return compareToken(ctx.locale, filter.value).passed
				? PASS
				: compareToken(ctx.locale.split('-')[0], filter.value);

		case 'weekday': {
			const token = weekdayTokenFor(ctx.now);
			const group = isWeekend(ctx.now) ? 'weekend' : 'weekday';
			const { is, is_not } = filter.value;
			if (is && !is.includes(token) && !is.includes(group)) {
				return block(`${token} not in [${is.join(', ')}]`);
			}
			if (is_not && (is_not.includes(token) || is_not.includes(group))) {
				return block(`${token} excluded`);
			}
			return PASS;
		}

		case 'weather': {
			const snapshot = freshWeather(ctx);
			if (!snapshot) return UNKNOWN;
			const { is, is_not } = filter.value;
			if (is && !is.some((token) => matchesWeatherToken(snapshot, token as WeatherToken))) {
				return block(`${snapshot.condition} not in [${is.join(', ')}]`);
			}
			if (is_not && is_not.some((token) => matchesWeatherToken(snapshot, token as WeatherToken))) {
				return block(`${snapshot.condition} excluded`);
			}
			return PASS;
		}

		case 'permission':
			return compareSet(ctx.granted_permissions, filter.value);
		case 'model_pack':
			return compareSet(ctx.installed_packs, filter.value);
		case 'completed':
			return compareSet(Object.keys(ctx.completions), filter.value);

		case 'hour':
			return compareNumber(ctx.hour, filter.value);
		case 'points':
			return compareNumber(ctx.points, filter.value);
		case 'streak_days':
			return compareNumber(ctx.streak_days, filter.value);
		case 'completed_today':
			return compareNumber(ctx.completed_today, filter.value);
		case 'moon_illumination':
			return compareNumber(ctx.moon_illumination, filter.value);
		case 'daylight_remaining':
			return compareNumber(ctx.daylight_remaining, filter.value);

		case 'temperature': {
			const snapshot = freshWeather(ctx);
			if (!snapshot) return UNKNOWN;
			const actual =
				filter.value.unit === 'f' ? snapshot.temperature_c * 1.8 + 32 : snapshot.temperature_c;
			return compareNumber(actual, filter.value);
		}
		case 'wind_speed': {
			const snapshot = freshWeather(ctx);
			return snapshot ? compareNumber(snapshot.wind_speed_kmh, filter.value) : UNKNOWN;
		}
		case 'humidity': {
			const snapshot = freshWeather(ctx);
			return snapshot ? compareNumber(snapshot.humidity, filter.value) : UNKNOWN;
		}
		case 'uv_index': {
			const snapshot = freshWeather(ctx);
			return snapshot ? compareNumber(snapshot.uv_index, filter.value) : UNKNOWN;
		}

		case 'days_since_completed': {
			if (!subjectId) return UNKNOWN;
			const last = ctx.completions[subjectId];
			// never completed reads as infinitely long ago, so cooldowns pass
			if (last === undefined) return compareNumber(Number.MAX_SAFE_INTEGER, filter.value);
			return compareNumber(daysBetween(dayKey(new Date(last)), ctx.day), filter.value);
		}

		default: {
			const exhaustive: never = filter;
			return exhaustive;
		}
	}
}

export interface FiltersResult {
	passed: boolean;
	/** every filter that could not be answered from the context */
	indeterminate: NudgeFilter['type'][];
	/** the first definite mismatch, for debugging and the empty-state copy */
	blockedBy?: { type: NudgeFilter['type']; reason?: string };
}

export function evaluateFilters(
	filters: readonly NudgeFilter[],
	ctx: NudgeContext,
	subjectId?: string
): FiltersResult {
	const indeterminate: NudgeFilter['type'][] = [];

	for (const filter of filters) {
		const result = evaluateFilter(filter, ctx, subjectId);
		if (result.indeterminate) indeterminate.push(filter.type);
		if (!result.passed) {
			return {
				passed: false,
				indeterminate,
				blockedBy: { type: filter.type, reason: result.reason }
			};
		}
	}

	return { passed: true, indeterminate };
}

export function passesFilters(nudge: Nudge, ctx: NudgeContext): boolean {
	return evaluateFilters(nudge.filters, ctx, nudge.id).passed;
}

/** split a pool into eligible and blocked, keeping the reason for the empty state */
export function partitionByFilters(
	nudges: readonly Nudge[],
	ctx: NudgeContext
): { eligible: Nudge[]; blocked: { nudge: Nudge; result: FiltersResult }[] } {
	const eligible: Nudge[] = [];
	const blocked: { nudge: Nudge; result: FiltersResult }[] = [];

	for (const nudge of nudges) {
		const result = evaluateFilters(nudge.filters, ctx, nudge.id);
		if (result.passed) eligible.push(nudge);
		else blocked.push({ nudge, result });
	}

	return { eligible, blocked };
}

// #endregion
