import {
	STREAK_GRACE_PER_WINDOW,
	STREAK_WINDOW_DAYS,
	type LedgerEntry,
	type StreakDay,
	type StreakState
} from '~/types/context';
import { addDays, dayKey, daysBetween } from '~/utils/day';

/** a day counts when at least one nudge was resolved; skips do not count */
export function activeDays(entries: readonly LedgerEntry[]): Set<string> {
	const days = new Set<string>();
	for (const entry of entries) {
		if (entry.outcome === 'skipped') continue;
		days.add(entry.day);
	}
	return days;
}

interface Walk {
	current: number;
	graceUsed: number;
	paused: boolean;
}

/**
 * walk backwards from `today`, spending one grace day per 7-day window. today
 * itself being empty is not a miss - the day is not over yet.
 */
function walkBack(active: Set<string>, today: Date): Walk {
	if (active.size === 0) return { current: 0, graceUsed: 0, paused: false };

	// reaching the start of history is not a miss, so the walk stops there rather
	// than spending grace on days that never existed
	const earliest = [...active].sort()[0] as string;

	let current = 0;
	let graceUsed = 0;
	let graceInWindow = 0;
	let stepsInWindow = 0;

	for (let offset = 0; offset < 400; offset++) {
		const day = dayKey(addDays(today, -offset));
		if (day < earliest) break;

		if (stepsInWindow >= STREAK_WINDOW_DAYS) {
			stepsInWindow = 0;
			graceInWindow = 0;
		}
		stepsInWindow++;

		if (active.has(day)) {
			current++;
			continue;
		}

		// an empty today is simply unfinished, not a break
		if (offset === 0) continue;

		if (graceInWindow < STREAK_GRACE_PER_WINDOW) {
			graceInWindow++;
			graceUsed++;
			continue;
		}

		return { current, graceUsed, paused: true };
	}

	return { current, graceUsed, paused: false };
}

/** longest run ever recorded, applying the same one-grace-per-window rule */
function longestRun(active: Set<string>): number {
	if (active.size === 0) return 0;

	const sorted = [...active].sort();
	let longest = 0;
	let run = 0;
	let graceInWindow = 0;
	let stepsInWindow = 0;
	let previous: string | null = null;

	for (const day of sorted) {
		if (previous === null) {
			run = 1;
			stepsInWindow = 1;
			graceInWindow = 0;
			previous = day;
			longest = Math.max(longest, run);
			continue;
		}

		const gap = daysBetween(previous, day);

		if (gap === 1) {
			run++;
			stepsInWindow++;
		} else if (gap === 2 && graceInWindow < STREAK_GRACE_PER_WINDOW) {
			// exactly one missed day, and this window still has its grace
			graceInWindow++;
			run += 2;
			stepsInWindow += 2;
		} else {
			run = 1;
			stepsInWindow = 1;
			graceInWindow = 0;
		}

		if (stepsInWindow >= STREAK_WINDOW_DAYS) {
			stepsInWindow = 0;
			graceInWindow = 0;
		}

		longest = Math.max(longest, run);
		previous = day;
	}

	return longest;
}

/** the trailing 7 days as dots, oldest first */
export function streakWeek(active: Set<string>, today: Date, graceDays: Set<string>): StreakDay[] {
	return Array.from({ length: STREAK_WINDOW_DAYS }, (_, i) => {
		const day = dayKey(addDays(today, i - (STREAK_WINDOW_DAYS - 1)));
		const state: StreakDay['state'] = active.has(day)
			? 'filled'
			: graceDays.has(day)
				? 'grace'
				: 'empty';
		return { day, state };
	});
}

/** which days inside the current run were covered by grace rather than activity */
function graceDaysIn(active: Set<string>, today: Date, runLength: number): Set<string> {
	const grace = new Set<string>();
	for (let offset = 0; offset < runLength; offset++) {
		const day = dayKey(addDays(today, -offset));
		if (!active.has(day) && offset !== 0) grace.add(day);
	}
	return grace;
}

export function streakFrom(entries: readonly LedgerEntry[], now: Date = new Date()): StreakState {
	const active = activeDays(entries);
	const { current, graceUsed, paused } = walkBack(active, now);
	const grace = graceDaysIn(active, now, current + graceUsed);

	return {
		current,
		longest: Math.max(current, longestRun(active)),
		grace_used: graceUsed,
		paused,
		week: streakWeek(active, now, grace)
	};
}

/** the i18n key and count for a streak state, so callers with `t` can localise it */
export interface StreakLabelKey {
	key: string;
	count: number;
}

/**
 * Which phrasing a streak state deserves, as a key rather than a string.
 *
 * Split out from `streakLabel` because the App Group snapshot the Watch reads was
 * written in English regardless of locale. The rules live here; the wording lives in
 * `i18n/locales/*.json` under the same names.
 */
export function streakLabelKey(state: StreakState): StreakLabelKey {
	if (state.current === 0) return { key: 'today.streakNone', count: 0 };
	if (state.paused) return { key: 'today.streakResting', count: state.current };
	if (state.current === 1) return { key: 'today.streakDayOne', count: 1 };
	if (state.current === state.longest && state.current > 2) {
		return { key: 'today.streakLongest', count: state.current };
	}
	return { key: 'today.streakDays', count: state.current };
}

/**
 * copy for the streak strip. never punitive - a paused streak is described as
 * resting, and there is no notification for it anywhere in the app.
 *
 * English fallback for anywhere `t` is unavailable; localised surfaces go through
 * `streakLabelKey`. The wording is kept in step with the `today.streak*` keys.
 */
export function streakLabel(state: StreakState): string {
	if (state.current === 0) return 'Start Something Today';
	if (state.paused) return `${state.current} Days, Resting`;
	if (state.current === 1) return 'Day One';
	if (state.current === state.longest && state.current > 2)
		return `${state.current} Days, Your Longest Yet`;
	return `${state.current} Days`;
}
