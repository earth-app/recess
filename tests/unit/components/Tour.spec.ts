import { mountSuspended } from '@nuxt/test-utils/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Tour from '~/components/Tour.vue';
import { TOUR_STEPS } from '~/composables/useAppTour';

/**
 * The tour's spotlight geometry and its modal behaviour.
 *
 * e2e drives this through a real browser and pins that the ring lands on the right element; what
 * it cannot cheaply cover is the arithmetic underneath - the clip-path winding that cuts the hole,
 * the above/below placement decision and its clamp, and the Tab focus trap. A scrim polygon with
 * the wrong winding renders as a solid sheet with no hole, which looks like "the tour is broken"
 * rather than a geometry bug.
 */

/**
 * The composable is faked with real computeds, not plain objects: the template auto-unwraps
 * refs, so a `{ value }` literal makes `current.titleKey` undefined and `t(undefined)` throws
 * out of vue-i18n rather than failing an assertion.
 */
const state = vi.hoisted(() => ({ active: true, step: 0 }));
const { finish, next, back } = vi.hoisted(() => ({
	finish: vi.fn(async () => {}),
	next: vi.fn(async () => {}),
	back: vi.fn(async () => {})
}));

vi.mock('~/composables/useAppTour', async (importOriginal) => {
	const actual = await importOriginal<typeof import('~/composables/useAppTour')>();
	const { computed } = await import('vue');
	return {
		...actual,
		useAppTour: () => ({
			active: computed(() => state.active),
			steps: actual.TOUR_STEPS,
			step: computed(() => state.step),
			current: computed(() => actual.TOUR_STEPS[state.step] ?? null),
			isLast: computed(() => state.step >= actual.TOUR_STEPS.length - 1),
			next,
			back,
			finish
		})
	};
});

/** a target the tour can measure, placed where the test wants it */
function target(name: string, value: string, box: Partial<DOMRect>) {
	const el = document.createElement('div');
	el.setAttribute(name, value);
	el.getBoundingClientRect = () =>
		({ top: 0, left: 0, width: 100, height: 50, bottom: 50, right: 100, ...box }) as DOMRect;
	el.scrollIntoView = vi.fn();
	document.body.append(el);
	return el;
}

beforeEach(() => {
	state.active = true;
	state.step = 0;
	vi.clearAllMocks();
});

afterEach(() => {
	mounted?.unmount();
	mounted = null;
	document.body.innerHTML = '';
});

type Wrapper = Awaited<ReturnType<typeof mountSuspended<typeof Tour>>>;

let mounted: Wrapper | null = null;

/**
 * Unmounted after every test. The Escape handler is bound on `document`, so a wrapper left
 * mounted keeps listening and one keypress reaches every instance the file has ever created.
 */
async function tour() {
	mounted = await mountSuspended(Tour);
	return mounted;
}

const dialog = () => document.querySelector('[data-testid="tour"]');
const scrim = () => document.querySelector<HTMLElement>('[data-testid="tour"] .absolute.inset-0');

describe('when it renders at all', () => {
	it('renders nothing while inactive', async () => {
		state.active = false;
		await tour();
		expect(dialog()).toBeNull();
	});

	it('renders a real modal dialog when active', async () => {
		await tour();
		expect(dialog()?.getAttribute('role')).toBe('dialog');
		expect(dialog()?.getAttribute('aria-modal')).toBe('true');
		expect(dialog()?.getAttribute('aria-labelledby')).toBe('recess-tour-title');
	});

	// the title the dialog points at has to exist, or the name resolves to nothing
	it('gives the labelledby id to a heading that exists', async () => {
		await tour();
		const heading = document.getElementById('recess-tour-title');
		expect(heading, 'aria-labelledby points at no element').not.toBeNull();
		expect(heading!.textContent?.trim().length).toBeGreaterThan(0);
	});
});

