import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { coerceTime } from '~/composables/useSettings';

// Three calm digests a day. Batched digests beat both real-time notification and
// silence (Fitz 2019), so this deliberately does NOT fire per-nudge content spam.
// There is also NO streak-loss notification anywhere - the streak is forgiving by
// design and nagging about it would undo that.

/** id bands must stay disjoint and under the 32-bit signed max the plugin requires */
export const NOTIF_BANDS = {
	REMINDER_BASE: 2_000_000_000,
	REMINDER_END: 2_100_000_000,
	DIGEST_BASE: 2_100_000_000,
	DIGEST_END: 2_110_000_000
} as const;

export const CHANNELS = {
	DAILY: 'daily-nudges',
	REMINDERS: 'nudge-reminders'
} as const;

/** rolling window of one-shots; digest content is dynamic so `repeats` is wrong */
export const DAYS_AHEAD = 5;
const REBUILD_THROTTLE_MS = 30 * 60 * 1000;

export type DigestSlot = 'morning' | 'midday' | 'evening';
const SLOTS: DigestSlot[] = ['morning', 'midday', 'evening'];

let lastRebuild = 0;

function hash(input: string): number {
	let h = 5381;
	for (let i = 0; i < input.length; i++) h = ((h << 5) + h) ^ input.charCodeAt(i);
	return Math.abs(h | 0);
}

export function digestId(slot: DigestSlot, day: string): number {
	const span = NOTIF_BANDS.DIGEST_END - NOTIF_BANDS.DIGEST_BASE;
	return NOTIF_BANDS.DIGEST_BASE + (hash(`${slot}:${day}`) % span);
}

export function reminderId(nudgeId: string): number {
	const span = NOTIF_BANDS.REMINDER_END - NOTIF_BANDS.REMINDER_BASE;
	return NOTIF_BANDS.REMINDER_BASE + (hash(nudgeId) % span);
}

/** `HH:MM` on a given date, in local time */
export function slotDate(day: Date, time: string): Date {
	const [hours, minutes] = coerceTime(time, '09:00').split(':').map(Number) as [number, number];
	const at = new Date(day);
	at.setHours(hours, minutes, 0, 0);
	return at;
}

export async function ensurePermission(): Promise<boolean> {
	if (!Capacitor.isNativePlatform()) return false;
	try {
		const current = await LocalNotifications.checkPermissions();
		if (current.display === 'granted') return true;
		const requested = await LocalNotifications.requestPermissions();
		return requested.display === 'granted';
	} catch {
		return false;
	}
}

export async function createChannels(): Promise<void> {
	if (Capacitor.getPlatform() !== 'android') return;
	try {
		await LocalNotifications.createChannel({
			id: CHANNELS.DAILY,
			name: 'Gentle Nudges',
			description: 'A few calm reminders a day. Never content spam.',
			importance: 3
		});
		await LocalNotifications.createChannel({
			id: CHANNELS.REMINDERS,
			name: 'Nudge Reminders',
			description: "Reminders for nudges you started but haven't finished.",
			importance: 4
		});
	} catch {
		// channels already exist
	}
}

