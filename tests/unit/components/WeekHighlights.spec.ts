import { mountSuspended } from '@nuxt/test-utils/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WeekHighlights from '~/components/week/Highlights.vue';
import { summarizeWeek } from '~/composables/useWeek';
import type { LedgerEntry } from '~/types/context';
import { FIXED_NOW, entry } from '../helpers';

/**
 * The week's replay of what the user actually submitted: text they wrote, counts they reported,
 * photos and clips they captured.
 *
 * Two properties are load-bearing. Nothing but a resolved submission may appear - a skipped nudge
 * left nothing behind, and showing it back would be the app inventing a keepsake. And a media path
 * that cannot be read or cannot be typed has to degrade to a card without media, never to a broken
 * `<img>`: the file lives on the device, so a photo lost to a reinstall or a cleared cache is a
 * normal outcome rather than an error state.
 */

const { readMedia } = vi.hoisted(() => ({
	readMedia: vi.fn(async (_path: string) => null as string | null)
}));

// readMedia is one export of a module the component tree also needs for capture
vi.mock('~/composables/useCapture', async (importOriginal) => {
	const actual = await importOriginal<typeof import('~/composables/useCapture')>();
	return { ...actual, readMedia };
});

const OCTET = 'data:application/octet-stream;base64,AAAA';

type Wrapper = Awaited<ReturnType<typeof mountSuspended<typeof WeekHighlights>>>;

let mounted: Wrapper | null = null;

async function highlights(entries: readonly LedgerEntry[]) {
	mounted = await mountSuspended(WeekHighlights, { props: { entries } });
	await settle();
	return mounted;
}

/** previews are read asynchronously, so give the loop a turn before asserting */
async function settle() {
	await new Promise((resolve) => setTimeout(resolve, 0));
	await mounted?.vm.$nextTick();
}

const cards = (w: Wrapper) => w.findAll('article');

/** the same formatter the component uses, so the expectation is timezone-independent */
const weekday = (at: number) =>
	new Intl.DateTimeFormat('en', { weekday: 'short' }).format(new Date(at));

beforeEach(() => {
	readMedia.mockReset();
	readMedia.mockResolvedValue(null);
});

afterEach(() => {
	mounted?.unmount();
	mounted = null;
});

describe('a week that left nothing behind', () => {
	it('says so, rather than rendering an empty section', async () => {
		const w = await highlights([]);
		expect(cards(w)).toHaveLength(0);
		expect(w.text(), 'an empty week rendered a bare heading with nothing under it').toContain(
			'Nothing left behind this week.'
		);
	});

	it('keeps its heading, so the page does not lose the section', async () => {
		const w = await highlights([]);
		expect(w.find('h2').text()).toBe('What you Made');
	});
});

describe('what a card shows', () => {
	it('renders one card per submission, newest first', async () => {
		const older = entry({
			id: 'nature.notice.a',
			text: 'The older one',
			at: FIXED_NOW.getTime() - 2 * 86_400_000
		});
		const newer = entry({ id: 'art.create.b', text: 'The newer one' });
		const w = await highlights(summarizeWeek('2026-W31', [older, newer]).highlights);

		expect(cards(w)).toHaveLength(2);
		expect(cards(w)[0]!.text()).toContain('The newer one');
		expect(cards(w)[1]!.text()).toContain('The older one');
	});

	it('names the category and the weekday it happened on', async () => {
		const at = FIXED_NOW.getTime();
		const w = await highlights([entry({ category: 'art', text: 'A drawing', at })]);
		const header = cards(w)[0]!.find('div');
		expect(header.text()).toBe(`Art${weekday(at)}`);
	});

	/**
	 * Zero is an answer, not an absence. Testing truthiness here instead of `!== undefined` would
	 * silently drop the one result a count nudge is most likely to produce.
	 */
	it('reports a counted zero as a real result', async () => {
		const w = await highlights([entry({ count: 0 })]);
		expect(w.text(), 'a reported zero vanished from the week').toContain('Counted 0');
	});

	it('counts upward too', async () => {
		const w = await highlights([entry({ count: 14 })]);
		expect(w.text()).toContain('Counted 14');
	});

	it('leaves the count line out when nothing was counted', async () => {
		const w = await highlights([entry({ text: 'Words only' })]);
		expect(w.text()).not.toContain('Counted');
	});

	it('renders no empty paragraph for a submission with no words', async () => {
		const w = await highlights([entry({ count: 3 })]);
		expect(cards(w)[0]!.find('p').exists(), 'an empty text paragraph rendered anyway').toBe(false);
	});

	it('never puts an undefined or a NaN in a card', async () => {
		const w = await highlights([entry({ count: 0 }), entry({ id: 'b', text: 'Something' })]);
		expect(w.text()).not.toMatch(/NaN|undefined|null/);
	});
});

