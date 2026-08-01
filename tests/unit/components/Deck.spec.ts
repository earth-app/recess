import { mountSuspended } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import NudgeDeck from '~/components/nudge/Deck.vue';
import { task, think } from '../helpers';

/**
 * The swipe deck's gesture arithmetic.
 *
 * Which way a card commits, and at what distance, is the app's signature interaction and had no
 * gate test - e2e drives it through a real pointer, which proves it works but not where the
 * boundaries are. The thresholds are the contract: past 110px the card leaves, under it the card
 * returns, and a move under 8px is a tap rather than a drag.
 */

const { swipe } = vi.hoisted(() => ({ swipe: vi.fn() }));
vi.mock('~/composables/useHaptics', () => ({
	useHaptics: () => ({
		swipe,
		success: vi.fn(),
		warning: vi.fn(),
		tap: vi.fn(),
		selection: vi.fn()
	})
}));

const COMMIT = 110;

async function deck(nudges = [task({ id: 'a' }), think({ id: 'b' }), task({ id: 'c' })]) {
	return mountSuspended(NudgeDeck, { props: { nudges } });
}

type Deck = Awaited<ReturnType<typeof deck>>;

/** the front card is the only one with pointer handlers */
const front = (w: Deck) => w.find('[role="button"]');

async function drag(w: Deck, dx: number, dy = 0) {
	const card = front(w);
	await card.trigger('pointerdown', { pointerId: 1, clientX: 0, clientY: 0 });
	await card.trigger('pointermove', { pointerId: 1, clientX: dx, clientY: dy });
	await card.trigger('pointerup', { pointerId: 1, clientX: dx, clientY: dy });
}

beforeEach(() => vi.clearAllMocks());

describe('which way a card commits', () => {
	it('opens when dragged right past the threshold', async () => {
		const w = await deck();
		await drag(w, COMMIT);
		expect(w.emitted('open')).toHaveLength(1);
		expect(w.emitted('skip')).toBeUndefined();
	});

	it('skips when dragged left past the threshold', async () => {
		const w = await deck();
		await drag(w, -COMMIT);
		expect(w.emitted('skip')).toHaveLength(1);
		expect(w.emitted('open')).toBeUndefined();
	});

	// under the threshold the card springs back and nothing is resolved
	it('does nothing when the drag falls short either way', async () => {
		for (const dx of [COMMIT - 1, -(COMMIT - 1)]) {
			const w = await deck();
			await drag(w, dx);
			expect(w.emitted('open'), `${dx}px opened a nudge`).toBeUndefined();
			expect(w.emitted('skip'), `${dx}px skipped a nudge`).toBeUndefined();
		}
	});

	it('commits exactly at the threshold, not one pixel past it', async () => {
		const w = await deck();
		await drag(w, COMMIT);
		expect(w.emitted('open'), 'the threshold itself should commit').toHaveLength(1);
	});

	it('emits the nudge that was actually on top', async () => {
		const first = task({ id: 'people.task.first' });
		const w = await deck([first, think({ id: 'second' })]);
		await drag(w, COMMIT);
		expect((w.emitted('open')![0] as unknown[])[0]).toMatchObject({ id: 'people.task.first' });
	});
});

describe('tap versus drag', () => {
	// a tap is a drag that barely moved; it opens rather than doing nothing
	it('treats a movement under 8px as a tap and opens', async () => {
		const w = await deck();
		await drag(w, 3, 2);
		expect(w.emitted('open')).toHaveLength(1);
	});

	it('treats a movement over 8px but under the threshold as an abandoned drag', async () => {
		const w = await deck();
		await drag(w, 20);
		expect(w.emitted('open')).toBeUndefined();
		expect(w.emitted('skip')).toBeUndefined();
	});

	/**
	 * The tap test sums both axes, so a mostly-vertical nudge still counts as movement. Otherwise
	 * a scroll that starts on the card would read as a tap and open a sheet the user never asked
	 * for.
	 */
	it('counts vertical movement toward the drag, not just horizontal', async () => {
		const w = await deck();
		await drag(w, 2, 40);
		expect(w.emitted('open'), 'a vertical scroll opened a nudge').toBeUndefined();
	});
});

describe('haptics', () => {
	it('fires once on a committed swipe, either direction', async () => {
		const opened = await deck();
		await drag(opened, COMMIT);
		expect(swipe).toHaveBeenCalledOnce();

		swipe.mockClear();
		const skipped = await deck();
		await drag(skipped, -COMMIT);
		expect(swipe).toHaveBeenCalledOnce();
	});

	it('stays silent on an abandoned drag and on a tap', async () => {
		const abandoned = await deck();
		await drag(abandoned, 20);
		expect(swipe).not.toHaveBeenCalled();

		const tapped = await deck();
		await drag(tapped, 1);
		expect(swipe, 'a tap is not a swipe').not.toHaveBeenCalled();
	});
});

describe('the stack', () => {
	it('shows at most three cards however many are left', async () => {
		const many = Array.from({ length: 6 }, (_, index) => task({ id: `n${index}` }));
		const w = await deck(many);
		expect(w.findAll('.origin-bottom')).toHaveLength(3);
	});

	it('renders fewer when fewer remain', async () => {
		const w = await deck([task({ id: 'only' })]);
		expect(w.findAll('.origin-bottom')).toHaveLength(1);
	});

	/**
	 * Only the front card carries copy. Rendering full cards behind it stacked three titles and
	 * three point pills within 12px of each other, and any translucency made all of them legible
	 * at once.
	 */
	it('leaves the cards behind the front one blank', async () => {
		const w = await deck();
		const backs = w.findAll('.nudge-back');
		expect(backs.length).toBeGreaterThan(0);
		for (const back of backs) expect(back.text()).toBe('');
	});

	// stated either way rather than omitted, which is valid and equivalent for the front card
	it('hides the cards behind the front one from assistive tech', async () => {
		const w = await deck();
		const cards = w.findAll('.origin-bottom');
		expect(cards[0]!.attributes('aria-hidden')).toBe('false');
		expect(cards[1]!.attributes('aria-hidden')).toBe('true');
		expect(cards[2]!.attributes('aria-hidden')).toBe('true');
	});

	it('renders nothing at all when the day is done', async () => {
		const w = await deck([]);
		expect(w.findAll('.origin-bottom')).toHaveLength(0);
	});
});

describe('the front card name', () => {
	/**
	 * `"<action>: <title>"`, which is both better for a screen reader than a bare title and the
	 * only handle Maestro has - it selects by accessible name, and the plain hint row below the
	 * deck also reads "Open this Nudge", so the card needs a name that is distinguishable.
	 */
	it('names itself with the action and the nudge title', async () => {
		const w = await deck([task({ title: 'Do a Thing' })]);
		expect(front(w).attributes('aria-label')).toMatch(/^Open this Nudge: /);
		expect(front(w).attributes('aria-label')).toContain('Do a Thing');
	});

	it('is a button, not a group, since it responds to a tap', async () => {
		const w = await deck();
		expect(front(w).attributes('role')).toBe('button');
	});
});
