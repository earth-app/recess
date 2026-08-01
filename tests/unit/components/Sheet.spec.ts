import { mountSuspended } from '@nuxt/test-utils/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NudgeSheet from '~/components/nudge/Sheet.vue';
import type { ResolveInput } from '~/composables/useResolve';
import type { Nudge } from '~/types/nudge';
import { question, task, think } from '../helpers';

/**
 * The nudge sheet: the busiest component in the app and the one with no tests.
 *
 * Its job is a small state machine - body, busy, missed, unavailable, passed - plus the two
 * guarded submit paths. Three properties here are load-bearing rather than cosmetic: a pass must
 * not flash the form back before its result, a failed validator must never resolve itself, and a
 * follow-up nudge already done today must not be offered again or its points bank twice.
 */

const validation = vi.hoisted(() => ({
	validating: false,
	warming: false,
	status: null as string | null
}));
const { resolve, skip, reset, resolved, find } = vi.hoisted(() => ({
	resolve: vi.fn(async (_input: ResolveInput) => ({
		points: 8,
		feedback: 'Nice.',
		unlocked: [],
		isNewBest: false
	})),
	skip: vi.fn(async () => ({ points: 0, feedback: '', unlocked: [], isNewBest: false })),
	reset: vi.fn(),
	resolved: new Set<string>(),
	find: vi.fn((id: string) => null as unknown)
}));

vi.mock('~/composables/useResolve', () => ({ useResolve: () => ({ resolve, skip }) }));
vi.mock('~/composables/useValidation', async () => {
	const { computed } = await import('vue');
	return {
		useValidation: () => ({
			validating: computed(() => validation.validating),
			warming: computed(() => validation.warming),
			status: computed(() => validation.status),
			run: vi.fn(),
			reset
		})
	};
});
vi.mock('~/stores/nudges', () => ({
	useNudgesStore: () => ({ resolvedIds: resolved, find })
}));

/**
 * Ionic's container components render as stubs in happy-dom and **swallow their slot content**,
 * so the whole sheet body - which lives inside `IonModal` - renders as nothing at all. These
 * passthroughs put the slots back without pretending to test Ionic: everything asserted below is
 * still the sheet's own decision.
 */
const passthrough = { template: '<div><slot /></div>' };

/**
 * A body that emits on command, so the verdict paths are reachable. The real bodies need a
 * camera, a recorder or a model; what the sheet does with their verdict is the part under test.
 */
const emitter = {
	props: ['nudge'],
	emits: ['verdict', 'resolved', 'leadsTo'],
	template: '<button data-testid="emit" @click="$emit(\'verdict\', payload, extras)" />',
	data: () => ({ payload: {} as unknown, extras: {} as unknown })
};

const stubs = {
	IonModal: passthrough,
	IonContent: passthrough,
	IonHeader: passthrough,
	IonToolbar: passthrough,
	IonButtons: passthrough,
	IonTitle: passthrough
};

type Wrapper = Awaited<ReturnType<typeof mountSuspended<typeof NudgeSheet>>>;

let mounted: Wrapper | null = null;

async function sheet(nudge: Nudge | null = task(), isOpen = true) {
	mounted = await mountSuspended(NudgeSheet, {
		props: { nudge, isOpen },
		global: { stubs }
	});
	return mounted;
}

const text = (w: Wrapper) => w.text();

beforeEach(() => {
	vi.clearAllMocks();
	validation.validating = false;
	validation.warming = false;
	validation.status = null;
	resolved.clear();
	find.mockImplementation(() => null);
	resolve.mockImplementation(async () => ({
		points: 8,
		feedback: 'Nice.',
		unlocked: [],
		isNewBest: false
	}));
	skip.mockImplementation(async () => ({
		points: 0,
		feedback: '',
		unlocked: [],
		isNewBest: false
	}));
});

afterEach(() => {
	mounted?.unmount();
	mounted = null;
});

describe('routing to a body', () => {
	// exactly one body renders per type; a fallthrough would show an empty sheet
	it('shows the prompt for the type it was given', async () => {
		const w = await sheet(think({ prompt: 'Think about a meal' }));
		expect(text(w)).toContain('Think about a meal');
	});

	it('shows a question and its actions', async () => {
		const w = await sheet(question({ question: 'Too many or not enough?' }));
		expect(text(w)).toContain('Too many or not enough?');
		expect(text(w)).toContain('Too many');
	});

	it('names the category', async () => {
		const w = await sheet(task({ category: 'cooking' }));
		expect(text(w)).toContain('Cooking');
	});

	it('renders nothing much with no nudge at all', async () => {
		const w = await sheet(null);
		expect(text(w)).not.toContain('Not Now');
	});

	it('shows the duration only when the nudge declares one', async () => {
		const withMinutes = await sheet(task({ duration_minutes: 20 }));
		expect(text(withMinutes)).toMatch(/20 min/);
		withMinutes.unmount();

		const without = await sheet(task());
		expect(without.text()).not.toMatch(/About \d+ min/);
	});
});

