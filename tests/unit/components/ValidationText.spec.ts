import { mountSuspended } from '@nuxt/test-utils/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ValidationText from '~/components/validation/Text.vue';
import type { ResolveInput } from '~/composables/useResolve';
import { textLengthWindow } from '~/utils/validate';
import { pendingRunner, runner, task } from '../helpers';

/**
 * The written-answer surface.
 *
 * Two contracts matter. The counter derives its minimum from `textLengthWindow`, the same clamp
 * the validator applies, so it can never tell someone they are ready when the validator would
 * refuse the length. And `submit` emits its verdict either way but only *resolves* on a pass - a
 * miss must leave the nudge unresolved.
 */

const { resolve, has } = vi.hoisted(() => ({
	resolve: vi.fn(async (_input: ResolveInput) => ({
		points: 8,
		feedback: 'Nice.',
		unlocked: [],
		isNewBest: false
	})),
	has: vi.fn(() => true)
}));

vi.mock('~/composables/useResolve', () => ({ useResolve: () => ({ resolve }) }));
vi.mock('~/stores/models', () => ({ useModelsStore: () => ({ has }) }));

const DATA = { rubric: [{ id: 'r', weight: 1, ideal: 'x' }], threshold: 62, min_length: 80 };

/**
 * A real `<textarea>` in place of `IonTextarea`, emitting the `ion-input` shape the component
 * reads (`event.target.value`). Ionic's own element is a stub here, so without this the field is
 * not typeable and every submit path is unreachable.
 */
const stubs = {
	IonTextarea: {
		emits: ['ion-input'],
		template:
			'<textarea @input="$emit(\'ion-input\', { target: { value: $event.target.value } })" />'
	}
};

type Wrapper = Awaited<ReturnType<typeof mountSuspended<typeof ValidationText>>>;
let mounted: Wrapper | null = null;

async function field(run = runner({ status: 'passed', score: 0.9 })) {
	mounted = await mountSuspended(ValidationText, {
		props: { nudge: task(), data: DATA, run },
		global: { stubs }
	});
	return { w: mounted, run };
}

async function type(w: Wrapper, value: string) {
	await w.find('textarea').setValue(value);
	await w.vm.$nextTick();
}

const long = 'a'.repeat(120);

/** the handlers guard on `met` themselves, so a disabled ion-button still reaches them */
const button = (w: Wrapper, label: RegExp) =>
	w.findAll('ion-button').find((b) => label.test(b.text()));

beforeEach(() => {
	vi.clearAllMocks();
	has.mockReturnValue(true);
	resolve.mockImplementation(async () => ({
		points: 8,
		feedback: 'Nice.',
		unlocked: [],
		isNewBest: false
	}));
});

afterEach(() => {
	mounted?.unmount();
	mounted = null;
});

describe('the counter', () => {
	it('takes its minimum from the validator clamp, not the raw field', async () => {
		const { w } = await field();
		expect(w.text()).toContain(String(textLengthWindow(DATA).min));
	});

	it('counts trimmed characters, so whitespace cannot reach the minimum', async () => {
		const { w } = await field();
		await type(w, ' '.repeat(200));
		expect(w.text(), '200 spaces counted as content').toContain(`0 of ${DATA.min_length}`);
	});

	it('switches message once the minimum is met', async () => {
		const { w } = await field();
		await type(w, long);
		expect(w.text()).toMatch(/\d+ characters/);
	});
});

describe('when the text pack is missing', () => {
	/**
	 * Fail-closed at the surface: with no embedder there is nothing to score against, so the
	 * check button is not offered at all and self-attestation is the only route.
	 */
	it('offers no check button, only self-attestation', async () => {
		has.mockReturnValue(false);
		const { w } = await field();

		expect(button(w, /Check it/)).toBeUndefined();
		expect(button(w, /Mark it Done Myself/), 'no way to finish without a model').toBeTruthy();
	});

	it('says why the check is unavailable', async () => {
		has.mockReturnValue(false);
		const { w } = await field();
		expect(w.text()).toMatch(/isn't on this device|nothing here to check/i);
	});
});

describe('submitting', () => {
	it('does nothing until the minimum is met', async () => {
		const { w, run } = await field();
		await type(w, 'too short');
		await button(w, /Check it/)!.trigger('click');
		expect(run, 'a short answer was submitted').not.toHaveBeenCalled();
	});

	it('runs the validator with the trimmed text', async () => {
		const { w, run } = await field();
		await type(w, `  ${long}  `);
		await button(w, /Check it/)!.trigger('click');
		await w.vm.$nextTick();

		expect(run).toHaveBeenCalledOnce();
		expect((run.mock.calls[0] as unknown[])[1]).toMatchObject({ kind: 'text', text: long });
	});

	it('resolves on a pass', async () => {
		const { w } = await field();
		await type(w, long);
		await button(w, /Check it/)!.trigger('click');
		await w.vm.$nextTick();
		await w.vm.$nextTick();

		expect(resolve).toHaveBeenCalledOnce();
		expect(resolve.mock.calls[0]![0]).toMatchObject({ outcome: 'passed' });
		expect(w.emitted('resolved')).toHaveLength(1);
	});

	// the sheet shows the miss panel; the nudge stays open and unresolved
	it('reports a miss but never resolves it', async () => {
		const run = runner({ status: 'missed', detail: 'Too vague.' });
		const { w } = await field(run);
		await type(w, long);
		await button(w, /Check it/)!.trigger('click');
		await w.vm.$nextTick();

		expect(w.emitted('verdict')).toHaveLength(1);
		expect(resolve, 'a missed answer resolved anyway').not.toHaveBeenCalled();
		expect(w.emitted('resolved')).toBeUndefined();
	});

	it('reports an unavailable verdict without resolving either', async () => {
		const run = runner({ status: 'unavailable', reason: 'embed failed' });
		const { w } = await field(run);
		await type(w, long);
		await button(w, /Check it/)!.trigger('click');
		await w.vm.$nextTick();

		expect(w.emitted('verdict')).toHaveLength(1);
		expect(resolve).not.toHaveBeenCalled();
	});

	it('ignores a second tap while the first is in flight', async () => {
		const { run, release } = pendingRunner();

		const { w } = await field(run);
		await type(w, long);
		const check = button(w, /Check it/)!;
		await check.trigger('click');
		await check.trigger('click');

		expect(run).toHaveBeenCalledOnce();
		release();
	});
});

/**
 * Self-attestation is the `v-else` of the check button: with a text pack you get checked, without
 * one you mark it done yourself. There is deliberately never both.
 */
describe('self-attesting, which only appears without a pack', () => {
	beforeEach(() => has.mockReturnValue(false));

	it('resolves with the self-attested outcome and the trimmed text', async () => {
		const { w } = await field();
		await type(w, `  ${long}  `);

		await button(w, /Mark it Done Myself/)!.trigger('click');
		await w.vm.$nextTick();

		expect(resolve.mock.calls[0]![0]).toMatchObject({ outcome: 'self_attested', text: long });
	});

	// the length rule still applies; attesting is not a way around writing something
	it('still requires the minimum', async () => {
		const { w } = await field();
		await type(w, 'nope');

		await button(w, /Mark it Done Myself/)!.trigger('click');
		expect(resolve).not.toHaveBeenCalled();
	});
});
