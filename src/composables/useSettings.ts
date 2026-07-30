import { Preferences } from '@capacitor/preferences';
import { NUDGE_CATEGORIES, type NudgeCategory } from '~/types/nudge';

const SETTINGS_PREFIX = 'recess.setting.';

// the App Group makes the same suite readable from the Watch and Widget targets
export const APP_GROUP = 'group.com.earthapp.recess';

const THEMES = ['system', 'light', 'dark'] as const;
const FONTS = ['system', 'inter', 'roboto', 'open-sans', 'noto-sans'] as const;
const UNITS = ['metric', 'imperial'] as const;

export type ThemeSetting = (typeof THEMES)[number];
export type FontSetting = (typeof FONTS)[number];
export type UnitSetting = (typeof UNITS)[number];

export interface AppSettings {
	theme: ThemeSetting;
	scale: string;
	font: FontSetting;
	animations: boolean;
	haptics: boolean;
	sounds: boolean;
	units: UnitSetting;
	locale: string;
	notifications: boolean;
	morningTime: string;
	middayTime: string;
	eveningTime: string;
	dailyCount: number;
	cooldownDays: number;
	enabledCategories: NudgeCategory[];
	interests: NudgeCategory[];
	/** null means "trust the benchmark" */
	tierOverride: number | null;
}

export const APP_SETTINGS_DEFAULTS: AppSettings = {
	theme: 'system',
	scale: '1',
	font: 'system',
	animations: true,
	haptics: true,
	sounds: false,
	units: 'metric',
	locale: 'en',
	notifications: true,
	morningTime: '08:30',
	middayTime: '13:00',
	eveningTime: '18:30',
	dailyCount: 4,
	cooldownDays: 21,
	enabledCategories: [...NUDGE_CATEGORIES],
	interests: [],
	tierOverride: null
};

export type AppSettingKey = keyof AppSettings;

export function toSettingStorageKey(key: AppSettingKey): string {
	return `${SETTINGS_PREFIX}${key}`;
}

// #region coercion

function parseStored(raw: string | null): unknown {
	if (raw === null) return null;
	try {
		return JSON.parse(raw);
	} catch {
		return raw;
	}
}

function coerceScale(value: unknown): string {
	if (typeof value !== 'string' && typeof value !== 'number') return APP_SETTINGS_DEFAULTS.scale;
	const parsed = Number.parseFloat(String(value));
	if (!Number.isFinite(parsed)) return APP_SETTINGS_DEFAULTS.scale;
	return String(Math.min(1.5, Math.max(0.7, parsed)));
}

