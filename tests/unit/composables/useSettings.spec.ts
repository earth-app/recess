import { describe, expect, it, vi } from 'vitest';

const { prefsGet, prefsSet, prefsRemove, prefsConfigure } = vi.hoisted(() => ({
	prefsGet: vi.fn(async (_: { key: string }) => ({ value: null as string | null })),
	prefsSet: vi.fn(async () => {}),
	prefsRemove: vi.fn(async () => {}),
	prefsConfigure: vi.fn(async () => {})
}));

vi.mock('@capacitor/preferences', () => ({
	Preferences: {
		configure: prefsConfigure,
		get: prefsGet,
		set: prefsSet,
		remove: prefsRemove,
		clear: vi.fn(async () => {})
	}
}));

import {
	APP_GROUP,
	APP_SETTINGS_DEFAULTS,
	applyAppSettingsToDocument,
	coerceSetting,
	coerceTime,
	configurePreferencesGroup,
	formatDistanceUnits,
	formatTemperature,
	resolveTheme,
	toSettingStorageKey
} from '~/composables/useSettings';

describe('toSettingStorageKey', () => {
	it('namespaces every key', () => {
		expect(toSettingStorageKey('theme')).toBe('recess.setting.theme');
	});
});

describe('coerceTime', () => {
	it('accepts and normalizes HH:MM', () => {
		expect(coerceTime('08:30', '09:00')).toBe('08:30');
		expect(coerceTime('8:30', '09:00')).toBe('08:30');
		expect(coerceTime('23:59', '09:00')).toBe('23:59');
	});

	it('trims surrounding whitespace', () => {
		expect(coerceTime('  07:15 ', '09:00')).toBe('07:15');
	});

	it('falls back on an out-of-range or malformed value', () => {
		for (const bad of ['24:00', '12:60', '', 'noon', '1230', '12:5', null, 830]) {
			expect(coerceTime(bad as unknown, '09:00'), String(bad)).toBe('09:00');
		}
	});
});

describe('coerceSetting', () => {
	it('accepts valid enum values and rejects the rest', () => {
		expect(coerceSetting('theme', 'dark')).toBe('dark');
		expect(coerceSetting('theme', 'neon')).toBe(APP_SETTINGS_DEFAULTS.theme);
		expect(coerceSetting('font', 'inter')).toBe('inter');
		expect(coerceSetting('font', 'comic')).toBe(APP_SETTINGS_DEFAULTS.font);
		expect(coerceSetting('units', 'imperial')).toBe('imperial');
		expect(coerceSetting('units', 'furlongs')).toBe(APP_SETTINGS_DEFAULTS.units);
	});

	it('clamps the ui scale to a legible range', () => {
		expect(coerceSetting('scale', '1.2')).toBe('1.2');
		expect(coerceSetting('scale', '9')).toBe('1.5');
		expect(coerceSetting('scale', '0.1')).toBe('0.7');
		expect(coerceSetting('scale', 'huge')).toBe(APP_SETTINGS_DEFAULTS.scale);
	});

	it('clamps the daily count and cooldown', () => {
		expect(coerceSetting('dailyCount', 99)).toBe(8);
		expect(coerceSetting('dailyCount', 0)).toBe(1);
		expect(coerceSetting('dailyCount', 'four')).toBe(APP_SETTINGS_DEFAULTS.dailyCount);
		expect(coerceSetting('cooldownDays', 999)).toBe(180);
		expect(coerceSetting('cooldownDays', -5)).toBe(0);
	});

	it('coerces booleans and falls back on anything else', () => {
		expect(coerceSetting('animations', false)).toBe(false);
		expect(coerceSetting('animations', 'yes')).toBe(APP_SETTINGS_DEFAULTS.animations);
		expect(coerceSetting('haptics', true)).toBe(true);
	});

	it('drops unknown categories and never leaves the enabled list empty', () => {
		expect(coerceSetting('enabledCategories', ['nature', 'spaceships'])).toEqual(['nature']);
		// an empty list would leave nothing to show, so it falls back to all of them
		expect(coerceSetting('enabledCategories', [])).toEqual(APP_SETTINGS_DEFAULTS.enabledCategories);
		expect(coerceSetting('enabledCategories', 'nature')).toEqual(
			APP_SETTINGS_DEFAULTS.enabledCategories
		);
	});

	it('deduplicates categories', () => {
		expect(coerceSetting('enabledCategories', ['nature', 'nature', 'art'])).toEqual([
			'nature',
			'art'
		]);
	});

	it('allows an empty interests list, unlike enabledCategories', () => {
		expect(coerceSetting('interests', [])).toEqual([]);
		expect(coerceSetting('interests', ['art', 'nope'])).toEqual(['art']);
	});

	it('keeps a null tier override meaning "trust the benchmark"', () => {
		expect(coerceSetting('tierOverride', null)).toBeNull();
		expect(coerceSetting('tierOverride', undefined)).toBeNull();
		expect(coerceSetting('tierOverride', 2)).toBe(2);
		expect(coerceSetting('tierOverride', 9)).toBe(3);
		expect(coerceSetting('tierOverride', 0)).toBe(1);
	});

	it('requires a non-empty locale', () => {
		expect(coerceSetting('locale', 'es-MX')).toBe('es-MX');
		expect(coerceSetting('locale', '')).toBe(APP_SETTINGS_DEFAULTS.locale);
		expect(coerceSetting('locale', 42)).toBe(APP_SETTINGS_DEFAULTS.locale);
	});
});