describe('the media it replays', () => {
	it('retypes an image data url by its extension so the browser can decode it', async () => {
		readMedia.mockResolvedValue(OCTET);
		const w = await highlights([entry({ media: 'recess/media/a-1.png' })]);
		expect(w.find('img').attributes('src')).toBe('data:image/png;base64,AAAA');
	});

	it('treats a jpg as a jpeg, which is what the file actually is', async () => {
		readMedia.mockResolvedValue(OCTET);
		const w = await highlights([entry({ media: 'recess/media/a-1.jpg' })]);
		expect(w.find('img').attributes('src')).toBe('data:image/jpeg;base64,AAAA');
	});

	it('gives the image a name a screen reader can use', async () => {
		readMedia.mockResolvedValue(OCTET);
		const w = await highlights([entry({ media: 'recess/media/a-1.png' })]);
		expect(w.find('img').attributes('alt')).toBe('What you captured');
	});

	it('renders a player rather than an image for a recording', async () => {
		readMedia.mockResolvedValue(OCTET);
		const w = await highlights([entry({ media: 'recess/media/a-1.m4a' })]);
		expect(w.find('audio').attributes('src')).toBe('data:audio/mp4;base64,AAAA');
		expect(w.find('img').exists(), 'a clip rendered as an image').toBe(false);
	});

	// the file is gone, or the read failed; the submission is still real
	it('degrades to a card with no media when the file cannot be read', async () => {
		readMedia.mockResolvedValue(null);
		const w = await highlights([entry({ media: 'recess/media/gone.png', text: 'I took one' })]);

		expect(readMedia).toHaveBeenCalledWith('recess/media/gone.png');
		expect(w.find('img').exists(), 'an unreadable path rendered a broken image').toBe(false);
		expect(w.find('audio').exists()).toBe(false);
		expect(cards(w)[0]!.text()).toContain('I took one');
	});

	it('does not even try to read a path it cannot type', async () => {
		const w = await highlights([entry({ media: 'recess/media/a-1.bin' })]);
		expect(readMedia, 'an untypable extension was read anyway').not.toHaveBeenCalled();
		expect(w.find('img').exists()).toBe(false);
		expect(w.find('audio').exists()).toBe(false);
	});

	it('loads a preview for a submission that arrives after mount', async () => {
		const w = await highlights([entry({ id: 'a', text: 'First' })]);
		expect(w.find('img').exists()).toBe(false);

		readMedia.mockResolvedValue(OCTET);
		await w.setProps({ entries: [entry({ id: 'b', media: 'recess/media/b-1.webp' })] });
		await settle();

		expect(w.find('img').attributes('src')).toBe('data:image/webp;base64,AAAA');
	});
});

describe('what never appears', () => {
	// the ledger is the source; a skipped nudge produced nothing to replay
	it('leaves a skipped nudge out entirely', async () => {
		const kept = entry({ id: 'art.create.kept', text: 'I made a thing' });
		const skipped = entry({ id: 'art.create.gone', text: 'I bailed', outcome: 'skipped' });
		const w = await highlights(summarizeWeek('2026-W31', [kept, skipped]).highlights);

		expect(cards(w)).toHaveLength(1);
		expect(w.text(), 'a skipped nudge was replayed as a keepsake').not.toContain('I bailed');
	});

	it('leaves out a resolved nudge that left nothing behind', async () => {
		const plain = entry({ id: 'nature.think.plain' });
		const w = await highlights(summarizeWeek('2026-W31', [plain]).highlights);
		expect(cards(w)).toHaveLength(0);
		expect(w.text()).toContain('Nothing left behind this week.');
	});
});
