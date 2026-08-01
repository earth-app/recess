import { mountSuspended } from '@nuxt/test-utils/runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CountUp from '~/components/ui/CountUp.vue';
import { useAppSettingsState } from '~/composables/useSettings';

/**
 * The points counter's interpolation.
 *
 * Every number the reward surfaces show goes through this, so the failure modes are all quiet ones:
 * a count that stops a frame short shows 99 forever, a retarget that leaves the old frame loop
 * running makes the number stutter backwards, and a reduced-motion path that only cancels the
 * animation - rather than jumping to the end - would leave the value stuck at whatever it was.
 *
 * Nothing here waits on real time. `vi.useFakeTimers()` fakes `requestAnimationFrame` and
 * `performance.now()` from the same clock, so frames land on an exact 16ms grid and every value the
 * easing produces is reproducible.
 */

const FRAME = 16;

type CountUpProps = InstanceType<typeof CountUp>['$props'];
type Wrapper = Awaited<ReturnType<typeof mountSuspended<typeof CountUp>>>;

/** happy-dom keeps its device settings on the window; vueuse reads them through matchMedia */
type HappyWindow = Window & {
	happyDOM?: { settings: { device: { prefersReducedMotion: string } } };
};

function setReducedMotion(reduce: boolean) {
	const happy = (window as HappyWindow).happyDOM;
	if (!happy) throw new Error('happy-dom device settings are unavailable');
	happy.settings.device.prefersReducedMotion = reduce ? 'reduce' : 'no-preference';
}

/** the real shared state, so the component reads the same setting the settings page writes */
function setAnimations(on: boolean) {
	const settings = useAppSettingsState();
	settings.value = { ...settings.value, animations: on };
}

let mounted: Wrapper | null = null;

/**
 * Timers are faked after the mount, never before: `mountSuspended` awaits Nuxt's own setup on real
 * timers, and installing the fakes first deadlocks the mount rather than failing it.
 */
async function counter(props: Partial<CountUpProps> & { value: number }) {
	mounted = await mountSuspended(CountUp, { props });
	vi.useFakeTimers();
	return mounted;
}

async function frames(w: Wrapper, count: number) {
	vi.advanceTimersByTime(FRAME * count);
	await w.vm.$nextTick();
}

/** past any duration these tests use, so the loop has run its final frame */
async function settle(w: Wrapper) {
	vi.advanceTimersByTime(4000);
	await w.vm.$nextTick();
}

async function sample(w: Wrapper, count: number) {
	const seen: number[] = [];
	for (let i = 0; i < count; i++) {
		await frames(w, 1);
		seen.push(Number(w.text()));
	}
	return seen;
}

const climbs = (seen: readonly number[]) => seen.every((n, i) => i === 0 || n >= seen[i - 1]!);

afterEach(() => {
	mounted?.unmount();
	mounted = null;
	vi.useRealTimers();
	setReducedMotion(false);
	setAnimations(true);
});

describe('mounting', () => {
	// the app opens with a ledger already loaded; a counter that ticked up on mount would spin
	it('starts settled on its value rather than counting up to it', async () => {
		const w = await counter({ value: 42 });
		expect(w.text()).toBe('42');
		expect(vi.getTimerCount(), 'a frame was scheduled on mount').toBe(0);
	});
});

describe('the interpolation', () => {
	/**
	 * The easing reaches t=1 exactly on the last frame, and the loop also assigns the target
	 * outright there. A format with decimals is what proves it, since a whole-number display would
	 * round 99.97 to 100 and hide a count that never arrived.
	 */
	it('lands exactly on the target rather than near it', async () => {
		const w = await counter({ value: 10, format: (n) => n.toFixed(3) });
		await w.setProps({ value: 100 });
		await settle(w);
		expect(w.text()).toBe('100.000');
	});

	it('walks the values in between instead of snapping', async () => {
		const w = await counter({ value: 10 });
		await w.setProps({ value: 100 });
		await frames(w, 1);
		const mid = Number(w.text());
		expect(mid).toBeGreaterThan(10);
		expect(mid).toBeLessThan(100);
	});

	// cubic ease-out: at half the duration it is 1 - 0.5^3 = 87.5% of the way
	it('eases out, so it is most of the way there at the halfway point', async () => {
		const w = await counter({ value: 0, animateFromZero: true });
		await w.setProps({ value: 100 });
		await frames(w, 22);
		expect(Number(w.text())).toBeGreaterThan(75);
		expect(Number(w.text())).toBeLessThan(100);
	});

	it('never overshoots the target or goes backwards on the way', async () => {
		const w = await counter({ value: 10, format: (n) => n.toFixed(3) });
		await w.setProps({ value: 100 });
		const seen = await sample(w, 50);
		expect(Math.max(...seen), 'the eased value passed the target').toBeLessThanOrEqual(100);
		expect(Math.min(...seen), 'the eased value dropped below the start').toBeGreaterThanOrEqual(10);
		expect(climbs(seen), 'the display went backwards mid-count').toBe(true);
	});

	it('spends the duration it is given rather than always 700ms', async () => {
		const w = await counter({ value: 100, duration: 2000 });
		await w.setProps({ value: 200 });
		await frames(w, 44);
		expect(Number(w.text()), 'a 2s count finished inside 700ms').toBeLessThan(200);
		await settle(w);
		expect(w.text()).toBe('200');
	});

	// span is floored at 1ms, so a zero duration still resolves on the first frame
	it('lands on the first frame when there is no duration to spend', async () => {
		const w = await counter({ value: 5, duration: 0 });
		await w.setProps({ value: 50 });
		await frames(w, 1);
		expect(w.text()).toBe('50');
	});
});

