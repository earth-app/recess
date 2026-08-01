import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it } from 'vitest';
import StreakStrip from '~/components/ui/StreakStrip.vue';
import type { StreakDay } from '~/types/context';

/**
 * The week strip: four day states mapped to four fills, plus the screen-reader summary.
 *
 * Ionic renders as stubs in happy-dom, but nothing here is Ionic - every assertion is on what
 * the component itself decides, which is exactly the part worth pinning.
 */

function days(...states: StreakDay['state'][]): StreakDay[] {
	// july 2026 starts on a wednesday, so these keys give a stable weekday sequence
	return states.map((state, index) => ({
		day: `2026-07-${String(20 + index).padStart(2, '0')}`,
		state
	}));
}

type StripProps = InstanceType<typeof StreakStrip>['$props'];

async function strip(props: Partial<StripProps> & { days: readonly StreakDay[] }) {
	return mountSuspended(StreakStrip, { props });
}

/** the dots are the only styled spans; the weekday letters carry classes only */
type Wrapper = Awaited<ReturnType<typeof strip>>;
const dotsOf = (w: Wrapper) => w.findAll('span[style]').map((el) => el.attributes('style') ?? '');
const summaryOf = (w: Wrapper) => w.find('.sr-only').text();

describe('the dots', () => {
	it('renders one per day', async () => {
		const w = await strip({ days: days('filled', 'grace', 'empty', 'future') });
		expect(dotsOf(w)).toHaveLength(4);
	});

	// the strip is a week; a longer ledger slice must not stretch it
	it('shows only the last seven days', async () => {
		const w = await strip({ days: days(...Array(10).fill('filled')) });
		expect(dotsOf(w)).toHaveLength(7);
	});

	it('gives each state its own fill', async () => {
		const w = await strip({ days: days('filled', 'grace', 'empty', 'future'), markToday: false });
		const dots = dotsOf(w);
		expect(new Set(dots).size, 'two states rendered identically').toBe(4);
	});

	/**
	 * A grace day is covered, not missed. It is ringed rather than filled so it reads as
	 * different from both a completed day and a quiet one - the streak design is forgiving by
	 * construction and the strip has to show that.
	 */
	it('rings a grace day instead of marking it', async () => {
		const w = await strip({ days: days('grace'), markToday: false });
		expect(dotsOf(w)[0]).toContain('inset');
	});

	it('outlines the trailing day when it is today', async () => {
		const marked = await strip({ days: days('filled', 'filled'), markToday: true });
		const dots = dotsOf(marked);
		expect(dots[1], 'today was not outlined').toContain('outline');
		expect(dots[0], 'a past day should not be outlined').not.toContain('outline');
	});

	it('outlines nothing when the strip is not the live week', async () => {
		const w = await strip({ days: days('filled', 'filled'), markToday: false });
		expect(w.html()).not.toContain('outline');
	});
});

describe('the weekday letters', () => {
	/**
	 * Day keys are plain dates, so the letter has to be read back in UTC. Formatting them in
	 * local time slips the whole row by a day for anyone west of UTC - the same class of bug
	 * that made the day ring reset at 19:00.
	 */
	it('reads the letter in UTC, not local time', async () => {
		const w = await strip({ days: days('filled'), showLetters: true });
		const expected = new Intl.DateTimeFormat('en', {
			weekday: 'narrow',
			timeZone: 'UTC'
		}).format(new Date('2026-07-20'));
		expect(w.text()).toContain(expected);
	});

	it('can be turned off for a compact row', async () => {
		const shown = await strip({ days: days('filled'), showLetters: true });
		const hidden = await strip({ days: days('filled'), showLetters: false });
		expect(hidden.html().length).toBeLessThan(shown.html().length);
	});
});

describe('the screen-reader summary', () => {
	it('counts each state separately', async () => {
		const w = await strip({
			days: days('filled', 'filled', 'grace', 'empty', 'future'),
			markToday: false
		});
		const text = summaryOf(w);
		expect(text).toContain('2 days done');
		expect(text).toContain('1 rest day');
		expect(text).toContain('1 quiet day');
		expect(text).toContain('1 day still ahead');
	});

	it('singularises a count of one', async () => {
		const w = await strip({ days: days('filled'), markToday: false });
		expect(summaryOf(w)).toContain('1 day done');
	});

	it('pluralises above one', async () => {
		const w = await strip({ days: days('filled', 'filled'), markToday: false });
		expect(summaryOf(w)).toContain('2 days done');
	});

	// omitted rather than reported as zero, so the sentence stays short
	it('leaves out the states with no days', async () => {
		const w = await strip({ days: days('filled'), markToday: false });
		const text = summaryOf(w);
		expect(text).not.toContain('rest');
		expect(text).not.toContain('quiet');
		expect(text).not.toContain('ahead');
	});

	it('says something rather than nothing for an empty week', async () => {
		const w = await strip({ days: [] });
		expect(summaryOf(w)).toBe('No days to show yet');
	});
});

describe('the visible label', () => {
	it('renders when given and is absent otherwise', async () => {
		const withLabel = await strip({ days: days('filled'), label: 'Start Something Today' });
		expect(withLabel.text()).toContain('Start Something Today');

		const without = await strip({ days: days('filled') });
		expect(without.text()).not.toContain('Start Something Today');
	});
});

describe('the colour prop', () => {
	// authored tokens resolve through colors.json; a raw css var is already usable as-is
	it('accepts an authored token and a css variable alike', async () => {
		const token = await strip({ days: days('filled'), color: '@green', markToday: false });
		const cssVar = await strip({
			days: days('filled'),
			color: 'var(--ion-color-success)',
			markToday: false
		});

		expect(dotsOf(token)[0]).toMatch(/#|rgb/);
		expect(dotsOf(cssVar)[0]).toContain('var(--ion-color-success)');
	});

	/**
	 * Only the ring is asserted, because the translucent fill is not observable in this
	 * environment. `withAlpha` emits modern slash-alpha (`rgb(45 153 115 / 0.35)`) and the css-var
	 * branch emits `color-mix(...)`; happy-dom's style parser drops both, while keeping the
	 * opaque `rgb(r g b)` a filled day uses. Real browsers render both - the tinted icon wells
	 * built on `withAlpha` are visible in the Pixel 7 screenshots - so this is an environment
	 * limit, not a defect, and the fill belongs to tests/e2e/theme.spec.ts.
	 */
	it('rings a grace day whichever colour form it is given', async () => {
		for (const color of ['@green', 'var(--ion-color-success)']) {
			const w = await strip({ days: days('grace'), color, markToday: false });
			expect(dotsOf(w)[0], `${color} lost the grace ring`).toContain('inset');
		}
	});
});
