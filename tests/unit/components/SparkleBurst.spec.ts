import { mountSuspended } from '@nuxt/test-utils/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SparkleBurst from '~/components/ui/SparkleBurst.vue';
import { useAppSettingsState } from '~/composables/useSettings';

/**
 * The confetti burst behind a completed day.
 *
 * The particles are deliberately random, so nothing here asserts a position or a colour. What is
 * contractual is the count clamp, the bounds every particle has to start and stay inside, the
 * palette it is allowed to draw from, and the teardown: the canvas is absolutely positioned over a
 * real control, so one left mounted eats taps, and a frame loop that outlives the component keeps
 * drawing into a detached canvas forever.
 *
 * happy-dom lays nothing out and has no 2d context, so both are supplied here - a sized host, and a
 * recording context whose call log is the only observable output the burst has.
 */

const FRAME = 16;
const HOST = { width: 320, height: 200 };
const CENTRE = { x: HOST.width / 2, y: HOST.height / 2 };

// speed is 1.2 + random * 3.2, so one step can carry a particle no further than this
const MAX_STEP = 4.4;

/** the green palette, authored in the component against --color-recess-* in main.css */
const GREEN = ['#2d9973', '#8bc34a', '#17a2a2'];

interface Draw {
	x: number;
	y: number;
	radius: number;
	alpha: number;
	color: string;
}

type SparkleProps = InstanceType<typeof SparkleBurst>['$props'];
type Wrapper = Awaited<ReturnType<typeof mountSuspended<typeof SparkleBurst>>>;

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

/**
 * A stand-in 2d context. Every `clearRect` opens a frame and every `fill` closes one particle, so
 * the log comes back grouped the same way the draw loop produced it.
 */
function recorder() {
	const frames: Draw[][] = [];
	let pending: Draw | null = null;
	const ctx = {
		globalAlpha: 1,
		fillStyle: '',
		scale: () => {},
		save: () => {},
		restore: () => {},
		beginPath: () => {},
		clearRect: () => void frames.push([]),
		arc: (x: number, y: number, radius: number) => {
			pending = { x, y, radius, alpha: ctx.globalAlpha, color: String(ctx.fillStyle) };
		},
		fill: () => {
			if (pending) frames.at(-1)?.push(pending);
			pending = null;
		}
	};
	return { ctx, frames };
}

const BOX = {
	width: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')!,
	height: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')!
};

function sizeHost(width: number, height: number) {
	Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
		configurable: true,
		get: () => width
	});
	Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
		configurable: true,
		get: () => height
	});
}

const PIXEL_RATIO = window.devicePixelRatio;

function setPixelRatio(ratio: number) {
	Object.defineProperty(window, 'devicePixelRatio', { configurable: true, get: () => ratio });
}

let mounted: Wrapper | null = null;

/**
 * Timers are faked after the mount, never before: `mountSuspended` awaits Nuxt's own setup on real
 * timers, and installing the fakes first deadlocks the mount rather than failing it.
 */
async function burst(props: Partial<SparkleProps> = {}) {
	const { ctx, frames } = recorder();
	vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
		ctx as unknown as CanvasRenderingContext2D
	);
	mounted = await mountSuspended(SparkleBurst, { props: { trigger: 0, ...props } });
	vi.useFakeTimers();
	return { w: mounted, frames };
}

/** the watcher renders the canvas, awaits a tick, then starts the loop */
async function fire(w: Wrapper, trigger = 1) {
	await w.setProps({ trigger });
	await w.vm.$nextTick();
	await w.vm.$nextTick();
}

async function run(w: Wrapper, count: number) {
	vi.advanceTimersByTime(FRAME * count);
	await w.vm.$nextTick();
}

const distance = (p: Draw) => Math.hypot(p.x - CENTRE.x, p.y - CENTRE.y);

beforeEach(() => {
	sizeHost(HOST.width, HOST.height);
});

afterEach(() => {
	mounted?.unmount();
	mounted = null;
	vi.useRealTimers();
	vi.restoreAllMocks();
	Object.defineProperty(HTMLElement.prototype, 'clientWidth', BOX.width);
	Object.defineProperty(HTMLElement.prototype, 'clientHeight', BOX.height);
	setPixelRatio(PIXEL_RATIO);
	setReducedMotion(false);
	setAnimations(true);
});

describe('when it draws at all', () => {
	it('mounts no canvas until something triggers it', async () => {
		const { w, frames } = await burst();
		expect(w.find('canvas').exists()).toBe(false);
		expect(frames).toHaveLength(0);
	});

	it('sizes the canvas to its host', async () => {
		const { w } = await burst();
		await fire(w);
		const canvas = w.find('canvas');
		expect(canvas.attributes('width')).toBe('320');
		expect(canvas.attributes('height')).toBe('200');
		expect(canvas.attributes('style')).toContain('320px');
	});

	/**
	 * The backing store is capped at 2x. A 3x phone would allocate nine times the pixels for a
	 * burst that lasts under a second, and the css size has to stay in layout pixels either way or
	 * the canvas stops covering its host.
	 */
	it('caps the backing store at 2x on a denser screen', async () => {
		setPixelRatio(3);
		const { w } = await burst();
		await fire(w);
		const canvas = w.find('canvas');
		expect(canvas.attributes('width'), 'the backing store followed a 3x ratio').toBe('640');
		expect(canvas.attributes('style')).toContain('320px');
	});

	/**
	 * The canvas is `absolute inset-0` over whatever it decorates, so leaving it mounted would put
	 * a transparent sheet over a real control. A host with no size cannot show a burst anyway.
	 */
	it('gives up on a host with no size instead of leaving a canvas behind', async () => {
		sizeHost(0, 0);
		const { w, frames } = await burst();
		await fire(w);
		expect(w.find('canvas').exists(), 'an invisible canvas was left mounted').toBe(false);
		expect(frames).toHaveLength(0);
	});

	it('draws nothing under prefers-reduced-motion', async () => {
		setReducedMotion(true);
		const { w, frames } = await burst();
		await fire(w);
		await run(w, 60);
		expect(w.find('canvas').exists()).toBe(false);
		expect(frames, 'the burst ran anyway').toHaveLength(0);
	});

	it('draws nothing when animations are switched off', async () => {
		const { w, frames } = await burst();
		setAnimations(false);
		await fire(w);
		await run(w, 60);
		expect(w.find('canvas').exists()).toBe(false);
		expect(frames, 'the burst ran anyway').toHaveLength(0);
	});
});

