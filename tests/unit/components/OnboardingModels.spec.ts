import { mountSuspended } from '@nuxt/test-utils/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OnboardingModels from '~/components/onboarding/Models.vue';
import type { ModelPack } from '~/types/nudge';
import { MODEL_PACKS } from '~/types/nudge';

/**
 * The onboarding step that offers the model packs.
 *
 * Two things here are consequential rather than cosmetic. Pack sizes are read from the hub listing
 * and must never be invented, so an unknown size says so plainly and the total refuses to add up a
 * partial set. And skipping is the one onboarding choice that permanently degrades every scored
 * nudge to self-attestation, so it asks first and a cancelled confirm changes nothing.
 */

const network = vi.hoisted(() => ({ offline: false, cellular: false }));
const { runBenchmark, download, sizeOf, toast, confirm, skipModels, packState } = vi.hoisted(
	() => ({
		runBenchmark: vi.fn(async () => 2 as const),
		download: vi.fn(async (_pack: ModelPack) => ({ ok: true }) as { ok: boolean }),
		sizeOf: vi.fn(async (_pack: ModelPack) => 40_000_000 as number | null),
		toast: vi.fn(async () => {}),
		confirm: vi.fn(async () => true),
		skipModels: vi.fn(async () => {}),
		packState: { installed: false as boolean }
	})
);

vi.mock('~/composables/useNetwork', async (importOriginal) => {
	const actual = await importOriginal<typeof import('~/composables/useNetwork')>();
	const { computed } = await import('vue');
	return {
		...actual,
		isOffline: computed(() => network.offline),
		isCellular: computed(() => network.cellular),
		downloadGate: () =>
			network.offline
				? { allowed: false, reason: 'offline' }
				: { allowed: true, warn: network.cellular ? 'cellular' : null }
	};
});

vi.mock('~/composables/useCapability', async (importOriginal) => {
	const actual = await importOriginal<typeof import('~/composables/useCapability')>();
	const { computed } = await import('vue');
	return {
		...actual,
		useCapability: () => ({ runBenchmark, detectedTier: computed(() => 2) })
	};
});

vi.mock('~/composables/useModels', async (importOriginal) => {
	const actual = await importOriginal<typeof import('~/composables/useModels')>();
	const { computed, ref } = await import('vue');
	return {
		...actual,
		useModels: () => ({
			packs: computed(() =>
				Object.fromEntries(MODEL_PACKS.map((pack) => [pack, { ...packState }]))
			),
			progress: ref(null),
			busy: ref(null),
			sizeOf,
			download
		})
	};
});

vi.mock('~/composables/useNotify', () => ({ useNotify: () => ({ toast, confirm }) }));

vi.mock('~/composables/useOnboarding', async (importOriginal) => {
	const actual = await importOriginal<typeof import('~/composables/useOnboarding')>();
	return { ...actual, useOnboarding: () => ({ ...actual.useOnboarding(), skipModels }) };
});

/**
 * Ionic's list and toggle render as stubs and swallow their slots, so without passthroughs the
 * pack labels and sizes never reach the dom and every assertion about them is vacuous.
 */
const passthrough = { template: '<div><slot /></div>' };
const stubs = {
	IonList: passthrough,
	IonItem: passthrough,
	IonToggle: {
		props: ['checked', 'disabled'],
		emits: ['ion-change'],
		template:
			'<label><input type="checkbox" :checked="checked" :disabled="disabled" @change="$emit(\'ion-change\', { detail: { checked: $event.target.checked } })" /><slot /></label>'
	}
};

type Wrapper = Awaited<ReturnType<typeof mountSuspended<typeof OnboardingModels>>>;
let mounted: Wrapper | null = null;

/** the benchmark and the size fetch both settle in `onMounted`, so a flush is required */
async function step() {
	mounted = await mountSuspended(OnboardingModels, { global: { stubs } });
	await new Promise((r) => setTimeout(r, 0));
	await mounted.vm.$nextTick();
	return mounted;
}

const button = (w: Wrapper, label: RegExp) =>
	w.findAll('ion-button').find((b) => label.test(b.text()));

beforeEach(() => {
	vi.clearAllMocks();
	network.offline = false;
	network.cellular = false;
	packState.installed = false;
	sizeOf.mockImplementation(async () => 40_000_000);
	download.mockImplementation(async () => ({ ok: true }));
	confirm.mockImplementation(async () => true);
});

afterEach(() => {
	mounted?.unmount();
	mounted = null;
});

describe('the benchmark', () => {
	it('runs on mount and reports the tier it found', async () => {
		const w = await step();
		expect(runBenchmark).toHaveBeenCalledOnce();
		expect(w.text()).toMatch(/Tier|Balanced|Lighter|Full/i);
	});

	// tier 1 is the safe default, so a thrown benchmark must not strand the step
	it('still offers the packs when the benchmark throws', async () => {
		runBenchmark.mockRejectedValueOnce(new Error('no adapter'));
		const w = await step();
		expect(button(w, /Download/), 'the step never left its loading state').toBeTruthy();
	});
});

