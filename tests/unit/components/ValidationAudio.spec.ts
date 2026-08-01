import { mountSuspended } from '@nuxt/test-utils/runtime';
import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ValidationAudio from '~/components/validation/Audio.vue';
import { MAX_RECORDING_SECONDS } from '~/composables/useCapture';
import type { ResolveInput } from '~/composables/useResolve';
import { pendingRunner, runner, task, type Runner } from '../helpers';

/**
 * The recording surface.
 *
 * Four contracts carry real weight. The clock is the only duration the user sees and the same value
 * the `min_seconds` gate reads, so they cannot disagree. The hard cap has to stop the recorder
 * itself, since nothing downstream truncates. A missed verdict must not leave the clip persisted -
 * the media is only kept for a submission that counted. And every failure route (permission,
 * recorder, missing pack) still ends at self-attestation rather than a dead end.
 */

const { resolve, has, requirePermission, start, stop, persist } = vi.hoisted(() => ({
	resolve: vi.fn(async (_input: ResolveInput) => ({
		points: 9,
		feedback: 'Heard.',
		unlocked: [],
		isNewBest: false
	})),
	has: vi.fn((_pack: string) => true),
	requirePermission: vi.fn(async () => true),
	start: vi.fn(async () => true),
	stop: vi.fn(
		async () =>
			({
				blob: new Blob(['x'], { type: 'audio/webm' }),
				seconds: 12,
				preview: 'blob:clip'
			}) as unknown
	),
	persist: vi.fn(async () => 'file:///clip.webm' as string | null)
}));

vi.mock('~/composables/useResolve', () => ({ useResolve: () => ({ resolve }) }));
vi.mock('~/stores/models', () => ({ useModelsStore: () => ({ has }) }));
vi.mock('~/composables/usePermissions', async (importOriginal) => {
	const actual = await importOriginal<typeof import('~/composables/usePermissions')>();
	return {
		...actual,
		usePermissions: () => ({ ...actual.usePermissions(), require: requirePermission })
	};
});
vi.mock('~/composables/useCapture', async (importOriginal) => {
	const actual = await importOriginal<typeof import('~/composables/useCapture')>();
	return { ...actual, startRecording: start, stopRecording: stop, persistMedia: persist };
});

const DATA = { rubric: [{ id: 'r', weight: 1, ideal: 'x' }], threshold: 65, min_seconds: 8 };

type Wrapper = Awaited<ReturnType<typeof mountSuspended<typeof ValidationAudio>>>;
let mounted: Wrapper | null = null;

/**
 * Timers are faked *after* mounting, never before: `mountSuspended` awaits Nuxt's own setup on real
 * timers, and installing the fakes first deadlocks the mount rather than failing it.
 */
async function surface(
	run = runner({ status: 'passed', score: 0.9 }),
	data: Partial<typeof DATA> = {}
) {
	mounted = await mountSuspended(ValidationAudio, {
		props: { nudge: task(), data: { ...DATA, ...data }, run }
	});
	vi.useFakeTimers();
	return { w: mounted, run };
}

const button = (w: Wrapper, label: RegExp) =>
	w.findAll('ion-button').find((b) => label.test(b.text()));

/** the timer ticks once a second, so elapsed time is driven rather than waited for */
async function record(w: Wrapper, seconds: number) {
	await button(w, /Record/)!.trigger('click');
	await w.vm.$nextTick();
	vi.advanceTimersByTime(seconds * 1000);
	await w.vm.$nextTick();
}

beforeEach(() => {
	vi.clearAllMocks();
	has.mockImplementation(() => true);
	requirePermission.mockImplementation(async () => true);
	start.mockImplementation(async () => true);
	stop.mockImplementation(async () => ({
		blob: new Blob(['x'], { type: 'audio/webm' }),
		seconds: 12,
		preview: 'blob:clip'
	}));
	persist.mockImplementation(async () => 'file:///clip.webm');
	resolve.mockImplementation(async () => ({
		points: 9,
		feedback: 'Heard.',
		unlocked: [],
		isNewBest: false
	}));
});

afterEach(() => {
	mounted?.unmount();
	mounted = null;
	vi.useRealTimers();
});

describe('the clock', () => {
	it('is hidden until there is something to time', async () => {
		const { w } = await surface();
		expect(w.text()).not.toContain('0:00');
	});

	it('counts up once a second while recording', async () => {
		const { w } = await surface();
		await record(w, 7);
		expect(w.text()).toContain('0:07');
	});

	// mm:ss, so a minute has to roll over rather than reading 0:83
	it('rolls over into minutes', async () => {
		const { w } = await surface();
		await record(w, 83);
		expect(w.text()).toContain('1:23');
	});

	/**
	 * After stopping, the clock switches from the tick count to the recorder's own reported length.
	 * They can differ by a fraction of a second, and the recorder's figure is the one the validator
	 * is handed, so the user must be shown that one.
	 */
	it('switches to the clip length once stopped', async () => {
		const { w } = await surface();
		await record(w, 7);
		await button(w, /Stop/)!.trigger('click');
		await vi.advanceTimersByTimeAsync(0);
		await w.vm.$nextTick();

		expect(w.text()).toContain('0:12');
	});
});