describe('resolveTheme', () => {
	it('passes an explicit choice through', () => {
		expect(resolveTheme('light')).toBe('light');
		expect(resolveTheme('dark')).toBe('dark');
	});

	it('resolves system to a concrete theme', () => {
		expect(['light', 'dark']).toContain(resolveTheme('system'));
	});
});

describe('applyAppSettingsToDocument', () => {
	/**
	 * Ionic's palette does not follow `.dark`.
	 *
	 * `@nuxt/ui` brings `@nuxtjs/color-mode`, which writes `.dark` on the root, so
	 * every Nuxt UI token goes dark on its own. Ionic ships its palette as a separate
	 * sheet keyed off `.ion-palette-dark`. Toggling one without the other is what
	 * produced dark cards floating on a white page, and nothing about it throws - so
	 * it needs a test or it silently comes back.
	 */
	it('moves the Ionic palette class with the Nuxt UI one', () => {
		applyAppSettingsToDocument({ ...APP_SETTINGS_DEFAULTS, theme: 'dark' });

		const root = document.documentElement;
		expect(root.classList.contains('dark')).toBe(true);
		expect(root.classList.contains('ion-palette-dark')).toBe(true);

		applyAppSettingsToDocument({ ...APP_SETTINGS_DEFAULTS, theme: 'light' });

		expect(root.classList.contains('dark')).toBe(false);
		expect(root.classList.contains('ion-palette-dark')).toBe(false);
	});

	it('keeps the two classes in step when the theme follows the system', () => {
		applyAppSettingsToDocument({ ...APP_SETTINGS_DEFAULTS, theme: 'system' });

		const root = document.documentElement;
		expect(root.classList.contains('ion-palette-dark')).toBe(root.classList.contains('dark'));
	});

	it('toggles the reduced-motion class off the animations setting', () => {
		applyAppSettingsToDocument({ ...APP_SETTINGS_DEFAULTS, animations: false });
		expect(document.documentElement.classList.contains('animations-disabled')).toBe(true);

		applyAppSettingsToDocument({ ...APP_SETTINGS_DEFAULTS, animations: true });
		expect(document.documentElement.classList.contains('animations-disabled')).toBe(false);
	});

	it('applies the ui scale and font family as custom properties', () => {
		applyAppSettingsToDocument({ ...APP_SETTINGS_DEFAULTS, scale: '1.25', font: 'inter' });

		const style = document.documentElement.style;
		expect(style.getPropertyValue('--app-ui-scale')).toBe('1.25');
		expect(style.getPropertyValue('--app-font-family')).toContain('Inter');
		expect(style.getPropertyValue('--ion-font-family')).toContain('Inter');
	});
});

describe('formatDistanceUnits', () => {
	it('formats metric', () => {
		expect(formatDistanceUnits(500, 'metric')).toBe('500 m');
		expect(formatDistanceUnits(1500, 'metric')).toBe('1.50 km');
		expect(formatDistanceUnits(15_000, 'metric')).toBe('15 km');
	});

	it('formats imperial', () => {
		expect(formatDistanceUnits(30, 'imperial')).toBe('98 ft');
		expect(formatDistanceUnits(1609.344, 'imperial')).toBe('1.00 mi');
		expect(formatDistanceUnits(32_186, 'imperial')).toBe('20 mi');
	});

	it('handles zero without NaN', () => {
		expect(formatDistanceUnits(0, 'metric')).toBe('0 m');
		expect(formatDistanceUnits(0, 'imperial')).toBe('0 ft');
	});
});

describe('formatTemperature', () => {
	it('converts to fahrenheit for imperial', () => {
		expect(formatTemperature(0, 'metric')).toBe('0°C');
		expect(formatTemperature(0, 'imperial')).toBe('32°F');
		expect(formatTemperature(100, 'imperial')).toBe('212°F');
	});

	it('rounds rather than truncating', () => {
		expect(formatTemperature(20.6, 'metric')).toBe('21°C');
	});
});

describe('configurePreferencesGroup', () => {
	it('skips the app group off native, where it has no meaning', async () => {
		// the unit env reports the web platform, and `configure` does not reliably
		// settle there; awaiting it used to stall boot
		await configurePreferencesGroup();
		expect(prefsConfigure).not.toHaveBeenCalled();
	});

	it('resolves rather than hanging, and is idempotent', async () => {
		await expect(configurePreferencesGroup()).resolves.toBeUndefined();
		const before = prefsConfigure.mock.calls.length;
		await configurePreferencesGroup();
		expect(prefsConfigure.mock.calls.length).toBe(before);
	});

	it('names the group the Watch and Widget read', () => {
		expect(APP_GROUP).toBe('group.com.earthapp.recess');
	});
});