describe('the sizes', () => {
	it('asks the hub for every pack', async () => {
		await step();
		expect(sizeOf).toHaveBeenCalledTimes(MODEL_PACKS.length);
	});

	it('shows a real measured size, never an estimate', async () => {
		const w = await step();
		expect(w.text()).toContain('40 MB');
		expect(w.text(), 'a tilde means a guess reached the ui').not.toMatch(/~\s*\d+\s*MB/);
	});

	/**
	 * A missing size is stated as missing. Summing the ones that did arrive would present a total
	 * smaller than the real download, which is the fabricated-fact failure in its worst form.
	 */
	it('withholds the total when any single size is unknown', async () => {
		sizeOf.mockImplementation(async (pack) => (pack === 'audio' ? null : 40_000_000));
		const w = await step();

		expect(w.text()).toMatch(/unavailable|not available|unknown/i);
		expect(w.text(), 'a partial total was presented as the whole').not.toContain('120 MB');
	});

	it('adds up only when every size is known', async () => {
		const w = await step();
		// four packs at 40 MB each
		expect(w.text()).toContain('160 MB');
	});

	it('reports gigabyte totals with a decimal rather than rounding to whole GB', async () => {
		sizeOf.mockImplementation(async () => 600_000_000);
		const w = await step();
		expect(w.text()).toContain('2.4 GB');
	});
});

describe('choosing packs', () => {
	it('starts with every pack wanted', async () => {
		const w = await step();
		const boxes = w.findAll('input[type="checkbox"]');
		expect(boxes).toHaveLength(MODEL_PACKS.length);
		expect(boxes.every((b) => (b.element as HTMLInputElement).checked)).toBe(true);
	});

	it('downloads only what is still selected', async () => {
		const w = await step();
		await w.findAll('input[type="checkbox"]')[0]!.setValue(false);
		await button(w, /Download/)!.trigger('click');
		await w.vm.$nextTick();

		expect(download).toHaveBeenCalledTimes(MODEL_PACKS.length - 1);
		expect(download).not.toHaveBeenCalledWith(MODEL_PACKS[0]);
	});

	it('offers nothing to download once every pack is deselected', async () => {
		const w = await step();
		for (const box of w.findAll('input[type="checkbox"]')) await box.setValue(false);
		await button(w, /Download/)!.trigger('click');
		expect(download).not.toHaveBeenCalled();
	});

	// an installed pack is not a choice, so its row cannot be toggled off
	it('locks a pack that is already installed', async () => {
		packState.installed = true;
		const w = await step();
		expect(
			w.findAll('input[type="checkbox"]').every((b) => b.attributes('disabled') !== undefined)
		).toBe(true);
	});

	it('skips straight to the finished state when everything is installed', async () => {
		packState.installed = true;
		const w = await step();
		expect(button(w, /Download/)).toBeUndefined();
		expect(w.text()).not.toContain('40 MB');
	});
});

describe('the network gate', () => {
	it('refuses to start while offline and says why', async () => {
		network.offline = true;
		const w = await step();
		await button(w, /Download/)!.trigger('click');
		await w.vm.$nextTick();

		expect(download, 'a download started with no network').not.toHaveBeenCalled();
		expect(toast).toHaveBeenCalledOnce();
	});

	it('asks before spending cellular data', async () => {
		network.cellular = true;
		const w = await step();
		await button(w, /Download/)!.trigger('click');
		await w.vm.$nextTick();

		expect(confirm).toHaveBeenCalledOnce();
		expect(download).toHaveBeenCalled();
	});

	it('starts nothing when the cellular confirm is declined', async () => {
		network.cellular = true;
		confirm.mockImplementation(async () => false);
		const w = await step();
		await button(w, /Download/)!.trigger('click');
		await w.vm.$nextTick();

		expect(download).not.toHaveBeenCalled();
	});

	it('needs no confirm on wifi', async () => {
		const w = await step();
		await button(w, /Download/)!.trigger('click');
		await w.vm.$nextTick();

		expect(confirm).not.toHaveBeenCalled();
		expect(download).toHaveBeenCalledTimes(MODEL_PACKS.length);
	});
});

describe('after downloading', () => {
	it('advances only once every pack landed', async () => {
		const w = await step();
		await button(w, /Download/)!.trigger('click');
		await new Promise((r) => setTimeout(r, 0));
		await w.vm.$nextTick();

		expect(button(w, /Download/), 'the download button survived a full success').toBeUndefined();
		expect(w.text()).toMatch(/Downloaded|On this Device/i);
	});

	/**
	 * A partial failure keeps the step open rather than continuing as if it worked; the packs that
	 * did arrive are still installed, so retrying only fetches what is left.
	 */
	it('reports a failure and stays on the step', async () => {
		download.mockImplementation(async (pack) => ({ ok: pack !== 'audio' }));
		const w = await step();
		await button(w, /Download/)!.trigger('click');
		await new Promise((r) => setTimeout(r, 0));
		await w.vm.$nextTick();

		expect(toast).toHaveBeenCalledOnce();
		expect(button(w, /Download/), 'a failed download closed the step').toBeTruthy();
	});
});

describe('skipping', () => {
	it('asks before accepting the consequence', async () => {
		const w = await step();
		await button(w, /Not Now/)!.trigger('click');
		await w.vm.$nextTick();

		expect(confirm).toHaveBeenCalledOnce();
		expect(skipModels).toHaveBeenCalledOnce();
		expect(w.emitted('complete')).toHaveLength(1);
	});

	it('changes nothing when the confirm is declined', async () => {
		confirm.mockImplementation(async () => false);
		const w = await step();
		await button(w, /Not Now/)!.trigger('click');
		await w.vm.$nextTick();

		expect(skipModels, 'models were skipped without consent').not.toHaveBeenCalled();
		expect(w.emitted('complete')).toBeUndefined();
	});
});