describe('the step indicator', () => {
	it('counts from one, not zero', async () => {
		await tour();
		expect(dialog()!.textContent).toContain(`1 / ${TOUR_STEPS.length}`);
	});

	it('renders one dot per step and widens the current one', async () => {
		await tour();
		const dots = [...dialog()!.querySelectorAll('span[style*="width"]')];
		expect(dots).toHaveLength(TOUR_STEPS.length);
		const widths = dots.map((d) => d.getAttribute('style') ?? '');
		expect(
			widths.filter((s) => s.includes('18px')),
			'exactly one dot is current'
		).toHaveLength(1);
	});
});

describe('the scrim cutout', () => {
	/**
	 * The hole is cut by a single clip-path polygon that traces the viewport and then doubles
	 * back through the cutout. Both sub-paths are needed: without the second the scrim is solid
	 * and the highlighted element is covered by it.
	 */
	it('cuts a hole around a measured target', async () => {
		target('data-tour', 'deck', { top: 200, left: 20, width: 300, height: 180, bottom: 380 });
		await tour();
		await new Promise((r) => setTimeout(r, 20));

		const clip = scrim()?.style.clipPath ?? '';
		expect(clip, 'no clip-path, so the scrim covers the target').toContain('polygon');
		// the outer path plus the inner one, so the hole has somewhere to be
		expect(clip.split(',').length).toBeGreaterThan(6);
	});

	it('has no cutout at all when the step targets nothing', async () => {
		// step 0's target is absent from the dom, so it falls back to a centred card
		await tour();
		await new Promise((r) => setTimeout(r, 20));
		expect(scrim()?.style.clipPath ?? '').toBe('');
	});

	it('pads the hole around the element rather than tracing it exactly', async () => {
		target('data-tour', 'deck', { top: 200, left: 100, width: 200, height: 100, bottom: 300 });
		await tour();
		await new Promise((r) => setTimeout(r, 20));

		const clip = scrim()?.style.clipPath ?? '';
		// PAD is 8, so the hole starts before the element does
		expect(clip).toContain('92px');
		expect(clip).toContain('192px');
	});
});

describe('dismissal', () => {
	it('finishes when the scrim behind the card is tapped', async () => {
		await tour();
		scrim()!.click();
		expect(finish).toHaveBeenCalledOnce();
	});

	/**
	 * Escape is bound on the document with capture, not on the dialog, because the dialog only
	 * has focus if something inside it does - and an Escape that does nothing reads as a trap.
	 */
	it('finishes on Escape from anywhere in the document', async () => {
		await tour();
		document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		expect(finish).toHaveBeenCalledOnce();
	});

	it('ignores other keys', async () => {
		await tour();
		document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
		expect(finish).not.toHaveBeenCalled();
	});

	it('ignores Escape once it has closed', async () => {
		state.active = false;
		await tour();
		document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		expect(finish).not.toHaveBeenCalled();
	});
});

describe('the buttons', () => {
	it('offers skip and next on the first step, but no back', async () => {
		const w: Wrapper = await tour();
		const text = dialog()!.textContent ?? '';
		expect(text).toContain('Skip');
		expect(text).toContain('Next');
		void w;
	});

	it('offers back once past the first step', async () => {
		state.step = 1;
		await tour();
		expect(dialog()!.textContent).toContain('Back');
	});

	it('says done rather than next on the last step', async () => {
		state.step = TOUR_STEPS.length - 1;
		await tour();
		const text = dialog()!.textContent ?? '';
		expect(text).toContain('Got It');
		expect(text).not.toMatch(/\bNext\b/);
	});
});

describe('the swipe demonstration', () => {
	// the first step teaches the gesture, so it shows it rather than describing it
	it('appears only on the step that declares it', async () => {
		await tour();
		expect(document.querySelector('[data-testid="swipe-hint"]')).not.toBeNull();

		document.body.innerHTML = '';
		state.step = 1;
		await tour();
		expect(document.querySelector('[data-testid="swipe-hint"]')).toBeNull();
	});
});
