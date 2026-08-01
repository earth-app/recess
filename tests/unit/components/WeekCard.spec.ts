import { mountSuspended } from '@nuxt/test-utils/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WeekCard from '~/components/week/Card.vue';
import { summarizeWeek } from '~/composables/useWeek';
import type { LedgerEntry } from '~/types/context';
import { FIXED_NOW, entry } from '../helpers';

/**
 * One collapsed row in the Earlier Weeks archive, and what unfolding it costs.
 *
 * Three decisions matter here. The row has to name the week it opens, because up to twelve of them
 * stack in one list. The monday it names is derived from the iso week key rather than stored, so the
 * arithmetic is the contract - a week key is all the card gets. And the reflection is fetched on the
 * first open only, with the failure path landing on the deterministic line: the spinner it shows
 * while waiting has no other way out.
 */

const { reflection, entriesForWeek } = vi.hoisted(() => ({
	reflection: vi.fn(async (_week: string) => 'Three walks and a phone call.'),
	entriesForWeek: vi.fn((_week: string) => [] as LedgerEntry[])
}));

// summarizeWeek stays real; the card only reaches useWeek for the reflection
vi.mock('~/composables/useWeek', async (importOriginal) => {
	const actual = await importOriginal<typeof import('~/composables/useWeek')>();
	return { ...actual, useWeek: () => ({ reflection }) };
});

vi.mock('~/stores/progress', async (importOriginal) => {
	const actual = await importOriginal<typeof import('~/stores/progress')>();
	return { ...actual, useProgressStore: () => ({ entriesForWeek }) };
});

const WAITING = 'Putting your week into words';

type Wrapper = Awaited<ReturnType<typeof mountSuspended<typeof WeekCard>>>;

let mounted: Wrapper | null = null;

async function card(week = '2026-W31', entries: LedgerEntry[] = [entry()]) {
	mounted = await mountSuspended(WeekCard, { props: { summary: summarizeWeek(week, entries) } });
	return mounted;
}

const header = (w: Wrapper) => w.find('button');
const labelOf = (w: Wrapper) => w.findAll('button > span > span')[0]!.text();
const subtitleOf = (w: Wrapper) => w.findAll('button > span > span')[1]!.text();

async function toggle(w: Wrapper) {
	await header(w).trigger('click');
	await new Promise((resolve) => setTimeout(resolve, 0));
	await w.vm.$nextTick();
}

/** a promise the test decides the fate of, so the pending render is reachable */
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

beforeEach(() => {
	vi.clearAllMocks();
	reflection.mockResolvedValue('Three walks and a phone call.');
	entriesForWeek.mockReturnValue([]);
});

afterEach(() => {
	mounted?.unmount();
	mounted = null;
});

describe('the collapsed row', () => {
	it('starts closed, so the archive stays a list', async () => {
		const w = await card();
		expect(header(w).attributes('aria-expanded')).toBe('false');
		expect(w.text(), 'the week body rendered before it was asked for').not.toContain('The Mix');
	});

	it('asks for nothing until it is opened', async () => {
		await card();
		expect(reflection, 'twelve collapsed weeks each ran the model on mount').not.toHaveBeenCalled();
	});

	it('points its chevron the way it will move', async () => {
		const w = await card();
		expect(w.html()).toContain('i-mdi:chevron-down');

		await toggle(w);
		expect(w.html()).toContain('i-mdi:chevron-up');
	});
});

describe('the week it names', () => {
	// jan 4 is always inside iso week 1, which is what fixes the monday of week n
	it('names the monday the week started on', async () => {
		const w = await card('2026-W31');
		expect(labelOf(w)).toBe('Week of Jul 27');
	});

	it('steps back exactly seven days for the week before', async () => {
		const w = await card('2026-W30');
		expect(labelOf(w)).toBe('Week of Jul 20');
	});

	/**
	 * Iso week 1 of 2025 starts on Mon Dec 30, 2024. The month, the day and the year all differ
	 * from the key, so this is the case a naive `year-01-01 + weeks` would get wrong.
	 */
	it('crosses a year boundary the way iso weeks do', async () => {
		const w = await card('2025-W01');
		expect(labelOf(w)).toBe('Week of Dec 30');
	});

	it('falls back to the raw key rather than an invalid date', async () => {
		const w = await card('not-a-week');
		expect(labelOf(w), 'an unparseable key rendered a date anyway').toBe('not-a-week');
	});
});

describe('the count under the label', () => {
	it('says one nudge, not one nudges', async () => {
		const w = await card('2026-W31', [entry()]);
		expect(subtitleOf(w)).toBe('1 nudge');
	});

	it('pluralises above one', async () => {
		const w = await card('2026-W31', [entry({ id: 'a' }), entry({ id: 'b' })]);
		expect(subtitleOf(w)).toBe('2 nudges');
	});

	it('says zero nudges for a week with nothing resolved in it', async () => {
		const w = await card('2026-W31', []);
		expect(subtitleOf(w), 'an empty week rendered a bare number with no noun').toBe('0 nudges');
	});

	it('does not count a skip as a nudge', async () => {
		const w = await card('2026-W31', [entry({ outcome: 'skipped' })]);
		expect(subtitleOf(w)).toBe('0 nudges');
	});
});