describe('a target that moves mid-count', () => {
	it('lands exactly on the newest target', async () => {
		const w = await counter({ value: 10, format: (n) => n.toFixed(3) });
		await w.setProps({ value: 100 });
		await frames(w, 8);
		await w.setProps({ value: 250 });
		await settle(w);
		expect(w.text()).toBe('250.000');
	});

	/**
	 * A retarget restarts from the previous target, so the number jumps forward once and then eases
	 * on from there. What must not happen is two frame loops writing the same ref: the first is
	 * cancelled, and the tell if it were not is a display that oscillates, since the stale loop
	 * writes values below the point the new one restarted at.
	 */
	it('cancels the old frame loop instead of letting two of them fight', async () => {
		const w = await counter({ value: 10, format: (n) => n.toFixed(3) });
		await w.setProps({ value: 100 });
		const before = await sample(w, 8);
		await w.setProps({ value: 250 });
		const after = await sample(w, 20);
		expect(climbs([...before, ...after]), 'a stale frame loop is still writing').toBe(true);
		expect(vi.getTimerCount(), 'two animations are pending at once').toBe(1);
	});
});

describe('the hydration case', () => {
	/**
	 * A 0 -> n change is almost always the ledger loading on app open rather than points the user
	 * just earned, so it snaps. Animating it would set every counter on the week page spinning at
	 * launch, which reads as a slot machine instead of a summary.
	 */
	it('snaps a zero to n change rather than animating it', async () => {
		const w = await counter({ value: 0 });
		await w.setProps({ value: 42 });
		expect(w.text()).toBe('42');
		expect(vi.getTimerCount(), 'the hydrating value animated').toBe(0);
	});

	it('animates the same change when asked to', async () => {
		const w = await counter({ value: 0, animateFromZero: true });
		await w.setProps({ value: 42 });
		expect(w.text(), 'the count started somewhere other than zero').toBe('0');
		expect(vi.getTimerCount(), 'no frame was scheduled').toBe(1);
		await settle(w);
		expect(w.text()).toBe('42');
	});
});

describe('degenerate targets', () => {
	it('counts down to zero', async () => {
		const w = await counter({ value: 5 });
		await w.setProps({ value: 0 });
		await settle(w);
		expect(w.text()).toBe('0');
	});

	it('counts into the negatives', async () => {
		const w = await counter({ value: 5 });
		await w.setProps({ value: -3 });
		await settle(w);
		expect(w.text()).toBe('-3');
	});

	it('renders a huge target in full rather than in exponent form', async () => {
		const w = await counter({ value: 1 });
		await w.setProps({ value: 1_000_000_000 });
		await settle(w);
		expect(w.text()).toBe('1000000000');
	});
});

describe('formatting', () => {
	// the format owns the rounding, so it has to see the raw eased value
	it('hands the format the unrounded eased value', async () => {
		const format = vi.fn((n: number) => n.toFixed(3));
		const w = await counter({ value: 10, format });
		await w.setProps({ value: 100 });
		await frames(w, 4);
		expect(
			format.mock.calls.some(([n]) => !Number.isInteger(n)),
			'format only ever saw whole numbers'
		).toBe(true);
	});

	it('rounds to whole numbers with no format given', async () => {
		const w = await counter({ value: 10 });
		await w.setProps({ value: 100 });
		await frames(w, 4);
		expect(w.text()).toMatch(/^\d+$/);
	});
});

describe('when motion is off', () => {
	/**
	 * The point of these two is that the final value arrives *immediately*. Cancelling the
	 * animation without assigning the target would leave the counter reading the old number, which
	 * is worse than the animation it was meant to spare.
	 */
	it('shows the final value at once under prefers-reduced-motion', async () => {
		setReducedMotion(true);
		const w = await counter({ value: 5 });
		await w.setProps({ value: 100 });
		expect(w.text(), 'the new value never arrived').toBe('100');
		expect(vi.getTimerCount(), 'a frame was scheduled anyway').toBe(0);
	});

	it('shows the final value at once when animations are switched off', async () => {
		const w = await counter({ value: 5 });
		setAnimations(false);
		await w.setProps({ value: 100 });
		expect(w.text(), 'the new value never arrived').toBe('100');
		expect(vi.getTimerCount(), 'a frame was scheduled anyway').toBe(0);
	});

	it('keeps arriving at every later value, not just the first', async () => {
		setReducedMotion(true);
		const w = await counter({ value: 5 });
		await w.setProps({ value: 100 });
		await w.setProps({ value: 7 });
		expect(w.text()).toBe('7');
	});
});

describe('unmounting', () => {
	it('cancels its pending frame, so nothing ticks after it is gone', async () => {
		const w = await counter({ value: 10 });
		await w.setProps({ value: 100 });
		expect(vi.getTimerCount()).toBe(1);

		w.unmount();
		mounted = null;
		expect(vi.getTimerCount(), 'the frame loop outlived the component').toBe(0);
	});
});
