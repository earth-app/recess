import { Capacitor } from '@capacitor/core';
import type { NudgePermission } from '~/types/nudge';

// Permissions are asked for at the moment they are needed, never up front, and a
// denial is explained rather than repeated. The granted set feeds the `permission`
// filter so a nudge that needs the camera stops being offered once it is refused.

export const granted = ref<NudgePermission[]>([]);

export const PERMISSION_LABELS: Record<NudgePermission, string> = {
	camera: 'Camera',
	microphone: 'Microphone',
	location: 'Location',
	notifications: 'Notifications'
};

function remember(permission: NudgePermission, ok: boolean) {
	const has = granted.value.includes(permission);
	if (ok && !has) granted.value = [...granted.value, permission];
	if (!ok && has) granted.value = granted.value.filter((entry) => entry !== permission);
}

async function checkCamera(): Promise<boolean> {
	if (!Capacitor.isNativePlatform()) {
		// the web build asks at getUserMedia time; assume available until told otherwise
		return typeof navigator !== 'undefined' && !!navigator.mediaDevices;
	}
	const { Camera } = await import('@capacitor/camera');
	const status = await Camera.checkPermissions();
	return status.camera === 'granted';
}

async function requestCamera(): Promise<boolean> {
	if (!Capacitor.isNativePlatform()) return checkCamera();
	const { Camera } = await import('@capacitor/camera');
	const status = await Camera.requestPermissions({ permissions: ['camera'] });
	return status.camera === 'granted';
}

async function checkLocation(): Promise<boolean> {
	if (!Capacitor.isNativePlatform())
		return typeof navigator !== 'undefined' && !!navigator.geolocation;
	const { Geolocation } = await import('@capacitor/geolocation');
	const status = await Geolocation.checkPermissions();
	return status.location === 'granted' || status.coarseLocation === 'granted';
}

async function requestLocation(): Promise<boolean> {
	if (!Capacitor.isNativePlatform()) return checkLocation();
	const { Geolocation } = await import('@capacitor/geolocation');
	const status = await Geolocation.requestPermissions({ permissions: ['coarseLocation'] });
	return status.location === 'granted' || status.coarseLocation === 'granted';
}

async function checkNotifications(): Promise<boolean> {
	if (!Capacitor.isNativePlatform()) return false;
	const { LocalNotifications } = await import('@capacitor/local-notifications');
	const status = await LocalNotifications.checkPermissions();
	return status.display === 'granted';
}

async function requestNotifications(): Promise<boolean> {
	if (!Capacitor.isNativePlatform()) return false;
	const { LocalNotifications } = await import('@capacitor/local-notifications');
	const status = await LocalNotifications.requestPermissions();
	return status.display === 'granted';
}

async function checkMicrophone(): Promise<boolean> {
	if (!Capacitor.isNativePlatform()) {
		return typeof navigator !== 'undefined' && !!navigator.mediaDevices;
	}
	try {
		const { CapacitorAudioRecorder } = await import('@capgo/capacitor-audio-recorder');
		const status = await CapacitorAudioRecorder.checkPermissions();
		return status.recordAudio === 'granted';
	} catch {
		return false;
	}
}

async function requestMicrophone(): Promise<boolean> {
	if (!Capacitor.isNativePlatform()) return checkMicrophone();
	try {
		const { CapacitorAudioRecorder } = await import('@capgo/capacitor-audio-recorder');
		const status = await CapacitorAudioRecorder.requestPermissions();
		return status.recordAudio === 'granted';
	} catch {
		return false;
	}
}

const CHECKS: Record<NudgePermission, () => Promise<boolean>> = {
	camera: checkCamera,
	microphone: checkMicrophone,
	location: checkLocation,
	notifications: checkNotifications
};

const REQUESTS: Record<NudgePermission, () => Promise<boolean>> = {
	camera: requestCamera,
	microphone: requestMicrophone,
	location: requestLocation,
	notifications: requestNotifications
};

export function usePermissions() {
	/** silent; never prompts. used to refresh the filter context */
	async function check(permission: NudgePermission): Promise<boolean> {
		try {
			const ok = await CHECKS[permission]();
			remember(permission, ok);
			return ok;
		} catch {
			remember(permission, false);
			return false;
		}
	}

	async function checkAll(): Promise<NudgePermission[]> {
		await Promise.all((Object.keys(CHECKS) as NudgePermission[]).map(check));
		return granted.value;
	}

	/** prompts if undetermined; returns the final answer */
	async function require(permission: NudgePermission): Promise<boolean> {
		if (await check(permission)) return true;
		try {
			const ok = await REQUESTS[permission]();
			remember(permission, ok);
			return ok;
		} catch {
			remember(permission, false);
			return false;
		}
	}

	return { granted: readonly(granted), labels: PERMISSION_LABELS, check, checkAll, require };
}