describe('the busy phase', () => {
	it('shows the warming message while a cold model loads', async () => {
		validation.warming = true;
		validation.validating = true;
		const w = await sheet();
		expect(text(w)).toContain('Warming Up the Model');
	});

	// the rotating status line, when there is one
	it('prefers the validator status over the generic line', async () => {
		validation.validating = true;
		validation.status = 'Finding the edges';
		const w = await sheet();
		expect(text(w)).toContain('Finding the edges');
	});

	it('falls back to a generic checking line with no status', async () => {
		validation.validating = true;
		const w = await sheet();
		expect(text(w)).toContain('Checking');
	});

	it('hides the form while busy', async () => {
		validation.validating = true;
		const w = await sheet(think({ prompt: 'A prompt' }));
		// v-show, so the node exists but is hidden
		const body = w.find('[style*="display: none"]');
		expect(body.exists()).toBe(true);
	});
});

describe('not now', () => {
	it('skips the nudge, reports the result and closes', async () => {
		const w = await sheet();
		await w
			.findAll('ion-button')
			.find((b) => b.text().includes('Not Now'))!
			.trigger('click');
		await w.vm.$nextTick();

		expect(skip).toHaveBeenCalledOnce();
		expect(w.emitted('resolved')).toHaveLength(1);
		expect(w.emitted('didDismiss')).toHaveLength(1);
	});

	// double-tapping must not bank two ledger entries
	it('ignores a second tap while the first is still running', async () => {
		let release = () => {};
		skip.mockImplementation(
			() =>
				new Promise((r) => {
					release = () => r({ points: 0, feedback: '', unlocked: [], isNewBest: false });
				})
		);

		const w = await sheet();
		const button = w.findAll('ion-button').find((b) => b.text().includes('Not Now'))!;
		await button.trigger('click');
		await button.trigger('click');

		expect(skip, 'a second tap started another skip').toHaveBeenCalledOnce();
		release();
	});

	it('does nothing at all with no nudge', async () => {
		const w = await sheet(null);
		expect(skip).not.toHaveBeenCalled();
		void w;
	});
});

describe('a reset between nudges', () => {
	/**
	 * Opening a different nudge, or reopening the sheet, has to clear the previous verdict -
	 * otherwise the next nudge opens already showing the last one's result.
	 */
	it('clears the validator when the nudge changes', async () => {
		const w = await sheet(task({ id: 'first' }));
		reset.mockClear();

		await w.setProps({ nudge: task({ id: 'second' }) });
		expect(reset).toHaveBeenCalled();
	});

	it('clears the validator when the sheet is reopened', async () => {
		const w = await sheet(task(), false);
		reset.mockClear();

		await w.setProps({ isOpen: true });
		expect(reset).toHaveBeenCalled();
	});
});

describe('dismissal', () => {
	it('reports a dismissal when the close button is used', async () => {
		const w = await sheet();
		const close = w.findAll('ion-button').find((b) => b.attributes('aria-label') === 'Close');
		expect(close, 'the sheet has no close button').toBeTruthy();

		await close!.trigger('click');
		expect(w.emitted('didDismiss')).toHaveLength(1);
	});
});

