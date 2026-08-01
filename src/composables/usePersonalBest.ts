import type { NudgeCategory } from '~/types/nudge';

// Self-approach goals carry roughly twice the motivation link of normative ones
// with no anxiety penalty (Lochbaum 2023, N=35,031). Every cue here is therefore
// self-referential: there is no rank, no percentile, and nobody else to lose to.

export interface BestFraming {
	label: string;
	/** true the moment a new high is set, which is the only time to celebrate */
	isNew: boolean;
	/** how far off the previous best, when short of it */
	toBeat: number | null;
}

export function personalBestFraming(
	current: number,
	best: number,
	options: { unit?: string } = {}
): BestFraming {
	const unit = options.unit ? ` ${options.unit}` : '';

	if (best <= 0 && current <= 0)
		return { label: 'Just Getting Started', isNew: false, toBeat: null };
	if (current > best) return { label: 'Your Longest Yet', isNew: true, toBeat: null };
	if (current === best && current > 0)
		return { label: 'Matching Your Best', isNew: false, toBeat: 0 };

	return {
		label: `Personal Best: ${best}${unit}`,
		isNew: false,
		toBeat: Math.max(0, best - current + 1)
	};
}

/** informational reward: what you can now do, never what you earned */
export function informationalReward(input: { unlocks?: string[]; grew?: string } = {}): string {
	if (input.unlocks && input.unlocks.length > 0) {
		return `You Can Now ${input.unlocks[0]}`;
	}
	if (input.grew) return `Your ${input.grew} Grew`;
	return 'That Counts';
}

export function usePersonalBest() {
	const progress = useProgressStore();

	function bestFor(key: string): number {
		return progress.bests[key] ?? 0;
	}

	/** the current run vs the best run, per category */
	function forCategory(category: NudgeCategory): BestFraming {
		const current = progress.entriesForCategory(category).length;
		return personalBestFraming(current, bestFor(`category:${category}`), { unit: 'nudges' });
	}

	const streak = computed(() =>
		personalBestFraming(progress.streak.current, progress.streak.longest, { unit: 'days' })
	);

	const dayCount = computed(() =>
		personalBestFraming(progress.resolvedToday.length, bestFor('day'), { unit: 'in a day' })
	);

	/** call after a day's activity so the watermark keeps up */
	async function recordDayBest() {
		if (progress.recordBest('day', progress.resolvedToday.length)) {
			return true;
		}
		return false;
	}

	return { bestFor, forCategory, streak, dayCount, recordDayBest, personalBestFraming };
}
