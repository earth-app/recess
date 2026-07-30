import { Capacitor } from '@capacitor/core';
import type { ConnectionStatus, ConnectionType } from '@capacitor/network';

// Model downloads are the only heavy network work in the app, so connection
// type matters: we warn on cellular and never start one while offline.

export const networkOffline = ref(false);
export const connectionType = ref<ConnectionType>('unknown');

export const isOffline = computed(() => networkOffline.value);
export const isCellular = computed(() => connectionType.value === 'cellular');
export const isWifi = computed(() => connectionType.value === 'wifi');

export function applyNetworkStatus(status: Pick<ConnectionStatus, 'connected' | 'connectionType'>) {
	networkOffline.value = !status.connected;
	connectionType.value = status.connectionType;
}

export async function initNetwork(): Promise<() => void> {
	if (!import.meta.client) return () => {};

	// browsers still report onLine, which is enough for the web build
	if (!Capacitor.isNativePlatform()) {
		networkOffline.value = typeof navigator !== 'undefined' && !navigator.onLine;
		const onOnline = () => (networkOffline.value = false);
		const onOffline = () => (networkOffline.value = true);
		window.addEventListener('online', onOnline);
		window.addEventListener('offline', onOffline);
		return () => {
			window.removeEventListener('online', onOnline);
			window.removeEventListener('offline', onOffline);
		};
	}

	try {
		const { Network } = await import('@capacitor/network');
		applyNetworkStatus(await Network.getStatus());
		const handle = await Network.addListener('networkStatusChange', applyNetworkStatus);
		return () => void handle.remove();
	} catch {
		return () => {};
	}
}

export type DownloadGate =
	{ allowed: true; warn: 'cellular' | null } | { allowed: false; reason: 'offline' };

/** whether a pack download may start right now, and whether to warn first */
export function downloadGate(): DownloadGate {
	if (isOffline.value) return { allowed: false, reason: 'offline' };
	return { allowed: true, warn: isCellular.value ? 'cellular' : null };
}
