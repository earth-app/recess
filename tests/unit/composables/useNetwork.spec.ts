import type { ConnectionType } from '@capacitor/network';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Connection state, and the one decision that hangs off it.
 *
 * `downloadGate()` is the only thing standing between a user on cellular and a multi-hundred-MB
 * model pack, so its three outcomes are worth pinning. `initNetwork` is here for its disposer:
 * the web branch adds two window listeners and a wrong return value leaks them on every
 * remount.
 */

const { isNative, getStatus, addListener, remove } = vi.hoisted(() => ({
	isNative: vi.fn(() => false),
	getStatus: vi.fn(async (): Promise<{ connected: boolean; connectionType: ConnectionType }> => ({
		connected: true,
		connectionType: 'wifi'
	})),
	addListener: vi.fn(async () => ({ remove })),
	remove: vi.fn()
}));

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: isNative } }));
vi.mock('@capacitor/network', () => ({ Network: { getStatus, addListener } }));

import {
	applyNetworkStatus,
	connectionType,
	downloadGate,
	initNetwork,
	isCellular,
	isOffline,
	isWifi,
	networkOffline
} from '~/composables/useNetwork';

beforeEach(() => {
	vi.clearAllMocks();
	// module-level refs are shared across the file, so every test starts from online wifi
	networkOffline.value = false;
	connectionType.value = 'wifi';
	isNative.mockReturnValue(false);
	getStatus.mockImplementation(async () => ({ connected: true, connectionType: 'wifi' }));
	addListener.mockImplementation(async () => ({ remove }));
});

describe('applyNetworkStatus', () => {
	it('inverts connected into offline', () => {
		applyNetworkStatus({ connected: false, connectionType: 'none' });
		expect(networkOffline.value).toBe(true);
		expect(isOffline.value).toBe(true);

		applyNetworkStatus({ connected: true, connectionType: 'wifi' });
		expect(isOffline.value).toBe(false);
	});

	it('drives the connection-type flags', () => {
		applyNetworkStatus({ connected: true, connectionType: 'cellular' });
		expect(isCellular.value).toBe(true);
		expect(isWifi.value).toBe(false);

		applyNetworkStatus({ connected: true, connectionType: 'wifi' });
		expect(isWifi.value).toBe(true);
		expect(isCellular.value).toBe(false);
	});

	it('leaves both flags false on an unknown connection', () => {
		applyNetworkStatus({ connected: true, connectionType: 'unknown' });
		expect(isCellular.value).toBe(false);
		expect(isWifi.value).toBe(false);
	});
});

describe('downloadGate', () => {
	it('refuses outright when offline', () => {
		applyNetworkStatus({ connected: false, connectionType: 'none' });
		expect(downloadGate()).toEqual({ allowed: false, reason: 'offline' });
	});

	// allowed, but the caller has to say so first: this is someone's mobile data
	it('allows with a cellular warning', () => {
		applyNetworkStatus({ connected: true, connectionType: 'cellular' });
		expect(downloadGate()).toEqual({ allowed: true, warn: 'cellular' });
	});

	it('allows with no warning on wifi', () => {
		applyNetworkStatus({ connected: true, connectionType: 'wifi' });
		expect(downloadGate()).toEqual({ allowed: true, warn: null });
	});

	// offline wins even when the type still reads cellular, so a stale type cannot open the gate
	it('refuses when offline even if the type is cellular', () => {
		applyNetworkStatus({ connected: false, connectionType: 'cellular' });
		expect(downloadGate()).toMatchObject({ allowed: false });
	});
});

describe('initNetwork on the web', () => {
	it('seeds from navigator.onLine and follows the events', async () => {
		vi.stubGlobal('navigator', { onLine: false });

		const dispose = await initNetwork();
		expect(isOffline.value, 'did not seed from navigator.onLine').toBe(true);

		window.dispatchEvent(new Event('online'));
		expect(isOffline.value).toBe(false);

		window.dispatchEvent(new Event('offline'));
		expect(isOffline.value).toBe(true);

		dispose();
		vi.unstubAllGlobals();
	});

	// a disposer that does not detach leaks two listeners per remount
	it('detaches its listeners when disposed', async () => {
		vi.stubGlobal('navigator', { onLine: true });

		const dispose = await initNetwork();
		dispose();

		networkOffline.value = false;
		window.dispatchEvent(new Event('offline'));
		expect(isOffline.value, 'the offline listener survived disposal').toBe(false);

		vi.unstubAllGlobals();
	});

	it('never reaches the plugin off native', async () => {
		vi.stubGlobal('navigator', { onLine: true });
		const dispose = await initNetwork();
		expect(getStatus).not.toHaveBeenCalled();
		dispose();
		vi.unstubAllGlobals();
	});
});

describe('initNetwork on native', () => {
	it('seeds from the plugin and subscribes to changes', async () => {
		isNative.mockReturnValue(true);
		getStatus.mockImplementation(async () => ({ connected: false, connectionType: 'none' }));

		const dispose = await initNetwork();
		expect(isOffline.value).toBe(true);
		expect(addListener).toHaveBeenCalledWith('networkStatusChange', applyNetworkStatus);

		dispose();
		expect(remove).toHaveBeenCalledOnce();
	});

	// a missing plugin must still hand back a callable disposer
	it('returns a usable no-op disposer when the plugin fails', async () => {
		isNative.mockReturnValue(true);
		getStatus.mockImplementation(async () => {
			throw new Error('plugin unavailable');
		});

		const dispose = await initNetwork();
		expect(() => dispose()).not.toThrow();
	});
});
