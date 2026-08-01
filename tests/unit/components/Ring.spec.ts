import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it } from 'vitest';
import Ring from '~/components/ui/Ring.vue';

/**
 * The day ring's arc arithmetic.
 *
 * Thirteen computeds of pure geometry with no gate coverage. The interesting cases are the
 * degenerate ones - a zero max divides, a thickness wider than the ring goes negative - and both
 * would render a `NaN` stroke, which draws nothing at all rather than failing loudly.
 */

type RingProps = InstanceType<typeof Ring>['$props'];

async function ring(props: Partial<RingProps> & { value: number; max: number }) {
	return mountSuspended(Ring, { props });
}

type Wrapper = Awaited<ReturnType<typeof ring>>;

const arc = (w: Wrapper) => w.findAll('circle')[1]!;
const dash = (w: Wrapper) => Number(arc(w).attributes('stroke-dasharray'));
const offset = (w: Wrapper) => Number(arc(w).attributes('stroke-dashoffset'));
const centreText = (w: Wrapper) => w.find('span').text();

describe('the arc', () => {
	it('is fully offset at zero, so nothing is drawn', async () => {
		const w = await ring({ value: 0, max: 4 });
		expect(offset(w)).toBeCloseTo(dash(w), 5);
	});

	it('is not offset at all when complete', async () => {
		const w = await ring({ value: 4, max: 4 });
		expect(offset(w)).toBeCloseTo(0, 5);
	});

	it('offsets by the remaining fraction', async () => {
		const w = await ring({ value: 1, max: 4 });
		expect(offset(w) / dash(w)).toBeCloseTo(0.75, 5);
	});

	it('derives the dash array from the radius, not the size', async () => {
		const w = await ring({ value: 0, max: 4, size: 100, thickness: 10 });
		// radius is (size - thickness) / 2, so the stroke sits inside the box
		expect(dash(w)).toBeCloseTo(2 * Math.PI * 45, 4);
	});
});

describe('degenerate inputs', () => {
	/**
	 * A max of zero is a real state - the day before any nudge is picked - and dividing by it
	 * would put `NaN` in `stroke-dashoffset`, which silently draws nothing.
	 */
	it('survives a max of zero without producing NaN', async () => {
		const w = await ring({ value: 0, max: 0 });
		expect(Number.isNaN(offset(w)), 'a zero max produced a NaN offset').toBe(false);
		expect(offset(w)).toBeCloseTo(dash(w), 5);
	});

	it('never lets the radius go negative when the stroke is wider than the ring', async () => {
		const w = await ring({ value: 1, max: 2, size: 10, thickness: 40 });
		expect(Number(arc(w).attributes('r'))).toBe(0);
		expect(Number.isNaN(offset(w))).toBe(false);
	});

	it('clamps a value above the max rather than overdrawing', async () => {
		const w = await ring({ value: 99, max: 4 });
		expect(offset(w)).toBeCloseTo(0, 5);
		expect(centreText(w)).toBe('4');
	});

	it('clamps a negative value to zero', async () => {
		const w = await ring({ value: -3, max: 4 });
		expect(centreText(w)).toBe('0');
		expect(offset(w)).toBeCloseTo(dash(w), 5);
	});

	// the ring counts whole nudges; a fraction would render as "1.5 of 4"
	it('floors fractional values and maxes', async () => {
		const w = await ring({ value: 1.9, max: 4.7 });
		expect(centreText(w)).toBe('1');
		expect(w.attributes('aria-label')).toBe('1 of 4 resolved');
	});

	it('treats a negative max as zero', async () => {
		const w = await ring({ value: 2, max: -5 });
		expect(w.attributes('aria-label')).toBe('0 of 0 resolved');
	});
});

describe('the centre text', () => {
	it('shows the clamped count by default', async () => {
		const w = await ring({ value: 3, max: 4 });
		expect(centreText(w)).toBe('3');
	});

	// an explicit label wins, so the same ring can show a streak or a percentage
	it('shows an explicit label instead when given', async () => {
		const w = await ring({ value: 3, max: 4, label: '75%' });
		expect(centreText(w)).toBe('75%');
	});

	it('scales with the ring', async () => {
		const small = await ring({ value: 1, max: 4, size: 50 });
		const large = await ring({ value: 1, max: 4, size: 200 });
		const sizeOf = (w: Wrapper) =>
			Number(/font-size:\s*([\d.]+)px/.exec(w.find('span').attributes('style') ?? '')?.[1]);
		expect(sizeOf(large)).toBeGreaterThan(sizeOf(small));
	});
});

describe('the accessible name', () => {
	it('describes progress in words when no name is given', async () => {
		const w = await ring({ value: 2, max: 4 });
		expect(w.attributes('role')).toBe('img');
		expect(w.attributes('aria-label')).toBe('2 of 4 resolved');
	});

	it('prefers an explicit name', async () => {
		const w = await ring({ value: 2, max: 4, ariaLabel: 'Half the day done' });
		expect(w.attributes('aria-label')).toBe('Half the day done');
	});
});

describe('colours', () => {
	// authored tokens resolve through colors.json; a css var is already usable
	it('resolves an authored token and passes a css variable through', async () => {
		const token = await ring({ value: 1, max: 4, color: '@green' });
		expect(arc(token).attributes('stroke')).toMatch(/^rgb|^#/);

		const cssVar = await ring({ value: 1, max: 4, color: 'var(--nudge-accent)' });
		expect(arc(cssVar).attributes('stroke')).toBe('var(--nudge-accent)');
	});

	it('colours the track separately from the arc', async () => {
		const w = await ring({ value: 1, max: 4, color: '@green', track: '@red' });
		const [track, progress] = w.findAll('circle');
		expect(track!.attributes('stroke')).not.toBe(progress!.attributes('stroke'));
	});
});

describe('motion', () => {
	/**
	 * The transition class is the only thing that animates the arc, so it has to come off when
	 * animations are disabled - the app's reduced-motion setting is honoured everywhere else.
	 */
	it('carries its transition class by default', async () => {
		const w = await ring({ value: 1, max: 4 });
		expect(arc(w).classes()).toContain('ring-progress');
	});
});
