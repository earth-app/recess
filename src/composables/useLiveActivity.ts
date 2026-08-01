import { Capacitor, registerPlugin } from '@capacitor/core';
import type { Nudge } from '~/types/nudge';
import { nudgeTitle } from '~/types/nudge';

// A Live Activity for nudges that carry a duration, so a 20-minute walk has a
// countdown on the lock screen instead of living only inside the app.

interface NudgeLiveActivityPlugin {
	isSupported(): Promise<{ supported: boolean }>;
	start(options: {
		title: string;
		category: string;
		points: number;
		symbol: string;
		seconds: number;
	}): Promise<{ started: boolean; id?: string; reason?: string }>;
	update(options: { paused?: boolean; seconds?: number }): Promise<{ updated: boolean }>;
	end(): Promise<{ ended: boolean }>;
}

const NudgeLiveActivity = registerPlugin<NudgeLiveActivityPlugin>('NudgeLiveActivity', {
	web: () =>
		Promise.resolve({
			isSupported: async () => ({ supported: false }),
			start: async () => ({ started: false, reason: 'web' }),
			update: async () => ({ updated: false }),
			end: async () => ({ ended: false })
		} satisfies NudgeLiveActivityPlugin)
});

/** mdi names mean nothing natively, so map each category to an SF Symbol */
const CATEGORY_SYMBOLS: Record<string, string> = {
	people: 'person.2',
	adventure: 'map',
	home: 'house',
	learn: 'book',
	cooking: 'fork.knife',
	nature: 'leaf',
	errands: 'shippingbox',
	exercise: 'figure.walk',
	art: 'paintbrush'
};

export function symbolFor(category: string): string {
	return CATEGORY_SYMBOLS[category] ?? 'sparkles';
}

export function useLiveActivity() {
	const active = ref<string | null>(null);

	async function supported(): Promise<boolean> {
		if (Capacitor.getPlatform() !== 'ios') return false;
		try {
			return (await NudgeLiveActivity.isSupported()).supported;
		} catch {
			return false;
		}
	}

	/** only meaningful for a nudge with a duration; a no-op otherwise */
	async function start(nudge: Nudge): Promise<boolean> {
		if (!nudge.duration_minutes) return false;
		if (!(await supported())) return false;

		try {
			const result = await NudgeLiveActivity.start({
				title: nudgeTitle(nudge),
				category: nudge.category,
				points: nudge.points,
				symbol: symbolFor(nudge.category),
				seconds: nudge.duration_minutes * 60
			});
			active.value = result.started ? (result.id ?? nudge.id) : null;
			return result.started;
		} catch {
			return false;
		}
	}

	async function end(): Promise<void> {
		if (!active.value) return;
		try {
			await NudgeLiveActivity.end();
		} catch {
			// already dismissed by the user
		}
		active.value = null;
	}

	return { active: readonly(active), supported, start, end, symbolFor };
}
