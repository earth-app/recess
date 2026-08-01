import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The single path every resolution takes.
 *
 * It was at 0% gate coverage while owning points, bests, unlocks, haptics, the App Group
 * snapshot and the feedback line - so a reorder or a dropped await here would change what the
 * user is scored and told, with nothing failing.
 */

const {
	record,
	undoToday,
	recordDayBest,
	newlyUnlocked,
	feedbackFor,
	success,
	warning,
	snapshot,
	ensure
} = vi.hoisted(() => ({
	record: vi.fn(async (_payload: Record<string, unknown>) => {}),
	undoToday: vi.fn(async () => true),
	recordDayBest: vi.fn(async () => false),
	newlyUnlocked: vi.fn(() => [] as unknown[]),
	feedbackFor: vi.fn(async () => 'Nice one.'),
	success: vi.fn(),
	warning: vi.fn(),
	snapshot: vi.fn(async () => {}),
	ensure: vi.fn(async () => {})
}));

// points is read before and after `record`, so the store has to be a live object
const store = { points: 0, record, undoToday };

vi.mock('~/stores/progress', () => ({ useProgressStore: () => store }));
vi.mock('~/stores/nudges', () => ({ useNudgesStore: () => ({ ensure }) }));
vi.mock('~/composables/useWriting', () => ({ useWriting: () => ({ feedbackFor }) }));
vi.mock('~/composables/useUnlocks', () => ({ useUnlocks: () => ({ newlyUnlocked }) }));
vi.mock('~/composables/usePersonalBest', () => ({ usePersonalBest: () => ({ recordDayBest }) }));
vi.mock('~/composables/useHaptics', () => ({ useHaptics: () => ({ success, warning }) }));
vi.mock('~/composables/useWatchBridge', () => ({
	useWatchBridge: () => ({ writeAppGroupSnapshot: snapshot })
}));
vi.mock('~/composables/useNudgeContext', () => ({
	useNudgeContext: () => ({ build: () => ({ day: '2026-07-29' }) })
}));

import { useResolve } from '~/composables/useResolve';
import { task, think } from '../helpers';

beforeEach(() => {
	vi.clearAllMocks();
	store.points = 0;
	record.mockImplementation(async (_payload: Record<string, unknown>) => {});
	undoToday.mockImplementation(async () => true);
	recordDayBest.mockImplementation(async () => false);
	newlyUnlocked.mockImplementation(() => []);
	feedbackFor.mockImplementation(async () => 'Nice one.');
});

describe('points awarded', () => {
	it('awards the nudge its full points when resolved', async () => {
		const { resolve } = useResolve();
		const result = await resolve({ nudge: task({ points: 14 }), outcome: 'passed' });
		expect(result.points).toBe(14);
	});

	it('awards nothing for a skip', async () => {
		const { resolve } = useResolve();
		const result = await resolve({ nudge: task({ points: 14 }), outcome: 'skipped' });
		expect(result.points).toBe(0);
	});

	/**
	 * A product rule, not an accident: the app does not dock someone for a validator it could
	 * not run. Fail-closed means offering self-attestation, never a smaller reward for taking it.
	 */
	it('awards full points for a self-attested nudge', async () => {
		const { resolve } = useResolve();
		const result = await resolve({ nudge: task({ points: 20 }), outcome: 'self_attested' });
		expect(result.points).toBe(20);
	});
});

describe('what reaches the ledger', () => {
	it('passes the submission through with the nudge and outcome', async () => {
		const { resolve } = useResolve();
		const nudge = task({ points: 8 });
		await resolve({
			nudge,
			outcome: 'passed',
			choice: 'left',
			count: 3,
			text: 'what I wrote',
			media: 'data:image/jpeg;base64,AA=='
		});

		expect(record).toHaveBeenCalledOnce();
		expect(record.mock.calls[0]![0]).toMatchObject({
			nudge,
			outcome: 'passed',
			points: 8,
			choice: 'left',
			count: 3,
			text: 'what I wrote',
			media: 'data:image/jpeg;base64,AA=='
		});
	});

	// a score is only meaningful when the validator actually passed it
	it('records a score only for a passed verdict', async () => {
		const { resolve } = useResolve();

		await resolve({
			nudge: task(),
			outcome: 'passed',
			verdict: { status: 'passed', score: 0.82 } as never
		});
		expect(record.mock.calls[0]![0]).toMatchObject({ score: 0.82 });

		record.mockClear();
		await resolve({
			nudge: task(),
			outcome: 'self_attested',
			verdict: { status: 'unavailable', reason: 'no pack' } as never
		});
		expect(record.mock.calls[0]![0].score).toBeUndefined();
	});
});

