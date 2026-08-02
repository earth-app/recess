import type {
	ModelPack,
	MoonPhase,
	NudgeCategory,
	NudgePermission,
	Season,
	TimeOfDay,
	ValidationType,
	WeatherCondition
} from './nudge';
import type { Affordance } from './places';

// #region weather

export interface WeatherSnapshot {
	/** raw WMO 4677 code as reported by Open-Meteo */
	code: number;
	condition: WeatherCondition;
	temperature_c: number;
	wind_speed_kmh: number;
	humidity: number;
	uv_index: number;
	is_day: boolean;
	fetched_at: number;
	latitude: number;
	longitude: number;
}

/** past this age the snapshot stops counting as known and weather filters pass */
export const WEATHER_MAX_AGE_MS = 6 * 60 * 60 * 1000;

// #endregion

// #region position

export interface PositionSnapshot {
	/** already snapped to the privacy grid; the raw fix is never stored */
	latitude: number;
	longitude: number;
	/** metres, as the OS reported it before snapping; null when hand-pinned */
	accuracy: number | null;
	fetched_at: number;
	/** the user pinned this area by hand instead of granting location */
	manual: boolean;
}

/**
 * Past this, the Out There tab refreshes on open and the UI may say "last known".
 * It does NOT stop the position being used - see below.
 */
export const POSITION_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/**
 * Past this, the position stops feeding the filter context entirely.
 *
 * Two thresholds rather than one, because the two questions are different. Sun and season math
 * only need to know roughly which part of the world you are in, so yesterday's fix is perfectly
 * good and expiring it at 12h would throw away a usable answer for nothing. But a fix from last
 * month might be a different continent, and `daylight_remaining` would then be a confidently
 * wrong number rather than an absent one - which is the failure mode this codebase cares most
 * about. A week is long enough to survive travel and a flat battery, short enough that a stale
 * position degrades to "unknown" (and so to a passing filter) before it can start lying.
 *
 * A hand-pinned position never expires, because the user asserted it.
 */
export const POSITION_USABLE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// #endregion

// #region ledger

export type NudgeOutcome = 'passed' | 'self_attested' | 'answered' | 'skipped';

export interface LedgerEntry {
	/** composed nudge id */
	id: string;
	category: NudgeCategory;
	type: string;
	outcome: NudgeOutcome;
	points: number;
	at: number;
	/** utc day key the entry belongs to, denormalized so day math needs no tz guess */
	day: string;
	validation_type?: ValidationType;
	/** 0-1 model score when a validator produced one */
	score?: number;
	/** which answer/option was picked, for question + choose */
	choice?: string;
	/** what the user reported for a count nudge */
	count?: number;
	/** free text the user wrote, kept for the Week highlights */
	text?: string;
	/** filesystem path of a captured photo or audio clip, never a data url */
	media?: string;
	duration_minutes?: number;
	/**
	 * the grid cell this was resolved in, when the nudge was bound to a place.
	 *
	 * A cell, never a fix - it is written already snapped, so the ledger cannot hold a finer
	 * position than the app is willing to use anywhere else. This is what Warm Ground reads, and
	 * it is the ONLY location history recess keeps: there is no passive tracking, so a cell only
	 * appears here because the user resolved something there.
	 */
	place?: { lat: number; lon: number };
}

export interface ProgressSnapshot {
	entries: LedgerEntry[];
	points: number;
	/** per-category and per-metric high-water marks */
	bests: Record<string, number>;
}

// #endregion

// #region streak

export interface StreakState {
	current: number;
	longest: number;
	/** grace days spent inside the current rolling window */
	grace_used: number;
	/** two misses in one window pauses rather than resets */
	paused: boolean;
	/** utc day keys of the last 7 days, oldest first */
	week: StreakDay[];
}

export interface StreakDay {
	day: string;
	state: 'filled' | 'grace' | 'empty' | 'future';
}

export const STREAK_WINDOW_DAYS = 7;
export const STREAK_GRACE_PER_WINDOW = 1;

// #endregion

// #region nudge context

/**
 * everything filters can be evaluated against. any field left undefined means
 * "unknown", and an unknown value makes its filter pass rather than block.
 */
export interface NudgeContext {
	now: Date;
	/** utc day key, `YYYY-MM-DD` */
	day: string;
	hour: number;
	weekday: number;
	time_of_day: TimeOfDay;
	season: Season;
	moon_phase: MoonPhase;
	moon_illumination: number;
	locale: string;
	points: number;
	streak_days: number;
	completed_today: number;
	/** composed nudge id -> most recent completion timestamp */
	completions: Record<string, number>;
	granted_permissions: NudgePermission[];
	installed_packs: ModelPack[];
	weather?: WeatherSnapshot;
	/** minutes until sunset; negative once the sun is down */
	daylight_remaining?: number;
	latitude?: number;
	longitude?: number;
	/**
	 * affordances with at least one reachable place in the loaded area pack.
	 *
	 * Precomputed rather than handing the filter engine the whole pack, so `evaluateFilter` stays
	 * the cheap synchronous function it is today and `compareSet` can be reused verbatim - the
	 * `nearby` filter is then exactly as AND-strict as `permission` and `model_pack`.
	 *
	 * `undefined` means unanswerable (no pack, no position) and so passes, which is what keeps a
	 * rural or offline user's deck identical to what it is today.
	 */
	reachable_affordances?: Affordance[];
	/**
	 * best reachability score per affordance, in (0, 1].
	 *
	 * Feeds the recommender's soft bump, never a filter. Separate from the list above because
	 * "is there one at all" and "how far is it" are different questions and only the first one is
	 * allowed to gate anything.
	 */
	reachability?: Partial<Record<Affordance, number>>;
}

// #endregion
