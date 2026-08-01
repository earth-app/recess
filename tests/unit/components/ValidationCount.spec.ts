import { mountSuspended } from '@nuxt/test-utils/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ValidationCount from '~/components/validation/Count.vue';
import type { ResolveInput } from '~/composables/useResolve';
import { pendingRunner, runner, task } from '../helpers';

/**
 * The count surface, and the one validator that needs no model at all - the range check is plain
 * arithmetic, so there is no self-attestation branch here and no pack to be missing.
 *
 * `parse` is the whole surface: it must tell "nothing entered" apart from "zero entered", since zero
 * is a legitimate answer to "how many did you see" and a `min` of 1 is the validator's job to
 * enforce, not the field's. The component deliberately does not clamp or hint at the range, because
 * `validateCount` explains a low or high answer itself.
 */

const { resolve } = vi.hoisted(() => ({
	resolve: vi.fn(async (_input: ResolveInput) => ({
		points: 6,
		feedback: 'Counted.',
		unlocked: [],
		isNewBest: false
	}))
}));

vi.mock('~/composables/useResolve', () => ({ useResolve: () => ({ resolve }) }));

const DATA = { min: 1, max: 40 };

/**
 * A real number field emitting the `ion-input` shape the component reads. The unit goes through the
 * default slot, not a named one: `slot="end"` is a plain attribute Ionic reads in its own shadow
 * root, so to Vue the span is just default slot content.
 */
const stubs = {
	IonInput: {
		props: ['value', 'disabled'],
		emits: ['ion-input'],
		template:
			'<div><input :value="value" :disabled="disabled" @input="$emit(\'ion-input\', { target: { value: $event.target.value } })" /><slot /></div>'
	}
};

type Wrapper = Awaited<ReturnType<typeof mountSuspended<typeof ValidationCount>>>;
let mounted: Wrapper | null = null;

async function field(run = runner({ status: 'passed', score: 1 }), props: { unit?: string } = {}) {
	mounted = await mountSuspended(ValidationCount, {
		props: { nudge: task(), data: DATA, run, ...props },
		global: { stubs }
	});
	return { w: mounted, run };
}

async function enter(w: Wrapper, raw: string) {
	await w.find('input').setValue(raw);
	await w.vm.$nextTick();
}

/** the handler guards on a null entry itself, so a disabled ion-button still reaches it */
const submit = (w: Wrapper) => w.findAll('ion-button').find((b) => /Check it/.test(b.text()))!;

beforeEach(() => {
	vi.clearAllMocks();
	resolve.mockImplementation(async () => ({
		points: 6,
		feedback: 'Counted.',
		unlocked: [],
		isNewBest: false
	}));
});

afterEach(() => {
	mounted?.unmount();
	mounted = null;
});

describe('what counts as an entry', () => {
	it('submits nothing when the field is untouched', async () => {
		const { w, run } = await field();
		await submit(w).trigger('click');
		expect(run, 'an empty field was submitted').not.toHaveBeenCalled();
	});

	it('submits nothing when the field is cleared again', async () => {
		const { w, run } = await field();
		await enter(w, '7');
		await enter(w, '');
		await submit(w).trigger('click');
		expect(run).not.toHaveBeenCalled();
	});

	/**
	 * Zero is an answer, not an absence. "How many did you spot" can honestly be none, and it is
	 * `validateCount` that decides whether a `min` of 1 rejects it - conflating the two would make a
	 * zero silently unsubmittable.
	 */
	it('treats zero as a real answer', async () => {
		const { w, run } = await field();
		await enter(w, '0');
		await submit(w).trigger('click');
		await vi.waitFor(() => expect(run).toHaveBeenCalled());

		expect((run.mock.calls[0] as unknown[])[1]).toMatchObject({ kind: 'count', value: 0 });
	});

	it('ignores text that is not a number', async () => {
		const { w, run } = await field();
		await enter(w, 'lots');
		await submit(w).trigger('click');
		expect(run).not.toHaveBeenCalled();
	});

	it('passes a number over the authored max straight through', async () => {
		const { w, run } = await field();
		await enter(w, '400');
		await submit(w).trigger('click');
		await vi.waitFor(() => expect(run).toHaveBeenCalled());

		// no clamping; validateCount is what says 400 is too many
		expect((run.mock.calls[0] as unknown[])[1]).toMatchObject({ value: 400 });
	});
});

describe('the unit', () => {
	it('names the thing being counted when the nudge says what it is', async () => {
		const { w } = await field(undefined, { unit: 'birds' });
		expect(w.text()).toContain('birds');
	});

	it('says nothing when the nudge names no unit', async () => {
		const { w } = await field();
		expect(w.text()).not.toMatch(/\bbirds\b/);
	});
});

describe('submitting', () => {
	it('records the count alongside the verdict on a pass', async () => {
		const { w } = await field();
		await enter(w, '12');
		await submit(w).trigger('click');
		await vi.waitFor(() => expect(w.emitted('resolved')).toHaveLength(1));

		expect(resolve.mock.calls[0]![0]).toMatchObject({ outcome: 'passed', count: 12 });
	});

	/**
	 * The count reaches the sheet even on a miss, because the sheet shows what was submitted next to
	 * why it did not count. Only `resolve` is withheld.
	 */
	it('reports the count on a miss but leaves the nudge unresolved', async () => {
		const run = runner({ status: 'missed', detail: 'That seems high.' });
		const { w } = await field(run);
		await enter(w, '99');
		await submit(w).trigger('click');
		await vi.waitFor(() => expect(w.emitted('verdict')).toHaveLength(1));

		expect(w.emitted('verdict')![0]![1]).toMatchObject({ count: 99 });
		expect(resolve).not.toHaveBeenCalled();
		expect(w.emitted('resolved')).toBeUndefined();
	});

	it('ignores a second tap while the first is in flight', async () => {
		const { run, release } = pendingRunner();
		const { w } = await field(run);
		await enter(w, '3');

		await submit(w).trigger('click');
		await submit(w).trigger('click');

		expect(run).toHaveBeenCalledOnce();
		release();
	});
});