/** `HH:MM`, 24-hour */
export function coerceTime(value: unknown, fallback: string): string {
	if (typeof value !== 'string') return fallback;
	const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
	if (!match) return fallback;
	const hours = Number(match[1]);
	const minutes = Number(match[2]);
	if (hours > 23 || minutes > 59) return fallback;
	return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function coerceCategories(value: unknown, fallback: NudgeCategory[]): NudgeCategory[] {
	if (!Array.isArray(value)) return [...fallback];
	const valid = value.filter((entry): entry is NudgeCategory =>
		(NUDGE_CATEGORIES as readonly string[]).includes(entry as string)
	);
	// an empty enabled-list would leave nothing to show, so fall back instead
	return valid.length > 0 ? [...new Set(valid)] : [...fallback];
}

function coerceInt(value: unknown, fallback: number, min: number, max: number): number {
	const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
	if (!Number.isFinite(parsed)) return fallback;
	return Math.min(max, Math.max(min, Math.round(parsed)));
}

export function coerceSetting<K extends AppSettingKey>(key: K, value: unknown): AppSettings[K] {
	const fallback = APP_SETTINGS_DEFAULTS[key];

	switch (key) {
		case 'theme':
			return (
				(THEMES as readonly string[]).includes(value as string) ? value : fallback
			) as AppSettings[K];
		case 'font':
			return (
				(FONTS as readonly string[]).includes(value as string) ? value : fallback
			) as AppSettings[K];
		case 'units':
			return (
				(UNITS as readonly string[]).includes(value as string) ? value : fallback
			) as AppSettings[K];
		case 'scale':
			return coerceScale(value) as AppSettings[K];
		case 'locale':
			return (typeof value === 'string' && value.length > 0 ? value : fallback) as AppSettings[K];
		case 'morningTime':
			return coerceTime(value, APP_SETTINGS_DEFAULTS.morningTime) as AppSettings[K];
		case 'middayTime':
			return coerceTime(value, APP_SETTINGS_DEFAULTS.middayTime) as AppSettings[K];
		case 'eveningTime':
			return coerceTime(value, APP_SETTINGS_DEFAULTS.eveningTime) as AppSettings[K];
		case 'dailyCount':
			return coerceInt(value, APP_SETTINGS_DEFAULTS.dailyCount, 1, 8) as AppSettings[K];
		case 'cooldownDays':
			return coerceInt(value, APP_SETTINGS_DEFAULTS.cooldownDays, 0, 180) as AppSettings[K];
		case 'enabledCategories':
			return coerceCategories(value, APP_SETTINGS_DEFAULTS.enabledCategories) as AppSettings[K];
		case 'interests':
			return coerceCategories(value, []) as AppSettings[K];
		case 'tierOverride':
			return (
				value === null || value === undefined ? null : coerceInt(value, 1, 1, 3)
			) as AppSettings[K];
		default:
			return (typeof value === 'boolean' ? value : fallback) as AppSettings[K];
	}
}

// #endregion

// #region document

function fontFamilyFor(font: FontSetting): string {
	switch (font) {
		case 'inter':
			return 'Inter, system-ui, sans-serif';
		case 'roboto':
			return 'Roboto, system-ui, sans-serif';
		case 'open-sans':
			return '"Open Sans", system-ui, sans-serif';
		case 'noto-sans':
			return '"Noto Sans", system-ui, sans-serif';
		default:
			return '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
	}
}

export function resolveTheme(theme: ThemeSetting): 'light' | 'dark' {
	if (theme === 'light' || theme === 'dark') return theme;
	if (import.meta.client && window.matchMedia('(prefers-color-scheme: dark)').matches) {
		return 'dark';
	}
	return 'light';
}

export function applyAppSettingsToDocument(settings: AppSettings) {
	if (!import.meta.client) return;

	const root = document.documentElement;
	const applied = resolveTheme(settings.theme);

	root.classList.remove('light', 'dark');
	root.classList.add(applied);
	// Ionic's palette lives behind its own class, so both have to move together or
	// Nuxt UI's tokens go dark while every ion-content stays light
	root.classList.toggle('ion-palette-dark', applied === 'dark');
	root.classList.toggle('animations-disabled', !settings.animations);

	root.style.setProperty('--app-ui-scale', coerceScale(settings.scale));
	root.style.setProperty('--app-font-family', fontFamilyFor(settings.font));
	root.style.setProperty('--ion-font-family', fontFamilyFor(settings.font));

	void syncStatusBar(applied);
}

async function syncStatusBar(applied: 'light' | 'dark') {
	const { Capacitor } = await import('@capacitor/core');
	if (!Capacitor.isNativePlatform()) return;
	try {
		const { StatusBar, Style } = await import('@capacitor/status-bar');
		await StatusBar.setStyle({ style: applied === 'dark' ? Style.Dark : Style.Light });
	} catch {
		// plugin unavailable on this build; the css theme still applied
	}
}

// #endregion

// #region storage

const cache = reactive(new Map<string, unknown>());
let groupConfigured: Promise<void> | null = null;

/**
 * Point Preferences at the App Group suite so the Watch and Widget read the same
 * store.
 *
 * Native only, deliberately. An App Group is an iOS concept with no meaning on
 * web, and `configure` does not reliably settle there - awaiting it stalled boot,
 * while racing a timeout made the key prefix (and therefore every read) depend on
 * timing. Skipping it on web keeps storage deterministic on both platforms.
 *
 * Memoizes the PROMISE rather than a boolean: a flag set before the await lets a
 * concurrent caller read Preferences before the prefix applies.
 */
export async function configurePreferencesGroup() {
	groupConfigured ??= (async () => {
		const { Capacitor } = await import('@capacitor/core');
		if (!Capacitor.isNativePlatform()) return;

		try {
			await Preferences.configure({ group: APP_GROUP });
		} catch {
			// older plugin without group support; the default suite still works
		}
	})();

	await groupConfigured;
}

export function useSettings() {
	const get = async <T = unknown>(key: string, defaultValue: T | null = null) => {
		if (cache.has(key)) return cache.get(key) as T;

		try {
			const { value } = await Preferences.get({ key });
			if (value !== null) {
				const parsed = parseStored(value);
				cache.set(key, parsed);
				return parsed as T;
			}
		} catch {
			// storage unavailable; callers fall back to defaults
		}

		return defaultValue;
	};

	const set = async (key: string, value: unknown) => {
		cache.set(key, value);
		try {
			await Preferences.set({ key, value: JSON.stringify(value) });
		} catch {
			// best-effort; the in-memory value still applies this session
		}
	};

	const remove = async (key: string) => {
		cache.delete(key);
		try {
			await Preferences.remove({ key });
		} catch {
			// best-effort
		}
	};

	const clear = async () => {
		cache.clear();
		try {
			await Preferences.clear();
		} catch {
			// best-effort
		}
	};

	return { cache, get, set, remove, clear };
}

export function useAppSettingsState() {
	return useState<AppSettings>('recess-settings', () => ({ ...APP_SETTINGS_DEFAULTS }));
}

export function useAppSettings() {
	const settings = useAppSettingsState();
	const initialized = useState<boolean>('recess-settings-ready', () => false);
	const { get, set, remove } = useSettings();

	const init = async () => {
		if (initialized.value) {
			applyAppSettingsToDocument(settings.value);
			return settings.value;
		}

		await configurePreferencesGroup();

		const next = { ...APP_SETTINGS_DEFAULTS };
		for (const key of Object.keys(APP_SETTINGS_DEFAULTS) as AppSettingKey[]) {
			const raw = await get<unknown>(toSettingStorageKey(key), undefined);
			if (raw !== undefined) {
				(next as Record<string, unknown>)[key] = coerceSetting(key, raw);
			}
		}

		settings.value = next;
		initialized.value = true;
		applyAppSettingsToDocument(next);
		return next;
	};

	const setValue = async <K extends AppSettingKey>(key: K, value: AppSettings[K]) => {
		const coerced = coerceSetting(key, value);
		settings.value = { ...settings.value, [key]: coerced };
		await set(toSettingStorageKey(key), coerced);
		applyAppSettingsToDocument(settings.value);
	};

	const resetToDefaults = async () => {
		for (const key of Object.keys(APP_SETTINGS_DEFAULTS) as AppSettingKey[]) {
			await remove(toSettingStorageKey(key));
		}
		settings.value = { ...APP_SETTINGS_DEFAULTS };
		initialized.value = true;
		applyAppSettingsToDocument(settings.value);
	};

	return { settings, initialized, init, setValue, resetToDefaults };
}

// #endregion

// #region units

const METERS_PER_MILE = 1609.344;
const METERS_PER_FOOT = 0.3048;

export function formatDistanceUnits(meters: number, units: UnitSetting): string {
	if (units === 'imperial') {
		const miles = meters / METERS_PER_MILE;
		if (miles >= 0.1) return `${miles.toFixed(miles >= 10 ? 0 : 2)} mi`;
		return `${Math.round(meters / METERS_PER_FOOT)} ft`;
	}
	if (meters >= 1000) return `${(meters / 1000).toFixed(meters >= 10_000 ? 0 : 2)} km`;
	return `${Math.round(meters)} m`;
}

export function formatTemperature(celsius: number, units: UnitSetting): string {
	return units === 'imperial' ? `${Math.round(celsius * 1.8 + 32)}°F` : `${Math.round(celsius)}°C`;
}

export function useUnits() {
	const settings = useAppSettingsState();
	const units = computed<UnitSetting>(() => settings.value.units);
	return {
		units,
		formatDistance: (meters: number) => formatDistanceUnits(meters, units.value),
		formatTemp: (celsius: number) => formatTemperature(celsius, units.value)
	};
}

// #endregion
