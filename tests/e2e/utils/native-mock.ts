import type { Page } from '@playwright/test';

/**
 * Fakes the Capacitor plugin surface via an init script.
 *
 * recess has no backend, so there is nothing to mock at the network layer - the
 * device IS the backend. Faking the plugin bridge is therefore the only way these
 * journeys are drivable in a browser, and it is what lets a spec assert on
 * Preferences writes, notification scheduling, and camera capture.
 */

export interface NativeMockOptions {
	/** pretend to be a native platform so `Capacitor.isNativePlatform()` is true */
	native?: boolean;
	platform?: 'ios' | 'android' | 'web';
	/** seed Preferences before the app boots */
	preferences?: Record<string, unknown>;
	/** every permission starts granted unless listed here */
	deniedPermissions?: ('camera' | 'microphone' | 'location' | 'notifications')[];
	offline?: boolean;
	connectionType?: 'wifi' | 'cellular' | 'none' | 'unknown';
	/** what a camera capture returns; a tiny valid jpeg by default */
	photoDataUrl?: string | null;
	/** what a barcode scan returns */
	barcode?: string | null;
	/** what the transcriber returns, so audio journeys need no real model */
	transcript?: string;
	/** force validation verdicts without loading a model */
	verdict?: 'passed' | 'missed' | 'unavailable';
	/** which model packs report as installed */
	installedPacks?: ('vision' | 'text' | 'audio' | 'writing')[];
	deviceMemoryGb?: number;
}

/** 1x1 white jpeg, enough for a Blob round-trip without shipping a fixture file */
const TINY_JPEG =
	'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsL' +
	'DBkSEw8UHRofHh0aHBwcJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAAB' +
	'AQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAwT/' +
	'xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=';

export const NATIVE_MOCK_FLAG = '__recessNativeMock';

/** matches `Preferences.configure({ group })` in src/composables/useSettings.ts */
/**
 * The web Preferences implementation namespaces localStorage with
 * `CapacitorStorage.`; `configure({ group })` replaces that prefix, and the group
 * is native-only, so the web build always reads the default.
 */
export const PREFS_PREFIX = 'CapacitorStorage.';

/** the storage key the web Preferences implementation actually reads */
export function prefsKey(key: string): string {
	return `${PREFS_PREFIX}${key}`;
}