export function initLocalNotificationRouting(): () => void {
	if (!Capacitor.isNativePlatform()) return () => {};

	let handle: PluginListenerHandle | null = null;
	let removed = false;

	void LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
		const route = (action?.notification?.extra as { route?: unknown } | undefined)?.route;
		if (typeof route === 'string' && route.startsWith('/')) void navigateTo(route);
	}).then((h) => {
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

export interface DigestPlan {
	id: number;
	slot: DigestSlot;
	at: Date;
	title: string;
	body: string;
}

/**
 * plan the rolling window. a slot is skipped when it is already past, and the
 * whole day is skipped when the day is already finished - there is nothing calm
 * about being told to do something you have done.
 */
export function planDigests(input: {
	now: Date;
	times: Record<DigestSlot, string>;
	remainingToday: number;
	dailyCount: number;
	copy: (slot: DigestSlot, count: number) => { title: string; body: string };
	daysAhead?: number;
}): DigestPlan[] {
	const plans: DigestPlan[] = [];
	const days = input.daysAhead ?? DAYS_AHEAD;

	for (let offset = 0; offset < days; offset++) {
		const day = new Date(input.now.getTime() + offset * 86_400_000);
		const dayKeyed = day.toISOString().slice(0, 10);

		// only today's count is known; future days assume a full slate
		const count = offset === 0 ? input.remainingToday : input.dailyCount;
		if (count <= 0) continue;

		for (const slot of SLOTS) {
			const at = slotDate(day, input.times[slot]);
			if (at.getTime() <= input.now.getTime() + 60_000) continue;

			const { title, body } = input.copy(slot, count);
			plans.push({ id: digestId(slot, `${dayKeyed}:${slot}`), slot, at, title, body });
		}
	}

	return plans;
}

async function cancelBand(from: number, to: number) {
	try {
		const { notifications } = await LocalNotifications.getPending();
		const ids = notifications
			.map((entry) => (typeof entry.id === 'number' ? entry.id : Number(entry.id)))
			.filter((id) => id >= from && id < to)
			.map((id) => ({ id }));
		if (ids.length > 0) await LocalNotifications.cancel({ notifications: ids });
	} catch {
		// nothing pending
	}
}

export function useLocalNotifications() {
	const settings = useAppSettingsState();
	const nudges = useNudgesStore();
	const { t } = useI18n();

	function copyFor(slot: DigestSlot, count: number) {
		return {
			title: t(`notifications.${slot}Title`),
			body: t(`notifications.${slot}Body`, { count })
		};
	}

	/** rebuild the whole window; throttled because it runs on every foreground */
	async function refreshSchedule(options: { force?: boolean } = {}): Promise<number> {
		if (!Capacitor.isNativePlatform()) return 0;

		const now = Date.now();
		if (!options.force && now - lastRebuild < REBUILD_THROTTLE_MS) return 0;
		lastRebuild = now;

		if (!settings.value.notifications) {
			await cancelBand(NOTIF_BANDS.DIGEST_BASE, NOTIF_BANDS.DIGEST_END);
			return 0;
		}

		if (!(await ensurePermission())) return 0;
		await createChannels();
		await cancelBand(NOTIF_BANDS.DIGEST_BASE, NOTIF_BANDS.DIGEST_END);

		const plans = planDigests({
			now: new Date(now),
			times: {
				morning: settings.value.morningTime,
				midday: settings.value.middayTime,
				evening: settings.value.eveningTime
			},
			remainingToday: nudges.remaining.length,
			dailyCount: settings.value.dailyCount,
			copy: copyFor
		});

		if (plans.length === 0) return 0;

		try {
			await LocalNotifications.schedule({
				notifications: plans.map((plan) => ({
					id: plan.id,
					title: plan.title,
					body: plan.body,
					schedule: { at: plan.at },
					channelId: CHANNELS.DAILY,
					extra: { route: '/tabs/today' }
				}))
			});
			return plans.length;
		} catch (error) {
			console.warn('[notifications] scheduling failed:', error);
			return 0;
		}
	}

	/** optional per-nudge nudge for something time-shaped they started */
	async function scheduleReminder(input: {
		nudgeId: string;
		title: string;
		at: Date;
	}): Promise<boolean> {
		if (!Capacitor.isNativePlatform()) return false;
		if (input.at.getTime() <= Date.now() + 30_000) return false;
		if (!(await ensurePermission())) return false;

		await createChannels();
		const id = reminderId(input.nudgeId);

		try {
			await LocalNotifications.cancel({ notifications: [{ id }] });
			await LocalNotifications.schedule({
				notifications: [
					{
						id,
						title: t('notifications.reminderTitle'),
						body: t('notifications.reminderBody', { title: input.title }),
						schedule: { at: input.at },
						channelId: CHANNELS.REMINDERS,
						extra: { route: '/tabs/today' }
					}
				]
			});
			return true;
		} catch {
			return false;
		}
	}

	async function cancelReminder(nudgeId: string) {
		if (!Capacitor.isNativePlatform()) return;
		try {
			await LocalNotifications.cancel({ notifications: [{ id: reminderId(nudgeId) }] });
		} catch {
			// best-effort
		}
	}

	async function cancelAll() {
		if (!Capacitor.isNativePlatform()) return;
		await cancelBand(NOTIF_BANDS.DIGEST_BASE, NOTIF_BANDS.DIGEST_END);
		await cancelBand(NOTIF_BANDS.REMINDER_BASE, NOTIF_BANDS.REMINDER_END);
	}

	return {
		refreshSchedule,
		scheduleReminder,
		cancelReminder,
		cancelAll,
		ensurePermission,
		planDigests
	};
}
