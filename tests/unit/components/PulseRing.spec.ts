import { mountSuspended } from '@nuxt/test-utils/runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PulseRing from '~/components/ui/PulseRing.vue';
import { useAppSettingsState } from '~/composables/useSettings';

/**
 * The attention halo that sits behind a control worth tapping.
 *
 * It wraps something interactive, so the two decisions that matter are what it puts on top of that
 * control and when it puts nothing there at all. The ring is a full-size overlay: without
 * `pointer-events-none` it would swallow every tap on the button underneath, and without
 * `rounded-[inherit]` a pill button would wear a rectangular halo. Turning motion off has to drop
 * the ring while keeping the slot, since the slot is the actual control.
 *
 * There is no JS animation here at all - one CSS keyframe on one element, so there is no timer to
 * leak - and the pinned assertion for that is the class the keyframes hang off.
 */

type RingProps = InstanceType<typeof PulseRing>['$props'];
type Wrapper = Awaited<ReturnType<typeof mountSuspended<typeof PulseRing>>>;

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

const CONTENT = 'Mark it Done';

async function pulse(props: Partial<RingProps> = {}) {
	mounted = await mountSuspended(PulseRing, { props, slots: { default: () => CONTENT } });
	return mounted;
}

const host = (w: Wrapper) => w.find('span');
const ring = (w: Wrapper) => w.find('span[aria-hidden="true"]');
const styleOf = (w: Wrapper) => ring(w).attributes('style') ?? '';

afterEach(() => {
	mounted?.unmount();
	mounted = null;
	setReducedMotion(false);
	setAnimations(true);
});

describe('the ring', () => {
	it('renders over its content by default', async () => {
		const w = await pulse();
		expect(w.text()).toBe(CONTENT);
		expect(ring(w).exists()).toBe(true);
	});

	it('is inert and hidden from assistive tech', async () => {
		const w = await pulse();
		expect(ring(w).attributes('aria-hidden')).toBe('true');
		expect(ring(w).classes(), 'the ring would swallow taps on the control beneath it').toContain(
			'pointer-events-none'
		);
	});

	/**
	 * The ring is positioned against the host rather than the page. Dropping `relative` from the
	 * host sends `inset-0` up to the nearest positioned ancestor, which puts the halo somewhere
	 * else entirely instead of failing visibly.
	 */
	it('is pinned to its host, not to the page', async () => {
		const w = await pulse();
		expect(host(w).classes()).toContain('relative');
		expect(ring(w).classes()).toContain('absolute');
		expect(ring(w).classes()).toContain('inset-0');
	});

	// a pill button with a rectangular halo is the tell that this came off
	it('inherits the host radius rather than imposing its own', async () => {
		const w = await pulse();
		expect(host(w).classes()).toContain('rounded-[inherit]');
		expect(ring(w).classes()).toContain('rounded-[inherit]');
	});

	// the scoped keyframes hang off this class; nothing pulses without it
	it('carries the class the keyframes are bound to', async () => {
		const w = await pulse();
		expect(ring(w).classes()).toContain('pulse-ring-anim');
	});

	it('draws a border rather than a filled block', async () => {
		const w = await pulse({ color: '@green' });
		expect(styleOf(w)).toContain('2px solid');
	});
});

describe('when there is no ring', () => {
	/**
	 * All three of these keep the slot. The slot is the control the ring decorates, so hiding it
	 * along with the ring would remove the thing the user came to tap.
	 */
	it('drops the ring but keeps the content when inactive', async () => {
		const w = await pulse({ active: false });
		expect(ring(w).exists()).toBe(false);
		expect(w.text(), 'the content went with the ring').toBe(CONTENT);
	});

	it('drops the ring but keeps the content under prefers-reduced-motion', async () => {
		setReducedMotion(true);
		const w = await pulse();
		expect(ring(w).exists()).toBe(false);
		expect(w.text(), 'the content went with the ring').toBe(CONTENT);
	});

	it('drops the ring but keeps the content when animations are switched off', async () => {
		const w = await pulse();
		setAnimations(false);
		await w.vm.$nextTick();
		expect(ring(w).exists()).toBe(false);
		expect(w.text(), 'the content went with the ring').toBe(CONTENT);
	});

	it('follows the active prop back and forth', async () => {
		const w = await pulse({ active: false });
		await w.setProps({ active: true });
		expect(ring(w).exists()).toBe(true);
		await w.setProps({ active: false });
		expect(ring(w).exists()).toBe(false);
	});

	// pure css, so there is no frame loop or interval that could survive the component
	it('runs no timer of its own, mounted or unmounted', async () => {
		const w = await pulse();
		vi.useFakeTimers();
		expect(vi.getTimerCount(), 'the ring scheduled work it does not need').toBe(0);

		w.unmount();
		mounted = null;
		expect(vi.getTimerCount()).toBe(0);
		vi.useRealTimers();
	});
});

describe('the colour', () => {
	// authored tokens resolve through colors.json; a css var is already usable as-is
	it('resolves an authored token to a concrete colour', async () => {
		const w = await pulse({ color: '@green' });
		expect(styleOf(w)).toContain('rgb(45 153 115)');
	});

	it('passes a css variable through untouched', async () => {
		const w = await pulse({ color: 'var(--ion-color-success)' });
		expect(styleOf(w)).toContain('var(--ion-color-success)');
	});

	it('defaults to the accent variable the nudge card sets', async () => {
		const w = await pulse();
		expect(styleOf(w)).toContain('var(--nudge-accent)');
	});
});

describe('the speed', () => {
	it('passes the speed to the animation as seconds', async () => {
		const w = await pulse({ speed: 3 });
		expect(styleOf(w)).toContain('--pr-speed: 3s');
	});

	it('defaults to 1.4s', async () => {
		const w = await pulse();
		expect(styleOf(w)).toContain('--pr-speed: 1.4s');
	});
});
