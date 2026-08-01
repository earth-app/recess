import { App } from '@capacitor/app';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { APP_GROUP } from '~/composables/useSettings';
import type { StreakDay } from '~/types/context';
import { nudgeTitle } from '~/types/nudge';
import { streakLabel, streakLabelKey } from '~/utils/streak';

// The App Group IS the whole widget and watch bridge. `Preferences.configure({group})`
// writes to a shared UserDefaults suite that Swift reads with
// `UserDefaults(suiteName:)`, so neither the widget nor the watch needs a custom
// plugin. Only the Live Activity does.

/** the single key both native targets read */
export const SNAPSHOT_KEY = 'recess.snapshot.v1';

/** where SceneDelegate parks a home-screen shortcut's route */
export const SHORTCUT_KEY = 'recess.shortcutRoute';

/**
 * Drains the route a home-screen shortcut left behind.
 *
 * A cold launch from a shortcut reaches Swift long before the webview exists, so the route cannot
 * be delivered as an event - it is parked in the App Group and collected here instead. Reading it
 * clears it, so a later relaunch does not jump somewhere the user did not ask to go.
 */
export async function takeShortcutRoute(): Promise<string | null> {
	if (!import.meta.client || Capacitor.getPlatform() !== 'ios') return null;

	try {
		await Preferences.configure({ group: APP_GROUP });
		const { value } = await Preferences.get({ key: SHORTCUT_KEY });
		if (value === null) return null;

		await Preferences.remove({ key: SHORTCUT_KEY });
		return value.startsWith('/') ? value : null;
	} catch {
		// web build, or an older plugin without group support
		return null;
	}
}

/**
 * Follows a parked shortcut route now and on every resume, since tapping a shortcut while the app
 * is already running warms it rather than launching it.
 */
export function initShortcutRouting(): () => void {
	if (!Capacitor.isNativePlatform()) return () => {};

	const follow = async () => {
		const route = await takeShortcutRoute();
		if (route) await navigateTo(route);
	};

	void follow();

	let handle: PluginListenerHandle | null = null;
	let removed = false;

	void App.addListener('resume', () => void follow()).then((h) => {
		if (removed) {
			void h.remove();
			return;
		}
		handle = h;
	});

	return () => {
		removed = true;
		void handle?.remove();
		handle = null;
	};
}

export interface AppGroupSnapshot {
	/** resolved core nudges today */
	done: number;
	/** core nudges in today's set */
	total: number;
	points: number;
	streak: number;
	streakLabel: string;
	/** the next unresolved nudge, for the medium widget and the watch */
	nextTitle: string | null;
	nextIcon: string | null;
	nextPoints: number | null;
	/** 7 chars, oldest first: f=filled g=grace e=empty */
	week: string;
	updatedAt: number;
}

// keyed by the union, so a new StreakDay state cannot silently render as empty
const WEEK_CODES: Record<StreakDay['state'], string> = {
	filled: 'f',
	grace: 'g',
	empty: 'e',
	future: '-'
};

/** 7 chars for the watch ring; a state from outside the union still degrades to empty */
export function encodeWeek(days: readonly { state: string }[]): string {
	return days.map((day) => WEEK_CODES[day.state as StreakDay['state']] ?? 'e').join('');
}

export function useWatchBridge() {
	const progress = useProgressStore();
	const nudges = useNudgesStore();

	/**
	 * The Watch renders this string verbatim, so it has to be in the user's language.
	 *
	 * Falls back to the English `streakLabel` rather than throwing: `useI18n` needs a
	 * component instance, and a snapshot write must never be what takes the app down.
	 */
	function localisedStreakLabel(state: ReturnType<typeof streakLabelKey>): string {
		try {
			const { t } = useI18n();
			return t(state.key, { count: state.count });
		} catch {
			return '';
		}
	}

	function buildSnapshot(): AppGroupSnapshot {
		const today = nudges.today;
		const remaining = nudges.remaining;
		const next = remaining[0] ?? null;
		const streak = progress.streak;

		return {
			done: Math.max(0, today.length - remaining.length),
			total: today.length,
			points: progress.points,
			streak: streak.current,
			streakLabel: localisedStreakLabel(streakLabelKey(streak)) || streakLabel(streak),
			nextTitle: next ? nudgeTitle(next) : null,
			nextIcon: next?.icon ?? null,
			nextPoints: next?.points ?? null,
			week: encodeWeek(streak.week),
			updatedAt: Date.now()
		};
	}

	/** cheap and idempotent, so it is safe to call after every state change */
	async function writeAppGroupSnapshot(): Promise<AppGroupSnapshot | null> {
		if (!import.meta.client) return null;

		const snapshot = buildSnapshot();

		try {
			await Preferences.configure({ group: APP_GROUP });
			await Preferences.set({ key: SNAPSHOT_KEY, value: JSON.stringify(snapshot) });
		} catch {
			// web build, or an older plugin without group support
		}

		void forwardToWatch(snapshot);
		return snapshot;
	}

	async function forwardToWatch(snapshot: AppGroupSnapshot) {
		if (Capacitor.getPlatform() !== 'ios') return;

		try {
			const { CapgoWatch } = await import('@capgo/capacitor-watch');
			const info = await CapgoWatch.getInfo();
			if (!info.isSupported) return;

			// durable queue first so it survives an off-wrist period, then an
			// interactive message when the watch is actually reachable
			await CapgoWatch.transferUserInfo({
				userInfo: { type: 'snapshot.update', ...snapshot }
			});

			if (info.isReachable) {
				await CapgoWatch.sendMessage({ data: { type: 'snapshot.update', ...snapshot } });
			}
		} catch {
			// no paired watch, or the plugin is unavailable on this build
		}
	}

	/** keep the snapshot current while the app is open */
	async function initWatchBridge(): Promise<() => void> {
		if (!import.meta.client) return () => {};

		await writeAppGroupSnapshot();

		const stop = watch(
			() => [progress.entries.length, nudges.today.length, progress.points] as const,
			() => void writeAppGroupSnapshot()
		);

		return stop;
	}

	return { buildSnapshot, writeAppGroupSnapshot, initWatchBridge, encodeWeek, SNAPSHOT_KEY };
}
