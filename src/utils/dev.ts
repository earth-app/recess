import type { MoonPhase, Season, TimeOfDay, WeatherCondition } from '~/types/nudge';

/**
 * Developer-mode overrides.
 *
 * `DEV_MODE` is a Vite-injected literal, not a runtime lookup, which is what makes
 * this cheap: every reader below opens with `if (!DEV_MODE) return <untouched>`, so
 * in a production build the guard folds to `true`, the rest of the body becomes
 * unreachable, and Rollup shrinks each function to its pass-through. The panel and
 * its actions live under `src/components/dev/`, are reached only through a
 * `DEV_MODE`-guarded dynamic import, and are dropped from the bundle entirely.
 *
 * This file is the one part of dev mode that ships either way, and it is kept to
 * plain state plus pass-throughs for exactly that reason.
 */
export const DEV_MODE: boolean = __DEV_MODE__;

/** short-circuits every validator, so a flow can be walked without a model */
export type DevVerdict = 'passed' | 'missed' | 'unavailable';

export interface DevContextOverride {
	hour: number | null;
	time_of_day: TimeOfDay | null;
	season: Season | null;
	moon_phase: MoonPhase | null;
	moon_illumination: number | null;
	weather: WeatherCondition | null;
	temperature: number | null;
	latitude: number | null;
	longitude: number | null;
}

export interface DevOverrides {
	/** pinned ids are forced to the front of today's set, ahead of the picker's picks */
	pinnedNudgeIds: string[];
	verdict: DevVerdict | null;
	/** treats these packs as present regardless of what is actually on disk */
	packsInstalled: string[] | null;
	/** ignores every point threshold, so every unlock and biome reads as reached */
	unlockEverything: boolean;
	/** releases the bonus nudge without needing the four core ones resolved */
	forceBonus: boolean;
	context: DevContextOverride;
}

export const DEV_CONTEXT_DEFAULTS: DevContextOverride = {
	hour: null,
	time_of_day: null,
	season: null,
	moon_phase: null,
	moon_illumination: null,
	weather: null,
	temperature: null,
	latitude: null,
	longitude: null
};

export const DEV_OVERRIDE_DEFAULTS: DevOverrides = {
	pinnedNudgeIds: [],
	verdict: null,
	packsInstalled: null,
	unlockEverything: false,
	forceBonus: false,
	context: { ...DEV_CONTEXT_DEFAULTS }
};

/**
 * Module-scope rather than `useState`, so a reader never has to be inside a Nuxt
 * component instance to consult it.
 */
const overrides: DevOverrides = {
	...DEV_OVERRIDE_DEFAULTS,
	pinnedNudgeIds: [],
	context: { ...DEV_CONTEXT_DEFAULTS }
};

export function devOverrides(): DevOverrides {
	return overrides;
}

export function setDevOverrides(next: Partial<DevOverrides>) {
	if (!DEV_MODE) return;
	Object.assign(overrides, next);
}

export function resetDevOverrides() {
	if (!DEV_MODE) return;
	overrides.pinnedNudgeIds = [];
	overrides.verdict = null;
	overrides.packsInstalled = null;
	overrides.unlockEverything = false;
	overrides.forceBonus = false;
	overrides.context = { ...DEV_CONTEXT_DEFAULTS };
}

/** `true` when anything is overridden, so the UI can show it is not stock behaviour */
export function devOverridesActive(): boolean {
	if (!DEV_MODE) return false;
	return (
		overrides.pinnedNudgeIds.length > 0 ||
		overrides.verdict !== null ||
		overrides.packsInstalled !== null ||
		overrides.unlockEverything ||
		overrides.forceBonus ||
		Object.values(overrides.context).some((value) => value !== null)
	);
}

// #region readers

export function devVerdict(): DevVerdict | null {
	if (!DEV_MODE) return null;
	return overrides.verdict;
}

export function devPinnedNudgeIds(): string[] {
	if (!DEV_MODE) return [];
	return overrides.pinnedNudgeIds;
}

export function devPacksInstalled(actual: string[]): string[] {
	if (!DEV_MODE) return actual;
	return overrides.packsInstalled ?? actual;
}

export function devUnlockEverything(): boolean {
	if (!DEV_MODE) return false;
	return overrides.unlockEverything;
}

export function devForceBonus(): boolean {
	if (!DEV_MODE) return false;
	return overrides.forceBonus;
}

export function devContext(): DevContextOverride | null {
	if (!DEV_MODE) return null;
	return overrides.context;
}

// #endregion
