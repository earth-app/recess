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
}

// #endregion
