import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Haptics are fire-and-forget from UI handlers, so the rules that matter are the three ways
 * they must stay silent: the setting is off, the build is not native, or the plugin is absent.
 * A throw from any of them would surface as a broken tap rather than a missing buzz.
 */

const { isNative, notification, impact, selectionChanged, settings } = vi.hoisted(() => ({
	isNative: vi.fn(() => true),
	notification: vi.fn(async (_opts: Record<string, unknown>) => {}),
	impact: vi.fn(async (_opts: Record<string, unknown>) => {}),
	selectionChanged: vi.fn(async () => {}),
	settings: { value: { haptics: true } }
}));

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: isNative } }));
vi.mock('@capacitor/haptics', () => ({
	Haptics: { notification, impact, selectionChanged },
	NotificationType: { Success: 'SUCCESS', Warning: 'WARNING' },
	ImpactStyle: { Light: 'LIGHT', Medium: 'MEDIUM' }
}));
vi.mock('~/composables/useSettings', () => ({ useAppSettingsState: () => settings }));

import { useHaptics } from '~/composables/useHaptics';

/** every method is `void`-ed internally, so the plugin call lands a microtask later */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
	vi.clearAllMocks();
	isNative.mockReturnValue(true);
	settings.value.haptics = true;
	notification.mockImplementation(async (_opts: Record<string, unknown>) => {});
	impact.mockImplementation(async (_opts: Record<string, unknown>) => {});
});

describe('each cue maps to its own plugin call', () => {
	it('uses the success notification for a resolved nudge', async () => {
		useHaptics().success();
		await settle();
		expect(notification).toHaveBeenCalledWith({ type: 'SUCCESS' });
	});

	it('uses the warning notification for a miss', async () => {
		useHaptics().warning();
		await settle();
		expect(notification).toHaveBeenCalledWith({ type: 'WARNING' });
	});

	it('uses a light impact for a card leaving the deck', async () => {
		useHaptics().swipe();
		await settle();
		expect(impact).toHaveBeenCalledWith({ style: 'LIGHT' });
	});

	it('uses a medium impact for a tap', async () => {
		useHaptics().tap();
		await settle();
		expect(impact).toHaveBeenCalledWith({ style: 'MEDIUM' });
	});

	it('uses selectionChanged for a selection', async () => {
		useHaptics().selection();
		await settle();
		expect(selectionChanged).toHaveBeenCalledOnce();
	});
});

describe('when it must stay silent', () => {
	it('does nothing when the setting is off', async () => {
		settings.value.haptics = false;

		const haptics = useHaptics();
		haptics.success();
		haptics.swipe();
		haptics.selection();
		await settle();

		expect(notification).not.toHaveBeenCalled();
		expect(impact).not.toHaveBeenCalled();
		expect(selectionChanged).not.toHaveBeenCalled();
	});

	it('does nothing off native, whatever the setting says', async () => {
		isNative.mockReturnValue(false);

		useHaptics().success();
		await settle();

		expect(notification).not.toHaveBeenCalled();
	});

	// the reason the try/catch is there: a UI handler must not see this reject
	it('swallows a plugin failure instead of throwing into the caller', async () => {
		notification.mockImplementation(async (_opts: Record<string, unknown>) => {
			throw new Error('plugin unavailable');
		});

		expect(() => useHaptics().success()).not.toThrow();
		await expect(settle()).resolves.toBeUndefined();
	});
});
