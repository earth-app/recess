import { mountSuspended } from '@nuxt/test-utils/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ValidationPhoto from '~/components/validation/Photo.vue';
import type { ResolveInput } from '~/composables/useResolve';
import { pendingRunner, runner, task } from '../helpers';

/**
 * The photo surface.
 *
 * The contract with teeth is what happens to the file. A missed photo is never written to disk,
 * because the user is about to retake it and nothing resurfaces a miss; a passed or unavailable one
 * is kept, because the Week tab replays it. Everything else here is about not stranding the user:
 * a denied camera, a cancelled camera and a missing vision pack all still end somewhere they can
 * finish the nudge.
 */

const { resolve, has, requirePermission, capture, persist } = vi.hoisted(() => ({
	resolve: vi.fn(async (_input: ResolveInput) => ({
		points: 12,
		feedback: 'Seen.',
		unlocked: [],
		isNewBest: false
	})),
	has: vi.fn(() => true),
	requirePermission: vi.fn(async () => true),
	capture: vi.fn(
		async () =>
			({
				blob: new Blob(['x'], { type: 'image/jpeg' }),
				preview: 'blob:shot'
			}) as unknown
	),
	persist: vi.fn(async () => 'file:///shot.jpg' as string | null)
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
	return { ...actual, capturePhoto: capture, persistMedia: persist };
});

const DATA = { labels: ['a photo of a bird on a branch'], threshold: 60 };

type Wrapper = Awaited<ReturnType<typeof mountSuspended<typeof ValidationPhoto>>>;
let mounted: Wrapper | null = null;

async function surface(run = runner({ status: 'passed', score: 0.8 })) {
	mounted = await mountSuspended(ValidationPhoto, {
		props: { nudge: task(), data: DATA, run }
	});
	return { w: mounted, run };
}

const button = (w: Wrapper, label: RegExp) =>
	w.findAll('ion-button').find((b) => label.test(b.text()));

async function shoot(w: Wrapper) {
	await button(w, /Take a Photo/)!.trigger('click');
	await vi.waitFor(() => expect(button(w, /Take Another/)).toBeTruthy());
}

beforeEach(() => {
	vi.clearAllMocks();
	has.mockReturnValue(true);
	requirePermission.mockImplementation(async () => true);
	capture.mockImplementation(async () => ({
		blob: new Blob(['x'], { type: 'image/jpeg' }),
		preview: 'blob:shot'
	}));
	persist.mockImplementation(async () => 'file:///shot.jpg');
	resolve.mockImplementation(async () => ({
		points: 12,
		feedback: 'Seen.',
		unlocked: [],
		isNewBest: false
	}));
});

afterEach(() => {
	mounted?.unmount();
	mounted = null;
});

describe('before a photo exists', () => {
	it('offers only the camera', async () => {
		const { w } = await surface();
		expect(button(w, /Take a Photo/)).toBeTruthy();
		expect(button(w, /Check it/), 'a check button with nothing to check').toBeUndefined();
	});

	it('asks for the camera before opening it', async () => {
		const { w } = await surface();
		await button(w, /Take a Photo/)!.trigger('click');
		await vi.waitFor(() => expect(requirePermission).toHaveBeenCalledWith('camera'));
		expect(capture).toHaveBeenCalledOnce();
	});
});

describe('when the camera will not open', () => {
	it('explains a denied camera and still lets the nudge be finished', async () => {
		requirePermission.mockImplementation(async () => false);
		const { w } = await surface();
		await button(w, /Take a Photo/)!.trigger('click');
		await vi.waitFor(() => expect(w.text()).toMatch(/camera/i));

		expect(capture, 'the camera opened without permission').not.toHaveBeenCalled();
		expect(button(w, /Mark it Done/), 'a denied camera left no way to finish').toBeTruthy();
	});

	/**
	 * Cancelling is a choice, not a failure. Reporting it as an error would tell the user something
	 * went wrong when they simply changed their mind.
	 */
	it('says nothing at all when the camera is cancelled', async () => {
		capture.mockImplementation(async () => null);
		const { w } = await surface();
		await button(w, /Take a Photo/)!.trigger('click');
		await vi.waitFor(() => expect(capture).toHaveBeenCalled());
		await w.vm.$nextTick();

		expect(w.text()).not.toMatch(/error|failed|couldn't/i);
		expect(button(w, /Take a Photo/), 'the camera button vanished after a cancel').toBeTruthy();
	});
});

describe('when the vision pack is missing', () => {
	// nothing can score the image, so the surface says so and switches to self-attestation
	it('names the gap and marks it done rather than checking it', async () => {
		has.mockReturnValue(false);
		const { w, run } = await surface();
		await shoot(w);

		expect(w.text()).toMatch(/isn't on this device|Vision|Photo/i);
		await button(w, /Mark it Done/)!.trigger('click');
		await vi.waitFor(() => expect(resolve).toHaveBeenCalled());

		expect(run, 'a missing pack still ran the validator').not.toHaveBeenCalled();
		expect(resolve.mock.calls[0]![0]).toMatchObject({ outcome: 'self_attested' });
	});

	it('keeps the photo it took, so the week can still replay it', async () => {
		has.mockReturnValue(false);
		const { w } = await surface();
		await shoot(w);
		await button(w, /Mark it Done/)!.trigger('click');
		await vi.waitFor(() => expect(resolve).toHaveBeenCalled());

		expect(resolve.mock.calls[0]![0]).toMatchObject({ media: 'file:///shot.jpg' });
	});
});

describe('submitting', () => {
	it('hands the validator the image blob', async () => {
		const { w, run } = await surface();
		await shoot(w);
		await button(w, /Check it/)!.trigger('click');
		await vi.waitFor(() => expect(run).toHaveBeenCalled());

		expect((run.mock.calls[0] as unknown[])[1]).toMatchObject({ kind: 'photo' });
	});

	it('keeps the photo and resolves on a pass', async () => {
		const { w } = await surface();
		await shoot(w);
		await button(w, /Check it/)!.trigger('click');
		await vi.waitFor(() => expect(w.emitted('resolved')).toHaveLength(1));

		expect(persist).toHaveBeenCalledOnce();
		expect(resolve.mock.calls[0]![0]).toMatchObject({
			outcome: 'passed',
			media: 'file:///shot.jpg'
		});
	});

	/**
	 * A missed photo is retaken, so writing it costs disk for a file nothing will ever read - the
	 * Week tab replays resolved submissions only.
	 */
	it('discards the photo on a miss and leaves the nudge unresolved', async () => {
		const run = runner({ status: 'missed', detail: 'No bird.' });
		const { w } = await surface(run);
		await shoot(w);
		await button(w, /Check it/)!.trigger('click');
		await vi.waitFor(() => expect(w.emitted('verdict')).toHaveLength(1));

		expect(persist, 'a missed photo was written to disk').not.toHaveBeenCalled();
		expect(resolve).not.toHaveBeenCalled();
		expect(w.emitted('resolved')).toBeUndefined();
	});

	// not the user's fault and retryable, so the shot survives
	it('keeps the photo when the check could not run', async () => {
		const run = runner({ status: 'unavailable', reason: 'clip failed' });
		const { w } = await surface(run);
		await shoot(w);
		await button(w, /Check it/)!.trigger('click');
		await vi.waitFor(() => expect(w.emitted('verdict')).toHaveLength(1));

		expect(persist).toHaveBeenCalledOnce();
		expect(resolve).not.toHaveBeenCalled();
	});

	it('resolves without media when the write fails', async () => {
		persist.mockImplementation(async () => null);
		const { w } = await surface();
		await shoot(w);
		await button(w, /Check it/)!.trigger('click');
		await vi.waitFor(() => expect(w.emitted('resolved')).toHaveLength(1));

		expect(resolve.mock.calls[0]![0]).toMatchObject({ media: undefined });
	});

	it('ignores a second tap while the first is in flight', async () => {
		const { run, release } = pendingRunner();
		const { w } = await surface(run);
		await shoot(w);

		const check = button(w, /Check it/)!;
		await check.trigger('click');
		await check.trigger('click');

		expect(run).toHaveBeenCalledOnce();
		release();
	});
});

describe('retaking', () => {
	it('offers a retake once a photo exists', async () => {
		const { w } = await surface();
		await shoot(w);
		expect(button(w, /Take Another/)).toBeTruthy();
	});

	/**
	 * The old preview url is revoked before the new one replaces it. Object urls live until revoked
	 * or the document unloads, so retaking six times would otherwise pin six images in memory.
	 */
	it('releases the previous preview when retaking', async () => {
		const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
		const { w } = await surface();
		await shoot(w);

		capture.mockImplementation(async () => ({
			blob: new Blob(['y'], { type: 'image/jpeg' }),
			preview: 'blob:second'
		}));
		await button(w, /Take Another/)!.trigger('click');
		await vi.waitFor(() => expect(revoke).toHaveBeenCalledWith('blob:shot'));

		revoke.mockRestore();
	});

	it('releases the preview when the sheet closes', async () => {
		const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
		const { w } = await surface();
		await shoot(w);

		w.unmount();
		mounted = null;
		expect(revoke).toHaveBeenCalledWith('blob:shot');
		revoke.mockRestore();
	});
});