export async function installNativeMock(page: Page, options: NativeMockOptions = {}) {
	await page.addInitScript(
		(raw: NativeMockOptions & { __flag: string }) => {
			const flag = raw.__flag;
			const opts: NativeMockOptions = {
				native: true,
				platform: 'ios',
				connectionType: 'wifi',
				transcript: 'a blackbird somewhere behind the shed',
				installedPacks: [],
				deviceMemoryGb: 8,
				...raw
			};

			const state = {
				preferences: new Map<string, string>(),
				scheduled: [] as unknown[],
				cancelled: [] as unknown[],
				toasts: [] as string[],
				dialogs: [] as unknown[],
				haptics: [] as string[],
				written: [] as string[],
				liveActivities: [] as unknown[],
				watchMessages: [] as unknown[]
			};

			/**
			 * Capacitor's web Preferences keys localStorage as `${group}.${key}`, and the app
			 * calls `configure({ group: APP_GROUP })` so the widget and watch can read the same
			 * suite. Seeding only `CapacitorStorage.` therefore missed every read that reached
			 * the real web implementation instead of this stub, which is a live boot race -
			 * that is what made a seeded `recess.tour.v1` look unreliable. Mirror both.
			 */
			const PREFIX = ['CapacitorStorage', 'group.com.earthapp.recess'];
			const writeThrough = (key: string, value: string) => {
				for (const prefix of PREFIX) {
					try {
						localStorage.setItem(`${prefix}.${key}`, value);
					} catch {
						// storage disabled; the map still answers
					}
				}
			};

			for (const [key, value] of Object.entries(opts.preferences ?? {})) {
				const serialized = typeof value === 'string' ? value : JSON.stringify(value);
				state.preferences.set(key, serialized);
				writeThrough(key, serialized);
			}

			const granted = (name: string) => !(opts.deniedPermissions ?? []).includes(name as never);
			const permission = (name: string) => (granted(name) ? 'granted' : 'denied');

			const plugins: Record<string, Record<string, (...args: never[]) => unknown>> = {
				Preferences: {
					configure: async () => ({}),
					get: async ({ key }: { key: string }) => {
						const mocked = state.preferences.get(key);
						if (mocked !== undefined) return { value: mocked };
						// fall through to the real web store, in case a write went there first
						for (const prefix of PREFIX) {
							try {
								const found = localStorage.getItem(`${prefix}.${key}`);
								if (found !== null) return { value: found };
							} catch {
								// storage disabled
							}
						}
						return { value: null };
					},
					// Mirrored into localStorage as well as the mock's own map. Whether the app
					// reaches this stub or Capacitor's real web implementation is a genuine race -
					// core overwrites `window.Capacitor` during boot - so a write that landed in
					// only one of the two made assertions load-dependent.
					set: async ({ key, value }: { key: string; value: string }) => {
						state.preferences.set(key, value);
						writeThrough(key, value);
						return {};
					},
					remove: async ({ key }: { key: string }) => {
						state.preferences.delete(key);
						for (const prefix of PREFIX) {
							try {
								localStorage.removeItem(`${prefix}.${key}`);
							} catch {
								// storage disabled
							}
						}
						return {};
					},
					clear: async () => {
						state.preferences.clear();
						try {
							for (const name of Object.keys(localStorage)) {
								if (PREFIX.some((prefix) => name.startsWith(`${prefix}.`)))
									localStorage.removeItem(name);
							}
						} catch {
							// storage disabled
						}
						return {};
					},
					keys: async () => ({ keys: [...state.preferences.keys()] })
				},
				LocalNotifications: {
					checkPermissions: async () => ({ display: permission('notifications') }),
					requestPermissions: async () => ({ display: permission('notifications') }),
					createChannel: async () => ({}),
					schedule: async ({ notifications }: { notifications: unknown[] }) => {
						state.scheduled.push(...notifications);
						return { notifications };
					},
					getPending: async () => ({ notifications: state.scheduled }),
					cancel: async ({ notifications }: { notifications: unknown[] }) => {
						state.cancelled.push(...notifications);
						const ids = new Set(notifications.map((n) => (n as { id: number }).id));
						state.scheduled = state.scheduled.filter((n) => !ids.has((n as { id: number }).id));
						return {};
					},
					addListener: () => ({ remove: async () => {} })
				},
				Camera: {
					checkPermissions: async () => ({ camera: permission('camera'), photos: 'granted' }),
					requestPermissions: async () => ({ camera: permission('camera'), photos: 'granted' }),
					getPhoto: async () => {
						if (opts.photoDataUrl === null) throw new Error('User cancelled photos app');
						return { webPath: opts.photoDataUrl ?? TINY_JPEG, format: 'jpeg' };
					}
				},
				Geolocation: {
					checkPermissions: async () => ({
						location: permission('location'),
						coarseLocation: permission('location')
					}),
					requestPermissions: async () => ({
						location: permission('location'),
						coarseLocation: permission('location')
					}),
					getCurrentPosition: async () => ({
						coords: { latitude: 41.881, longitude: -87.632, accuracy: 50 },
						timestamp: Date.now()
					})
				},
				Network: {
					getStatus: async () => ({
						connected: !opts.offline,
						connectionType: opts.offline ? 'none' : opts.connectionType
					}),
					addListener: () => ({ remove: async () => {} })
				},
				Device: {
					getInfo: async () => ({
						platform: opts.platform,
						operatingSystem: opts.platform === 'ios' ? 'ios' : 'android',
						osVersion: '18.0',
						model: 'mock',
						manufacturer: 'mock',
						memUsed: (opts.deviceMemoryGb ?? 8) * 1_073_741_824 * 0.5,
						isVirtual: true
					}),
					getId: async () => ({ identifier: 'mock-device' })
				},
				Filesystem: {
					mkdir: async () => ({}),
					readdir: async () => ({ files: [] }),
					stat: async () => {
						throw new Error('not found');
					},
					readFile: async () => {
						throw new Error('not found');
					},
					writeFile: async ({ path }: { path: string }) => {
						state.written.push(path);
						return { uri: `file:///mock/${path}` };
					},
					deleteFile: async () => ({}),
					rmdir: async () => ({})
				},
				Haptics: {
					impact: async ({ style }: { style: string }) => {
						state.haptics.push(`impact:${style}`);
						return {};
					},
					notification: async ({ type }: { type: string }) => {
						state.haptics.push(`notification:${type}`);
						return {};
					},
					selectionChanged: async () => {
						state.haptics.push('selection');
						return {};
					}
				},
				Toast: {
					show: async ({ text }: { text: string }) => {
						state.toasts.push(text);
						return {};
					}
				},
				Dialog: {
					alert: async (payload: unknown) => {
						state.dialogs.push(payload);
						return {};
					},
					confirm: async (payload: unknown) => {
						state.dialogs.push(payload);
						return { value: true };
					},
					prompt: async () => ({ value: '', cancelled: false })
				},
				SplashScreen: { show: async () => ({}), hide: async () => ({}) },
				StatusBar: { setStyle: async () => ({}), setBackgroundColor: async () => ({}) },
				Keyboard: { setResizeMode: async () => ({}), hide: async () => ({}) },
				App: {
					minimizeApp: async () => ({}),
					exitApp: async () => ({}),
					addListener: () => ({ remove: async () => {} }),
					getInfo: async () => ({ name: 'Recess', id: 'com.earthapp.recess', version: '1.0.0' })
				},
				Share: { share: async () => ({}) },
				CapacitorBarcodeScanner: {
					scanBarcode: async () => {
						if (opts.barcode === null) throw new Error('scan cancelled');
						return { ScanResult: opts.barcode ?? '9780262033848' };
					}
				},
				CapacitorAudioRecorder: {
					checkPermissions: async () => ({ recordAudio: permission('microphone') }),
					requestPermissions: async () => ({ recordAudio: permission('microphone') }),
					startRecording: async () => ({}),
					stopRecording: async () => ({ uri: TINY_JPEG })
				},
				CapgoWatch: {
					getInfo: async () => ({ isSupported: true, isReachable: true, isPaired: true }),
					transferUserInfo: async (payload: unknown) => {
						state.watchMessages.push(payload);
						return {};
					},
					sendMessage: async (payload: unknown) => {
						state.watchMessages.push(payload);
						return {};
					}
				},
				NudgeLiveActivity: {
					isSupported: async () => ({ supported: true }),
					start: async (payload: unknown) => {
						state.liveActivities.push(payload);
						return { started: true, id: 'mock-activity' };
					},
					update: async () => ({ updated: true }),
					end: async () => ({ ended: true })
				}
			};

			const capacitor = {
				platform: opts.platform,
				isNativePlatform: () => opts.native === true,
				getPlatform: () => opts.platform,
				isPluginAvailable: (name: string) => name in plugins,
				registerPlugin: (name: string, impl?: unknown) =>
					plugins[name] ?? (impl as Record<string, unknown>) ?? {},
				Plugins: plugins,
				convertFileSrc: (url: string) => url,
				addListener: () => ({ remove: async () => {} })
			};

			(window as unknown as Record<string, unknown>).Capacitor = capacitor;
			(window as unknown as Record<string, unknown>)[flag] = state;

			// deviceMemory is read-only, so define it rather than assign
			if (opts.deviceMemoryGb) {
				Object.defineProperty(navigator, 'deviceMemory', {
					value: opts.deviceMemoryGb,
					configurable: true
				});
			}
		},
		{ ...options, __flag: NATIVE_MOCK_FLAG }
	);
}