/**
 * The bug this section exists for: the row carried a bare `aria-label` of "Open this Week", so all
 * twelve archive rows announced the same name and the visible date - the only thing that told them
 * apart - was hidden behind it. `nudge/Deck.vue` already composes `"<action>: <title>"` for exactly
 * this reason; it is also the only handle Maestro has, since it selects by accessible name.
 */
describe('the accessible name', () => {
	it('names which week it opens, not just that it opens one', async () => {
		const w = await card('2026-W31');
		expect(header(w).attributes('aria-label')).toBe('Open this Week: Week of Jul 27');
	});

	it('tells two rows in the same list apart', async () => {
		const first = await card('2026-W31');
		const firstName = header(first).attributes('aria-label');
		first.unmount();

		const second = await card('2026-W30');
		expect(
			header(second).attributes('aria-label'),
			'two archive rows announce the same name'
		).not.toBe(firstName);
	});

	it('offers to close once it is open, still naming the week', async () => {
		const w = await card('2026-W31');
		await toggle(w);
		expect(header(w).attributes('aria-label')).toBe('Close: Week of Jul 27');
		expect(header(w).attributes('aria-expanded')).toBe('true');
	});
});

describe('what unfolding shows', () => {
	it('renders the week totals, the mix and the highlights together', async () => {
		const w = await card('2026-W31', [entry({ category: 'nature', duration_minutes: 10 })]);
		await toggle(w);

		expect(w.text()).toContain('Nudges');
		expect(w.text()).toContain('The Mix');
		expect(w.text()).toContain('What you Made');
	});

	it('replays a submission from that week', async () => {
		const w = await card('2026-W31', [entry({ text: 'Eleven crows on one wire' })]);
		await toggle(w);
		expect(w.text()).toContain('Eleven crows on one wire');
	});

	it('folds the body away again on a second tap', async () => {
		const w = await card();
		await toggle(w);
		await toggle(w);

		expect(header(w).attributes('aria-expanded')).toBe('false');
		expect(w.text()).not.toContain('The Mix');
	});
});

describe('the reflection', () => {
	it('is fetched for this week only, and only on opening', async () => {
		const w = await card('2026-W30');
		await toggle(w);

		expect(reflection).toHaveBeenCalledOnce();
		expect(reflection).toHaveBeenCalledWith('2026-W30');
		expect(w.text()).toContain('Three walks and a phone call.');
	});

	it('shows the waiting line while it is still coming', async () => {
		const pending = deferred<string>();
		reflection.mockReturnValue(pending.promise);

		const w = await card();
		await toggle(w);

		expect(w.text()).toContain(WAITING);
		expect(w.find('ion-spinner').exists(), 'the waiting line has no spinner beside it').toBe(true);

		pending.resolve('Done thinking.');
		await new Promise((resolve) => setTimeout(resolve, 0));
		await w.vm.$nextTick();
		expect(w.text()).not.toContain(WAITING);
		expect(w.text()).toContain('Done thinking.');
	});

	/**
	 * The writing pack is optional and the model can fail mid-generation. A card that keeps
	 * spinning reads as the app being broken, so the failure lands on the deterministic line built
	 * from the ledger itself.
	 */
	it('never leaves a spinner running when the model fails', async () => {
		reflection.mockRejectedValue(new Error('no writing pack'));
		entriesForWeek.mockReturnValue([
			entry({ id: 'a', category: 'nature', at: FIXED_NOW.getTime() }),
			entry({ id: 'b', category: 'art', at: FIXED_NOW.getTime() - 86_400_000 }),
			entry({ id: 'c', category: 'art', at: FIXED_NOW.getTime() - 86_400_000 })
		]);

		const w = await card();
		await toggle(w);

		expect(w.text(), 'a failed reflection left the card spinning').not.toContain(WAITING);
		expect(w.text()).toContain('3 nudges across 2 days, spread over 2 different areas.');
	});

	it('reads the week off the summary when it falls back', async () => {
		reflection.mockRejectedValue(new Error('no writing pack'));
		const w = await card('2026-W29');
		await toggle(w);
		expect(entriesForWeek).toHaveBeenCalledWith('2026-W29');
	});

	// the model runs once per week, not once per tap
	it('is not re-run when the row is closed and opened again', async () => {
		const w = await card();
		await toggle(w);
		await toggle(w);
		await toggle(w);

		expect(reflection, 'reopening the row ran the model again').toHaveBeenCalledOnce();
		expect(w.text()).toContain('Three walks and a phone call.');
	});
});