describe('the hard cap', () => {
	// nothing downstream truncates, so the client is the only place this can be enforced
	it('stops itself at the maximum', async () => {
		const { w } = await surface();
		await record(w, MAX_RECORDING_SECONDS);
		await vi.advanceTimersByTimeAsync(0);
		await w.vm.$nextTick();

		expect(stop).toHaveBeenCalledOnce();
		expect(button(w, /Stop/), 'still recording past the cap').toBeUndefined();
	});

	it('keeps ticking right up to it', async () => {
		const { w } = await surface();
		await record(w, MAX_RECORDING_SECONDS - 1);
		expect(stop).not.toHaveBeenCalled();
	});
});

describe('the minimum length', () => {
	it('says how long is needed before it is met', async () => {
		const { w } = await surface();
		expect(w.text()).toMatch(/8 second/i);
	});

	it('stops saying so once the clip is long enough', async () => {
		const { w } = await surface();
		await record(w, 9);
		await button(w, /Stop/)!.trigger('click');
		await vi.advanceTimersByTimeAsync(0);
		await w.vm.$nextTick();

		expect(w.text()).not.toMatch(/at least 8/i);
	});

	it('never submits a clip under the minimum', async () => {
		stop.mockImplementation(async () => ({
			blob: new Blob(['x'], { type: 'audio/webm' }),
			seconds: 3,
			preview: 'blob:clip'
		}));
		const { w, run } = await surface();
		await record(w, 3);
		await button(w, /Stop/)!.trigger('click');
		await vi.advanceTimersByTimeAsync(0);
		await w.vm.$nextTick();

		/**
		 * The button relabels itself rather than sitting there greyed out saying "Check it" - the
		 * reason it will not fire is on the control itself, so `submitLabel` is not what shows.
		 */
		const submit = button(w, /Hold on/)!;
		expect(submit, 'a short clip offered a check button').toBeTruthy();
		expect(button(w, /Check it/)).toBeUndefined();

		await submit.trigger('click');
		expect(
			run,
			'a three second clip was scored against an eight second floor'
		).not.toHaveBeenCalled();
	});

	it('has no floor at all when the nudge sets none', async () => {
		stop.mockImplementation(async () => ({
			blob: new Blob(['x'], { type: 'audio/webm' }),
			seconds: 1,
			preview: 'blob:clip'
		}));
		const { w, run } = await surface(undefined, { min_seconds: undefined });
		await record(w, 1);
		await button(w, /Stop/)!.trigger('click');
		await vi.advanceTimersByTimeAsync(0);
		await w.vm.$nextTick();

		await button(w, /Check it|Mark it Done/)!.trigger('click');
		await vi.advanceTimersByTimeAsync(0);
		expect(run).toHaveBeenCalledOnce();
	});
});

