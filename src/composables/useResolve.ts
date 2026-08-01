import type { NudgeOutcome } from '~/types/context';
import type { Nudge } from '~/types/nudge';
import type { Verdict } from '~/utils/validate';

// The single path every resolution takes, so points, bests, unlocks, the widget
// snapshot and the feedback line can never drift between surfaces.

export interface ResolveInput {
	nudge: Nudge;
	outcome: NudgeOutcome;
	verdict?: Verdict | null;
	choice?: string;
	count?: number;
	text?: string;
	media?: string;
}

export interface ResolveResult {
	points: number;
	/** the warm line to show; always present, model or not */
	feedback: string;
	unlocked: ReturnType<typeof useUnlocks>['unlocked']['value'];
	isNewBest: boolean;
}

export function useResolve() {
	const progress = useProgressStore();
	const nudges = useNudgesStore();
	const { feedbackFor } = useWriting();
	const { newlyUnlocked } = useUnlocks();
	const { recordDayBest } = usePersonalBest();
	const { success, warning } = useHaptics();
	const { writeAppGroupSnapshot } = useWatchBridge();

	const resolving = ref(false);
	const lastResult = ref<ResolveResult | null>(null);

	function pointsFor(input: ResolveInput): number {
		if (input.outcome === 'skipped') return 0;
		// a self-attested nudge still counts; the app is not in the business of
		// docking people for a validator it could not run
		return input.nudge.points;
	}

	async function resolve(input: ResolveInput): Promise<ResolveResult> {
		resolving.value = true;

		const pointsBefore = progress.points;

		try {
			const points = pointsFor(input);

			await progress.record({
				nudge: input.nudge,
				outcome: input.outcome,
				points,
				score: input.verdict?.status === 'passed' ? input.verdict.score : undefined,
				choice: input.choice,
				count: input.count,
				text: input.text,
				media: input.media
			});

			const isNewBest = await recordDayBest();
			const unlocked = newlyUnlocked(pointsBefore, progress.points);

			if (input.outcome === 'skipped') warning();
			else success();

			// the snapshot and the feedback line are both off the critical path; the
			// entry is already recorded and the points are already banked
			void writeAppGroupSnapshot();

			const feedback =
				input.outcome === 'skipped' ? '' : await feedbackFor(input.nudge, input.text ?? null);

			const result: ResolveResult = { points, feedback, unlocked, isNewBest };
			lastResult.value = result;
			return result;
		} finally {
			resolving.value = false;
		}
	}

	async function skip(nudge: Nudge) {
		return resolve({ nudge, outcome: 'skipped' });
	}

	async function undo(nudge: Nudge): Promise<boolean> {
		const removed = await progress.undoToday(nudge.id);
		if (removed) {
			lastResult.value = null;
			void writeAppGroupSnapshot();
		}
		return removed;
	}

	/**
	 * Bring the day's set up to date without re-picking it.
	 *
	 * `refresh()` would re-run the picker, which excludes anything already resolved
	 * today - so the resolved nudge would be dropped and a new one swapped in, and
	 * the day's progress would never advance. `ensure()` only recomputes on a day
	 * rollover, which is the sole case where a new set is correct.
	 */
	function refreshToday() {
		const { build } = useNudgeContext();
		void nudges.ensure(build());
	}

	return {
		resolving: readonly(resolving),
		lastResult: readonly(lastResult),
		resolve,
		skip,
		undo,
		refreshToday
	};
}
