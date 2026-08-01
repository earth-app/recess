import { mountSuspended } from '@nuxt/test-utils/runtime';
import { afterEach, describe, expect, it } from 'vitest';
import NudgeList from '~/components/nudge/List.vue';
import type { Nudge } from '~/types/nudge';
import { question, task, think } from '../helpers';

/**
 * The day's whole slate, as a list rather than a deck.
 *
 * Its only decision is resolved versus open, and that decision is load-bearing in two directions.
 * A resolved row must read as finished (and say so to a screen reader, since a line through text
 * carries nothing into the accessibility tree), and it must stop being a control - the sheet has no
 * review state, so reopening a done nudge would offer the same resolution again and bank its points
 * a second time. `progress.record` has no dedupe to catch that.
 */

/** Ionic's list, item and label all swallow their slots, so the rows never reach the dom without these */
const passthrough = { template: '<div><slot /></div>' };
const stubs = {
	IonList: passthrough,
	IonLabel: passthrough,
	// keeps the row's own attributes queryable; `button` is what Ionic turns into a focusable button
	IonItem: { template: '<div class="row"><slot /></div>' }
};

type Wrapper = Awaited<ReturnType<typeof mountSuspended<typeof NudgeList>>>;
let mounted: Wrapper | null = null;

async function list(nudges: Nudge[], resolved: string[] = []) {
	mounted = await mountSuspended(NudgeList, {
		props: { nudges, resolvedIds: new Set(resolved) },
		global: { stubs }
	});
	return mounted;
}

const rows = (w: Wrapper) => w.findAll('.row');

afterEach(() => {
	mounted?.unmount();
	mounted = null;
});

describe('a row', () => {
	it('names the nudge, its category and what it is worth', async () => {
		const w = await list([task({ title: 'Ask About Nine', category: 'errands', points: 12 })]);
		const text = rows(w)[0]!.text();

		expect(text).toContain('Ask About Nine');
		expect(text).toContain('Errands');
		expect(text).toContain('+12');
	});

	// each type keeps its text under a different key, so the list uses nudgeTitle rather than `title`
	it('titles a think by its prompt and a question by its question', async () => {
		const w = await list([
			think({ id: 'a', prompt: 'Think of a song everyone agrees is bad' }),
			question({ id: 'b', question: 'Is 100 friends too many?' })
		]);

		expect(rows(w)[0]!.text()).toContain('Think of a song everyone agrees is bad');
		expect(rows(w)[1]!.text()).toContain('Is 100 friends too many?');
	});

	it('keeps the order it was handed', async () => {
		const w = await list([
			task({ id: 'a', title: 'First' }),
			task({ id: 'b', title: 'Second' }),
			task({ id: 'c', title: 'Third' })
		]);

		expect(rows(w).map((row) => row.find('p').text())).toEqual(['First', 'Second', 'Third']);
	});

	it('draws a divider under every row but the last', async () => {
		const w = await list([task({ id: 'a' }), task({ id: 'b' }), task({ id: 'c' })]);
		expect(rows(w).map((row) => row.attributes('lines'))).toEqual(['full', 'full', 'none']);
	});
});

describe('a resolved row', () => {
	const both = () => list([task({ id: 'open' }), think({ id: 'done' })], ['done']);

	it('strikes the title through and swaps the icon for a check', async () => {
		const w = await both();
		const [open, done] = rows(w);

		expect(done!.find('p').classes()).toContain('line-through!');
		expect(done!.html()).toContain('i-mdi:check-bold');
		expect(open!.find('p').classes(), 'an open row was struck through').not.toContain(
			'line-through!'
		);
		expect(open!.html()).toContain('i-mdi:hand-wave');
	});

	/**
	 * The check mark is `aria-hidden` and a line through text carries nothing into the accessibility
	 * tree, so without this the two rows are indistinguishable to anything that is not looking.
	 */
	it('says it is done rather than only showing it', async () => {
		const w = await both();
		const [open, done] = rows(w);

		expect(done!.find('.sr-only\\!').text()).toBe('Done');
		expect(open!.find('.sr-only\\!').exists(), 'an open row claimed to be done').toBe(false);
	});

	it('tints itself and leaves an open row transparent', async () => {
		const w = await both();
		const [open, done] = rows(w);

		expect(done!.attributes('style')).toContain('var(--ion-color-success)');
		expect(open!.attributes('style')).toContain('--background: transparent');
	});

	// Ionic only renders a focusable native button when `button` is set, so this is the whole
	// difference between a control and a static row
	it('is not offered as a control at all', async () => {
		const w = await both();
		const [open, done] = rows(w);

		expect(open!.attributes('button')).toBe('true');
		expect(done!.attributes('button'), 'a finished row is still a button').toBe('false');
	});

	it('cannot be reopened for resolution', async () => {
		const w = await both();
		await rows(w)[1]!.trigger('click');

		expect(
			w.emitted('open'),
			'a resolved nudge reopened, which banks its points twice'
		).toBeUndefined();
	});

	it('does not stop the open rows beside it from opening', async () => {
		const w = await both();
		await rows(w)[0]!.trigger('click');

		expect(w.emitted('open')).toHaveLength(1);
		expect((w.emitted('open')![0] as unknown[])[0]).toMatchObject({ id: 'open' });
	});
});

describe('reachability', () => {
	/**
	 * An `ion-item[button]` takes its accessible name from the text slotted into it, which is also
	 * the only handle Maestro and Playwright have on a row.
	 */
	it('gives every open row a name a screen reader can read', async () => {
		const w = await list([
			task({ id: 'a', title: 'Ask About Nine' }),
			think({ id: 'b', prompt: 'Think of a song' })
		]);

		for (const row of rows(w)) {
			expect(row.attributes('button'), 'an open row is not keyboard reachable').toBe('true');
			expect(row.text().trim().length, 'a tappable row with no accessible name').toBeGreaterThan(0);
		}
	});

	it('opens the nudge that was actually tapped', async () => {
		const w = await list([task({ id: 'first' }), task({ id: 'second' }), task({ id: 'third' })]);
		await rows(w)[2]!.trigger('click');

		expect((w.emitted('open')![0] as unknown[])[0]).toMatchObject({ id: 'third' });
	});
});

describe('an empty day', () => {
	it('renders no rows and no copy of its own', async () => {
		const w = await list([]);

		expect(rows(w)).toHaveLength(0);
		expect(w.text().trim(), 'the empty case belongs to the page, not the list').toBe('');
	});

	// every row resolved is still every row; the page swaps in its own caught-up state
	it('renders the whole slate when all of it is resolved', async () => {
		const w = await list([task({ id: 'a' }), task({ id: 'b' })], ['a', 'b']);

		expect(rows(w)).toHaveLength(2);
		expect(rows(w).every((row) => row.attributes('button') === 'false')).toBe(true);
		expect(w.emitted('open')).toBeUndefined();
	});
});
