import { MOON_PHASES, type MoonPhase, type Season, type TimeOfDay, WEEKDAYS } from '~/types/nudge';

// #region keys

/**
 * The day bucket, in the user's own timezone.
 *
 * Local, not UTC, because every other clock reading in the app already is - `hour`,
 * `timeOfDayFor`, the notification times. A UTC bucket disagreed with all of them for
 * anyone west of UTC: at 20:00 in US Central, `toISOString()` is already tomorrow, so
 * an evening nudge landed on tomorrow's key, the day's ring reset before bedtime, the
 * picker swapped in a fresh set, and the real tomorrow then looked like a miss.
 */
export function dayKey(date: Date = new Date()): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

/**
 * iso week key, `YYYY-Www`. weeks start monday per iso-8601.
 *
 * Built from the LOCAL calendar date, so a week contains exactly the seven local day
 * keys it labels. Reading UTC components here while `dayKey` reads local ones would
 * put a Sunday-evening entry west of UTC in the following week.
 */
export function isoWeekKey(date: Date = new Date()): string {
	const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
	// shift to the thursday of this week; iso week years are defined by thursday
	const dayNumber = d.getUTCDay() || 7;
	d.setUTCDate(d.getUTCDate() + 4 - dayNumber);
	const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
	const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
	return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/**
 * Calendar-day arithmetic, not 86_400_000ms.
 *
 * Every caller wraps this in `dayKey`, and `dayKey` is local - so adding a fixed 24
 * hours across a DST transition shifts the wall clock by an hour and can repeat or
 * skip a day key when the time of day is within an hour of midnight. `setDate`
 * normalises month and year rollover for us.
 */
export function addDays(date: Date, days: number): Date {
	const next = new Date(date);
	next.setDate(next.getDate() + days);
	return next;
}

/** whole utc days between two day keys; negative when `to` precedes `from` */
export function daysBetween(from: string, to: string): number {
	const a = Date.parse(`${from}T00:00:00Z`);
	const b = Date.parse(`${to}T00:00:00Z`);
	if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
	return Math.round((b - a) / 86_400_000);
}

/** the 7 day keys ending at `date`, oldest first */
export function weekWindow(date: Date = new Date()): string[] {
	return Array.from({ length: 7 }, (_, i) => dayKey(addDays(date, i - 6)));
}

// #endregion

// #region deterministic randomness

/** djb2-style hash; not cryptographic, just stable across runs and platforms */
export function hashString(input: string): number {
	let h = 5381;
	for (let i = 0; i < input.length; i++) {
		h = ((h << 5) + h + input.charCodeAt(i)) | 0;
	}
	return Math.abs(h);
}

/**
 * mulberry32. seeded so "today's nudges" survive a relaunch, and so tests can
 * assert an exact selection without stubbing Math.random.
 */
export function seededRandom(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
	};
}

/** fisher-yates against a supplied rng so the shuffle stays reproducible */
export function seededShuffle<T>(items: readonly T[], rng: () => number): T[] {
	const out = [...items];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[out[i], out[j]] = [out[j] as T, out[i] as T];
	}
	return out;
}

/**
 * pick `count` items without replacement, probability proportional to weight.
 * zero-or-negative weights are treated as a small floor so nothing is ever
 * strictly unreachable when the pool is small.
 */
export function weightedSample<T>(
	items: readonly T[],
	weightOf: (item: T) => number,
	count: number,
	rng: () => number
): T[] {
	const pool = items.map((item) => ({ item, weight: Math.max(0.0001, weightOf(item)) }));
	const picked: T[] = [];

	while (picked.length < count && pool.length > 0) {
		const total = pool.reduce((sum, entry) => sum + entry.weight, 0);
		let target = rng() * total;
		let index = pool.length - 1;
		for (let i = 0; i < pool.length; i++) {
			target -= pool[i]!.weight;
			if (target <= 0) {
				index = i;
				break;
			}
		}
		picked.push(pool[index]!.item);
		pool.splice(index, 1);
	}

	return picked;
}

// #endregion

// #region clock buckets

/** local-clock buckets; matches crust's circles.ts so the two read the same */
export function timeOfDayFor(date: Date): TimeOfDay {
	const h = date.getHours();
	if (h < 5 || h >= 20) return 'night';
	if (h < 8) return 'dawn';
	if (h < 17) return 'day';
	return 'dusk';
}

export function weekdayTokenFor(date: Date): (typeof WEEKDAYS)[number] {
	// getDay is sunday-indexed; WEEKDAYS is monday-indexed
	return WEEKDAYS[(date.getDay() + 6) % 7] as (typeof WEEKDAYS)[number];
}

export function isWeekend(date: Date): boolean {
	const d = date.getDay();
	return d === 0 || d === 6;
}

/** month buckets, flipped below the equator */
export function seasonFor(date: Date, latitude?: number): Season {
	const month = date.getMonth();
	const northern: Season =
		month <= 1 || month === 11
			? 'winter'
			: month <= 4
				? 'spring'
				: month <= 7
					? 'summer'
					: 'autumn';

	if (latitude !== undefined && latitude < 0) {
		const flipped: Record<Season, Season> = {
			winter: 'summer',
			spring: 'autumn',
			summer: 'winter',
			autumn: 'spring'
		};
		return flipped[northern];
	}

	return northern;
}

// #endregion

// #region moon

const MOON_EPOCH = Date.UTC(2000, 0, 6, 18, 14);
const SYNODIC_MONTH_MS = 29.530_588_67 * 86_400_000;

/** 0 at new moon, 0.5 at full, wrapping back to 1 */
export function moonAgeFraction(date: Date): number {
	const elapsed = date.getTime() - MOON_EPOCH;
	const cycles = elapsed / SYNODIC_MONTH_MS;
	return ((cycles % 1) + 1) % 1;
}

export function moonPhaseFor(date: Date): MoonPhase {
	const fraction = moonAgeFraction(date);
	// eight equal arcs, offset by half a slice so `new` straddles the wrap point
	const index = Math.floor((fraction + 1 / 16) * 8) % 8;
	return MOON_PHASES[index] as MoonPhase;
}

/** fraction of the disc lit, 0 at new and 1 at full */
export function moonIllumination(date: Date): number {
	return (1 - Math.cos(2 * Math.PI * moonAgeFraction(date))) / 2;
}

// #endregion
