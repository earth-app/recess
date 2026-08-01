import type { Nudge } from '~/types/nudge';
import { MODEL_PACKS, NUDGE_CATEGORIES, type ModelPack } from '~/types/nudge';
import { dayKey } from '~/utils/day';
import { setDevOverrides } from '~/utils/dev';

/**
 * The actions behind the developer panel.
 *
 * Lives under `components/dev/` and is imported only by the panel, so it is
 * unreachable from a production build and Rollup drops it. Nothing here is guarded
 * individually for that reason - the whole module is the dead branch.
 */

export interface SeedLedgerOptions {
	/** how many days back to fill */
	days: number;
	/** resolutions per day */
	perDay: number;
	/** leave this many days empty, to exercise grace days and pauses */
	gaps: number;
}

/** points thresholds worth jumping to, so unlock and biome copy can be seen */
export const DEV_POINT_STOPS = [0, 150, 300, 400, 800, 1200, 2000] as const;

export function useDevTools() {
	const progress = useProgressStore();
	const nudges = useNudgesStore();
	const models = useModelsStore();
	const settings = useAppSettings();
	const { build } = useNudgeContext();
	const { refreshSchedule } = useLocalNotifications();
	const { toast } = useNotify();

	/**
	 * Fabricate a ledger rather than mutating points directly.
	 *
	 * Points, streak, bests, unlocks and the Playground are all derived from the
	 * ledger, so writing a points number straight in would produce a state the app
	 * can never actually reach and would mislead more than it helps.
	 */
	async function seedLedger(options: SeedLedgerOptions) {
		const pool = nudges.catalog;
		if (pool.length === 0) {
			await toast('Load a locale first');
			return;
		}

		let cursor = 0;
		const today = new Date();

		for (let back = options.days - 1; back >= 0; back--) {
			// a deterministic gap pattern, so grace days and pauses are reproducible
			if (options.gaps > 0 && back % (options.gaps + 1) === options.gaps) continue;

			const when = new Date(today);
			when.setDate(when.getDate() - back);

			for (let index = 0; index < options.perDay; index++) {
				const nudge = pool[cursor++ % pool.length];
				if (!nudge) continue;

				await progress.record({
					nudge,
					outcome: 'passed',
					points: nudge.points,
					now: when
				});
			}
		}

		await toast(`Seeded ${options.days} days`);
	}

	/** walk points to a threshold by recording just enough real completions */
	async function jumpToPoints(target: number) {
		const pool = [...nudges.catalog].sort((a, b) => b.points - a.points);
		if (pool.length === 0) {
			await toast('Load a locale first');
			return;
		}

		let guard = 0;
		const when = new Date();

		while (progress.points < target && guard++ < 500) {
			const nudge = pool[guard % pool.length];
			if (!nudge) break;
			await progress.record({ nudge, outcome: 'passed', points: nudge.points, now: when });
		}

		await toast(`Points: ${progress.points}`);
	}

	function pin(nudge: Nudge) {
		setDevOverrides({ pinnedNudgeIds: [nudge.id] });
		void nudges.ensure(build());
	}

	function unpin() {
		setDevOverrides({ pinnedNudgeIds: [] });
		void nudges.ensure(build());
	}

	/** flip every pack to installed without downloading, to reach the validated paths */
	function fakePacks(installed: ModelPack[] | null) {
		setDevOverrides({ packsInstalled: installed });
		void nudges.ensure(build());
	}

	async function fireDigest(slot: 'morning' | 'midday' | 'evening') {
		const { LocalNotifications } = await import('@capacitor/local-notifications');
		const remaining = nudges.remaining.length;

		// a real notification through the real plugin, just scheduled a second out, so
		// tap routing and the digest body are both exercised rather than mocked
		await LocalNotifications.schedule({
			notifications: [
				{
					id: 2_109_000_000 + ['morning', 'midday', 'evening'].indexOf(slot),
					title: 'Recess',
					body: `${slot}: ${remaining} left today`,
					schedule: { at: new Date(Date.now() + 1000) },
					extra: { route: '/tabs/today' }
				}
			]
		});

		await toast(`${slot} digest in 1s`);
	}

	async function rebuildSchedule() {
		await refreshSchedule({ force: true });
		await toast('Schedule rebuilt');
	}

	async function listPending() {
		const { LocalNotifications } = await import('@capacitor/local-notifications');
		const { notifications } = await LocalNotifications.getPending();
		return notifications;
	}

	async function resetEverything() {
		await progress.wipe();
		await settings.resetToDefaults();
		for (const pack of MODEL_PACKS) await models.markRemoved(pack);
		void nudges.ensure(build());
		await toast('Wiped');
	}

	return {
		categories: NUDGE_CATEGORIES,
		packs: MODEL_PACKS,
		today: computed(() => dayKey(new Date())),
		seedLedger,
		jumpToPoints,
		pin,
		unpin,
		fakePacks,
		fireDigest,
		rebuildSchedule,
		listPending,
		resetEverything
	};
}