describe('the particle count', () => {
	it('clamps a small count up to eight', async () => {
		const { w, frames } = await burst({ count: 3 });
		await fire(w);
		await run(w, 1);
		expect(frames[0]).toHaveLength(8);
	});

	it('clamps a large count down to sixty', async () => {
		const { w, frames } = await burst({ count: 500 });
		await fire(w);
		await run(w, 1);
		expect(frames[0]).toHaveLength(60);
	});

	it('rounds a fractional count', async () => {
		const { w, frames } = await burst({ count: 10.6 });
		await fire(w);
		await run(w, 1);
		expect(frames[0]).toHaveLength(11);
	});

	it('draws the whole default count', async () => {
		const { w, frames } = await burst();
		await fire(w);
		await run(w, 1);
		expect(frames[0]).toHaveLength(28);
	});
});

describe('where the particles go', () => {
	it('starts every one of them at the centre of the host', async () => {
		const { w, frames } = await burst({ count: 60 });
		await fire(w);
		await run(w, 1);
		for (const p of frames[0]!) {
			expect(distance(p), 'a particle started away from the centre').toBeLessThanOrEqual(MAX_STEP);
		}
	});

	// each particle keeps its own velocity, so none of them can drift back inward
	it('moves every one of them outward, never back toward the centre', async () => {
		const { w, frames } = await burst({ count: 60 });
		await fire(w);
		await run(w, 3);
		const [first, , third] = frames;
		expect(third, 'three frames did not run').toHaveLength(first!.length);
		first!.forEach((p, index) => {
			expect(distance(third![index]!), 'a particle moved back inward').toBeGreaterThan(distance(p));
		});
	});

	it('fades and shrinks them as the burst runs out', async () => {
		const { w, frames } = await burst({ count: 20, duration: 320 });
		await fire(w);
		await run(w, 19);
		const first = frames[0]!;
		const last = frames.at(-1)!;
		expect(last[0]!.alpha, 'the particles never faded').toBeLessThan(first[0]!.alpha);
		expect(last[0]!.radius, 'the particles never shrank').toBeLessThan(first[0]!.radius);
	});

	it('draws only colours from the palette it was asked for', async () => {
		const { w, frames } = await burst({ count: 60, color: 'green' });
		await fire(w);
		await run(w, 1);
		const used = [...new Set(frames[0]!.map((p) => p.color))];
		expect(used.filter((color) => !GREEN.includes(color))).toEqual([]);
	});
});

describe('the frame loop', () => {
	it('redraws the same particles each frame instead of accumulating them', async () => {
		const { w, frames } = await burst({ count: 12 });
		await fire(w);
		await run(w, 5);
		expect(frames.map((f) => f.length)).toEqual([12, 12, 12, 12, 12]);
	});

	it('clears the canvas and unmounts it once the duration is up', async () => {
		const { w, frames } = await burst({ count: 12, duration: 100 });
		await fire(w);
		await run(w, 20);
		expect(w.find('canvas').exists(), 'the canvas outlived the burst').toBe(false);
		expect(frames.at(-1), 'the last frame still had particles on it').toEqual([]);
		expect(vi.getTimerCount(), 'a frame was left pending after the burst ended').toBe(0);
	});

	// a second completion mid-burst restarts it; two loops on one canvas would double the draw
	it('starts over rather than stacking when it is triggered again mid-flight', async () => {
		const { w, frames } = await burst({ count: 12 });
		await fire(w, 1);
		await run(w, 4);
		await fire(w, 2);
		await run(w, 1);
		const latest = frames.at(-1)!;
		expect(latest, 'the second burst drew on top of the first').toHaveLength(12);
		expect(distance(latest[0]!), 'the particles were not re-rolled').toBeLessThanOrEqual(MAX_STEP);
	});

	it('cancels its pending frame on unmount, so nothing draws afterwards', async () => {
		const { w, frames } = await burst({ count: 12 });
		await fire(w);
		await run(w, 2);
		const drawn = frames.length;

		w.unmount();
		mounted = null;
		expect(vi.getTimerCount(), 'the frame loop outlived the component').toBe(0);
		vi.advanceTimersByTime(FRAME * 40);
		expect(frames.length, 'a frame fired after unmount').toBe(drawn);
	});
});

describe('the canvas element', () => {
	it('is inert and hidden from assistive tech', async () => {
		const { w } = await burst();
		await fire(w);
		const canvas = w.find('canvas');
		expect(canvas.attributes('aria-hidden')).toBe('true');
		expect(canvas.classes(), 'the canvas would swallow taps on what it decorates').toContain(
			'pointer-events-none'
		);
		expect(canvas.classes()).toContain('absolute');
	});
});