describe('unlocks', () => {
	/**
	 * `pointsBefore` is captured before `record` runs and compared against the store after, so
	 * moving that read below the write would make every unlock announcement silently empty.
	 */
	it('compares the points either side of the write', async () => {
		record.mockImplementation(async (_payload: Record<string, unknown>) => {
			store.points = 150;
		});

		const { resolve } = useResolve();
		await resolve({ nudge: task({ points: 150 }), outcome: 'passed' });

		expect(newlyUnlocked).toHaveBeenCalledWith(0, 150);
	});

	it('hands the crossed unlocks back to the caller', async () => {
		newlyUnlocked.mockImplementation(() => [{ id: 'notice' }]);
		const { resolve } = useResolve();
		const result = await resolve({ nudge: task(), outcome: 'passed' });
		expect(result.unlocked).toEqual([{ id: 'notice' }]);
	});
});

describe('feedback and haptics', () => {
	it('asks for a warm line on a real resolution', async () => {
		const { resolve } = useResolve();
		const result = await resolve({ nudge: task(), outcome: 'passed', text: 'a sentence' });

		expect(feedbackFor).toHaveBeenCalledWith(expect.anything(), 'a sentence');
		expect(result.feedback).toBe('Nice one.');
		expect(success).toHaveBeenCalledOnce();
		expect(warning).not.toHaveBeenCalled();
	});

	// a skip is not an achievement; it gets the softer haptic and no generated praise
	it('says nothing and buzzes differently on a skip', async () => {
		const { resolve } = useResolve();
		const result = await resolve({ nudge: task(), outcome: 'skipped' });

		expect(result.feedback).toBe('');
		expect(feedbackFor).not.toHaveBeenCalled();
		expect(warning).toHaveBeenCalledOnce();
		expect(success).not.toHaveBeenCalled();
	});

	it('passes null rather than undefined when there is no text', async () => {
		const { resolve } = useResolve();
		await resolve({ nudge: think(), outcome: 'passed' });
		expect(feedbackFor).toHaveBeenCalledWith(expect.anything(), null);
	});
});

describe('the resolving flag', () => {
	it('is cleared even when the write throws', async () => {
		record.mockImplementation(async (_payload: Record<string, unknown>) => {
			throw new Error('storage full');
		});

		const { resolve, resolving } = useResolve();
		await expect(resolve({ nudge: task(), outcome: 'passed' })).rejects.toThrow('storage full');
		expect(resolving.value, 'a failed resolve left the ui stuck in its busy state').toBe(false);
	});

	it('is false once a resolution finishes', async () => {
		const { resolve, resolving } = useResolve();
		await resolve({ nudge: task(), outcome: 'passed' });
		expect(resolving.value).toBe(false);
	});
});

describe('skip', () => {
	it('is a resolve with the skipped outcome', async () => {
		const { skip } = useResolve();
		const result = await skip(task({ points: 12 }));
		expect(result.points).toBe(0);
		expect(record.mock.calls[0]![0]).toMatchObject({ outcome: 'skipped' });
	});
});

describe('undo', () => {
	it('clears the last result and refreshes the snapshot when something was removed', async () => {
		const { resolve, undo, lastResult } = useResolve();
		await resolve({ nudge: task(), outcome: 'passed' });
		expect(lastResult.value).not.toBeNull();

		snapshot.mockClear();
		expect(await undo(task())).toBe(true);
		expect(lastResult.value).toBeNull();
		expect(snapshot).toHaveBeenCalledOnce();
	});

	// nothing was removed, so nothing downstream should be told anything changed
	it('leaves everything alone when there was nothing to undo', async () => {
		undoToday.mockImplementation(async () => false);

		const { resolve, undo, lastResult } = useResolve();
		await resolve({ nudge: task(), outcome: 'passed' });
		snapshot.mockClear();

		expect(await undo(task())).toBe(false);
		expect(lastResult.value).not.toBeNull();
		expect(snapshot).not.toHaveBeenCalled();
	});
});

describe('refreshToday', () => {
	/**
	 * `ensure`, never `refresh`. The picker excludes anything already resolved today, so
	 * re-picking would drop the nudge just completed and swap a fresh one in - and the day's
	 * progress would never advance.
	 */
	it('ensures the day rather than re-picking it', () => {
		const { refreshToday } = useResolve();
		refreshToday();
		expect(ensure).toHaveBeenCalledOnce();
	});
});