/** read whatever the mock recorded, for asserting side effects */
export async function readMockState(page: Page) {
	return page.evaluate((flag) => {
		const state = (window as unknown as Record<string, Record<string, unknown>>)[flag] ?? {
			preferences: new Map<string, string>(),
			scheduled: [],
			cancelled: [],
			toasts: [],
			dialogs: [],
			haptics: [],
			written: [],
			liveActivities: [],
			watchMessages: []
		};
		// both Preferences prefixes are stripped so a write reports under its bare key
		// whichever path handled it; the raw key is kept too for anything reading it directly
		const prefixes = ['CapacitorStorage.', 'group.com.earthapp.recess.'];
		const stored: Record<string, string> = {};
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			if (!key) continue;
			const value = localStorage.getItem(key) ?? '';
			stored[key] = value;
			const prefix = prefixes.find((candidate) => key.startsWith(candidate));
			if (prefix) stored[key.slice(prefix.length)] = value;
		}

		return {
			// merged: the plugin stub for native-only calls, localStorage for the real
			// web Preferences path
			preferences: {
				...Object.fromEntries((state.preferences as Map<string, string>) ?? []),
				...stored
			},
			scheduled: state.scheduled,
			cancelled: state.cancelled,
			toasts: state.toasts,
			dialogs: state.dialogs,
			haptics: state.haptics,
			written: state.written,
			liveActivities: state.liveActivities,
			watchMessages: state.watchMessages
		};
	}, NATIVE_MOCK_FLAG);
}

/** skip onboarding so a spec can land straight on the dashboard */
/**
 * A fixed install seed, so a boot is the same *install* every time.
 *
 * The seed keys the day picker, and it is minted from `crypto.getRandomValues` on first
 * launch - so without pinning it here, re-seeding Preferences on each boot mints a new
 * one and two boots legitimately produce two different decks. Determinism is per
 * install, not global.
 */
export const TEST_INSTALL_SEED = '0f1e2d3c4b5a69788796a5b4c3d2e1f0';

export function completedOnboarding(): Record<string, unknown> {
	return {
		'recess:install-seed': JSON.stringify(TEST_INSTALL_SEED),
		'recess.onboarding.v1': JSON.stringify({
			completed: true,
			step: 5,
			skippedModels: true,
			completedAt: Date.now()
		})
	};
}