describe('the phase machine', () => {
	/** hand the sheet a verdict the way a body would */
	async function withVerdict(payload: unknown, nudge: Nudge | null = task()) {
		const w = await mountSuspended(NudgeSheet, {
			props: { nudge, isOpen: true },
			global: { stubs: { ...stubs, NudgeBodyTask: emitter } }
		});
		mounted = w;
		const body = w.findComponent(emitter);
		body.vm.payload = payload;
		await body.find('[data-testid="emit"]').trigger('click');
		await w.vm.$nextTick();
		return w;
	}

	it('shows the missed panel and its reason', async () => {
		const w = await withVerdict({ status: 'missed', detail: 'That was a screenshot.' });
		expect(text(w)).toContain("That didn't Quite Match");
		expect(text(w)).toContain('That was a screenshot.');
	});

	/**
	 * The fail-closed contract at the surface: an unavailable validator offers self-attestation
	 * and never resolves on its own.
	 */
	it('offers self-attestation when the validator could not run', async () => {
		const w = await withVerdict({ status: 'unavailable', reason: 'no vision pack' });
		expect(text(w)).toContain("We couldn't Check this One");
		expect(text(w)).toContain('Mark it Done Myself');
		expect(resolve, 'an unavailable verdict resolved itself').not.toHaveBeenCalled();
	});

	/**
	 * A pass holds the busy panel rather than dropping back to the form, because `resolve()`
	 * writes the feedback line before it returns - without the hold the form flashes back for a
	 * frame between the check and its result.
	 */
	it('stays busy after a pass instead of flashing the form back', async () => {
		const w = await withVerdict({ status: 'passed', score: 0.9 });
		expect(text(w)).toContain('Finishing Up');
		expect(text(w)).not.toContain("That didn't Quite Match");
	});

	it('reports the score against the threshold on a miss', async () => {
		const w = await withVerdict({ status: 'missed', score: 0.4, threshold: 0.62 });
		expect(text(w)).toMatch(/40%/);
		expect(text(w)).toMatch(/62%/);
	});

	it('says nothing about a score when the validator gave no numbers', async () => {
		const w = await withVerdict({ status: 'missed', detail: 'No match.' });
		expect(text(w)).not.toMatch(/Scored/);
	});

	it('lets a miss be retried, which clears the verdict', async () => {
		const w = await withVerdict({ status: 'missed', detail: 'Nope.' });
		const again = w.findAll('ion-button').find((b) => /Try Again|Again/i.test(b.text()));
		expect(again, 'a miss offers no way to try again').toBeTruthy();

		await again!.trigger('click');
		await w.vm.$nextTick();
		expect(text(w)).not.toContain('Nope.');
		expect(reset).toHaveBeenCalled();
	});

	it('self-attests through resolve with the unavailable verdict attached', async () => {
		const w = await withVerdict({ status: 'unavailable', reason: 'no pack' });
		const attest = w.findAll('ion-button').find((b) => b.text().includes('Mark it Done Myself'))!;

		await attest.trigger('click');
		await w.vm.$nextTick();

		expect(resolve).toHaveBeenCalledOnce();
		expect(resolve.mock.calls[0]![0]).toMatchObject({ outcome: 'self_attested' });
		expect(w.emitted('resolved')).toHaveLength(1);
	});

	// the same double-submit guard as Not Now
	it('ignores a second self-attest tap', async () => {
		let release = () => {};
		resolve.mockImplementation(
			() =>
				new Promise((r) => {
					release = () => r({ points: 5, feedback: '', unlocked: [], isNewBest: false });
				})
		);

		const w = await withVerdict({ status: 'unavailable', reason: 'no pack' });
		const attest = w.findAll('ion-button').find((b) => b.text().includes('Mark it Done Myself'))!;
		await attest.trigger('click');
		await attest.trigger('click');

		expect(resolve).toHaveBeenCalledOnce();
		release();
	});
});

describe('the follow-up nudge', () => {
	const chained = {
		props: ['nudge'],
		emits: ['leadsTo', 'resolved'],
		template: '<button data-testid="chain" @click="answer" />',
		methods: {
			answer(this: { $emit: (e: string, ...a: unknown[]) => void }) {
				this.$emit('leadsTo', 'people.task.next');
				this.$emit('resolved', { points: 5, feedback: '', unlocked: [], isNewBest: false });
			}
		}
	};

	/**
	 * The chain is answered AND resolved, because the follow-up is offered in the passed panel -
	 * a `leads_to` is a next step after finishing this one, not an alternative to it.
	 */
	async function withChain() {
		const w = await mountSuspended(NudgeSheet, {
			props: { nudge: question(), isOpen: true },
			global: { stubs: { ...stubs, NudgeBodyQuestion: chained } }
		});
		mounted = w;
		await w.find('[data-testid="chain"]').trigger('click');
		await w.vm.$nextTick();
		return w;
	}

	it('offers a chained nudge that has not been done today', async () => {
		find.mockImplementation(() => task({ id: 'people.task.next', title: 'Go Outside Now' }));
		const w = await withChain();
		expect(text(w)).toContain('Go Outside Now');
	});

	/**
	 * The double-award guard. A chained nudge already resolved today must not be offered again,
	 * or following the chain banks its points a second time.
	 */
	it('never offers one already resolved today', async () => {
		find.mockImplementation(() => task({ id: 'people.task.next', title: 'Go Outside Now' }));
		resolved.add('people.task.next');

		const w = await withChain();
		expect(text(w), 'a nudge resolved today was offered again').not.toContain('Go Outside Now');
	});

	it('offers nothing when the chain points at an unknown id', async () => {
		find.mockImplementation(() => null);
		const w = await withChain();
		expect(text(w)).not.toContain('Go Outside Now');
	});
});
