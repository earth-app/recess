import type { NudgeType } from '~/types/nudge';
import { devUnlockEverything } from '~/utils/dev';
import { BIOMES, BIOME_THRESHOLDS, nextBiome } from '~/utils/playground';

// Points buy NOTHING. Expected tangible rewards for an already-enjoyed act
// undermine intrinsic motivation (Deci/Koestner/Ryan 1999, all tangible d=-0.34), so crossing
// a threshold reveals a capability - "You Can Now ..." - and never a purchase.
// The ledger is derived from lifetime points, so it can never desync.

export interface Unlock {
	id: string;
	points: number;
	/** phrased to complete "You Can Now ..." */
	capability: string;
	description: string;
	icon: string;
}

// MUST stay sorted by ascending threshold; nextUnlock uses `.find`, so an
// out-of-order entry would report the wrong "next" unlock
export const UNLOCKS: Unlock[] = [
	{
		id: 'notice',
		points: 150,
		capability: 'Get Noticing Nudges',
		description: 'Nudges that ask you to go find one specific thing and catch it.',
		icon: 'mdi:magnify-scan'
	},
	{
		id: 'count',
		points: 300,
		capability: 'Get Counting Nudges',
		description: 'Nudges that ask you for a number nobody has ever counted.',
		icon: 'mdi:numeric'
	},
	{
		id: 'grove',
		points: BIOME_THRESHOLDS.grove,
		capability: 'Grow a Grove',
		description: 'Taller things start appearing in your Playground.',
		icon: 'mdi:tree'
	},
	{
		id: 'pond',
		points: BIOME_THRESHOLDS.pond,
		capability: 'Fill a Pond',
		description: 'Water finds its way into your Playground.',
		icon: 'mdi:waves'
	},
	{
		id: 'ridge',
		points: BIOME_THRESHOLDS.ridge,
		capability: 'Raise a Ridge',
		description: 'The horizon behind your Playground grows a shape.',
		icon: 'mdi:image-filter-hdr'
	}
];

/**
 * Nudge types gated behind a points threshold.
 *
 * `Partial<Record<NudgeType, number>>` rather than `Record<string, number>`: the loose form
 * is how this rotted unnoticed - the keys were never checked against the type vocabulary and
 * nothing consumed the derived list, so `notice` and `count` were served from zero points
 * while `UNLOCKS` still announced them as new at 150 and 300.
 */
export const TYPE_UNLOCKS: Partial<Record<NudgeType, number>> = {
	notice: 150,
	count: 300
};

/** the types still locked at `points`; the recommender excludes these from the pool */
export function lockedTypesAt(points: number): NudgeType[] {
	return Object.entries(TYPE_UNLOCKS)
		.filter(([, threshold]) => threshold !== undefined && points < threshold)
		.map(([type]) => type as NudgeType);
}

export function unlockedAt(points: number): Unlock[] {
	return UNLOCKS.filter((unlock) => points >= unlock.points);
}

export function nextUnlock(points: number): Unlock | null {
	return UNLOCKS.find((unlock) => points < unlock.points) ?? null;
}

/** unlocks crossed by moving from `before` to `after` */
export function newlyUnlocked(before: number, after: number): Unlock[] {
	return UNLOCKS.filter((unlock) => before < unlock.points && after >= unlock.points);
}

export function useUnlocks() {
	const progress = useProgressStore();

	// one place for the dev override, so nothing downstream has to know about it
	const points = computed(() =>
		devUnlockEverything() ? Number.MAX_SAFE_INTEGER : progress.points
	);

	const unlocked = computed(() => unlockedAt(points.value));
	const upcoming = computed(() => nextUnlock(points.value));

	const unlockedIds = computed(() => new Set(unlocked.value.map((unlock) => unlock.id)));

	/** nudge types the user has not reached yet; the picker filters these out */
	const lockedTypes = computed(() => lockedTypesAt(points.value));

	const remainingToNext = computed(() => {
		const next = upcoming.value;
		return next ? Math.max(0, next.points - points.value) : null;
	});

	const biomeProgress = computed(() => nextBiome(points.value));

	return {
		all: UNLOCKS,
		biomes: BIOMES,
		unlocked,
		unlockedIds,
		upcoming,
		lockedTypes,
		remainingToNext,
		biomeProgress,
		newlyUnlocked
	};
}