/** every one of these ends somewhere the user can still finish the nudge */
describe('when it cannot record', () => {
	it('explains a denied microphone and offers to mark it done', async () => {
		requirePermission.mockImplementation(async () => false);
		const { w } = await surface();
		await button(w, /Record/)!.trigger('click');
		await vi.advanceTimersByTimeAsync(0);
		await w.vm.$nextTick();

		expect(w.text()).toMatch(/microphone/i);
		expect(button(w, /Mark it Done/), 'a denied mic left no way to finish').toBeTruthy();
		expect(start, 'the recorder was started without permission').not.toHaveBeenCalled();
	});

	it('treats a recorder that will not start the same way', async () => {
		start.mockImplementation(async () => false);
		const { w } = await surface();
		await button(w, /Record/)!.trigger('click');
		await vi.advanceTimersByTimeAsync(0);
		await w.vm.$nextTick();

		expect(button(w, /Mark it Done/)).toBeTruthy();
	});

	it('reports a clip that did not save and still offers to mark it done', async () => {
		stop.mockImplementation(async () => null);
		const { w } = await surface();
		await record(w, 9);
		await button(w, /Stop/)!.trigger('click');
		await vi.advanceTimersByTimeAsync(0);
		await w.vm.$nextTick();

		expect(w.text()).toMatch(/didn't save/i);
		expect(button(w, /Mark it Done/)).toBeTruthy();
	});
});

/**
 * Scoring a transcript needs the transcriber and the embedder both, so either one missing drops the
 * surface to self-attestation. `is: ["audio", "text"]` in a nudge's filters is the same rule.
 */
describe('when a pack is missing', () => {
	it('names the audio pack when the transcriber is absent', async () => {
		has.mockImplementation((pack) => pack !== 'audio');
		const { w } = await surface();
		expect(w.text()).toMatch(/Speech|Audio/i);
	});

	it('names the text pack when only the embedder is absent', async () => {
		has.mockImplementation((pack) => pack !== 'text');
		const { w } = await surface();
		expect(w.text()).toMatch(/Writing|Text/i);
	});

	it('marks it done rather than checking it', async () => {
		has.mockImplementation(() => false);
		const { w, run } = await surface();
		await record(w, 9);
		await button(w, /Stop/)!.trigger('click');
		await vi.advanceTimersByTimeAsync(0);
		await w.vm.$nextTick();

		await button(w, /Mark it Done/)!.trigger('click');
		await vi.advanceTimersByTimeAsync(0);

		expect(run, 'a missing pack still ran the validator').not.toHaveBeenCalled();
		expect(resolve.mock.calls[0]![0]).toMatchObject({ outcome: 'self_attested' });
	});
});

describe('submitting', () => {
	async function ready(run?: Mock<Runner>) {
		const made = await surface(run);
		await record(made.w, 9);
		await button(made.w, /Stop/)!.trigger('click');
		await vi.advanceTimersByTimeAsync(0);
		await made.w.vm.$nextTick();
		return made;
	}

	it('hands the validator the blob and the recorder duration', async () => {
		const { w, run } = await ready();
		await button(w, /Check it/)!.trigger('click');
		await vi.advanceTimersByTimeAsync(0);

		expect((run.mock.calls[0] as unknown[])[1]).toMatchObject({
			kind: 'audio',
			durationSeconds: 12
		});
	});

	it('keeps the clip and resolves on a pass', async () => {
		const { w } = await ready();
		await button(w, /Check it/)!.trigger('click');
		await vi.advanceTimersByTimeAsync(0);
		await w.vm.$nextTick();

		expect(persist).toHaveBeenCalledOnce();
		expect(resolve.mock.calls[0]![0]).toMatchObject({
			outcome: 'passed',
			media: 'file:///clip.webm'
		});
		expect(w.emitted('resolved')).toHaveLength(1);
	});

	/**
	 * A missed clip is not written to disk. It would never be resurfaced anywhere - the Week tab
	 * replays resolved submissions only - so keeping it spends storage on a file nothing reads.
	 */
	it('discards the clip on a miss and leaves the nudge unresolved', async () => {
		const run = runner({ status: 'missed', detail: 'Nothing spoken.' });
		const { w } = await ready(run);
		await button(w, /Check it/)!.trigger('click');
		await vi.advanceTimersByTimeAsync(0);
		await w.vm.$nextTick();

		expect(persist, 'a missed clip was written to disk').not.toHaveBeenCalled();
		expect(w.emitted('verdict')).toHaveLength(1);
		expect(resolve).not.toHaveBeenCalled();
		expect(w.emitted('resolved')).toBeUndefined();
	});

	// keeps the clip, because an unavailable verdict is not the user's fault and may be retried
	it('keeps the clip when the check could not run', async () => {
		const run = runner({ status: 'unavailable', reason: 'no model' });
		const { w } = await ready(run);
		await button(w, /Check it/)!.trigger('click');
		await vi.advanceTimersByTimeAsync(0);
		await w.vm.$nextTick();

		expect(persist).toHaveBeenCalledOnce();
		expect(resolve).not.toHaveBeenCalled();
	});

	it('resolves without media when the clip could not be written', async () => {
		persist.mockImplementation(async () => null);
		const { w } = await ready();
		await button(w, /Check it/)!.trigger('click');
		await vi.advanceTimersByTimeAsync(0);
		await w.vm.$nextTick();

		expect(resolve.mock.calls[0]![0]).toMatchObject({ media: undefined });
		expect(w.emitted('resolved'), 'a failed write blocked the reward').toHaveLength(1);
	});

	it('ignores a second tap while the first is in flight', async () => {
		const { run, release } = pendingRunner();
		const { w } = await ready(run);

		const check = button(w, /Check it/)!;
		await check.trigger('click');
		await check.trigger('click');

		expect(run).toHaveBeenCalledOnce();
		release();
	});
});

describe('leaving the sheet mid-recording', () => {
	/**
	 * Unmounting while live has to stop the recorder and drop the interval. A running MediaRecorder
	 * holds the microphone open, and the indicator stays lit long after the sheet is gone.
	 */
	it('stops the recorder and clears the timer', async () => {
		const { w } = await surface();
		await record(w, 4);

		w.unmount();
		mounted = null;
		expect(stop).toHaveBeenCalledOnce();

		vi.advanceTimersByTime(5000);
		expect(stop, 'the interval outlived the component').toHaveBeenCalledOnce();
	});

	it('stops nothing when it was never recording', async () => {
		const { w } = await surface();
		w.unmount();
		mounted = null;
		expect(stop).not.toHaveBeenCalled();
	});
});
