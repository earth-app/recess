import { mountSuspended } from '@nuxt/test-utils/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ValidationBarcode from '~/components/validation/Barcode.vue';
import type { ResolveInput } from '~/composables/useResolve';
import { pendingRunner, runner, task } from '../helpers';

/**
 * The barcode surface.
 *
 * `Capacitor.isNativePlatform()` is read once at setup, and it decides the entire shape of the
 * surface: the native scanner plugin has no web counterpart, so in a browser there is no scan button
 * at all and self-attestation is the only route. That branch is the one worth pinning - a web build
 * that offered a scan button would open a plugin that cannot exist.
 *
 * The validation is structural only (symbology and checksum), never a lookup, so a scan that parses
 * still has to reach `run` rather than being judged here.
 */

const platform = vi.hoisted(() => ({ native: true }));
const { resolve, requirePermission, scan } = vi.hoisted(() => ({
	resolve: vi.fn(async (_input: ResolveInput) => ({
		points: 7,
		feedback: 'Got it.',
		unlocked: [],
		isNewBest: false
	})),
	requirePermission: vi.fn(async () => true),
	scan: vi.fn(async () => ({ data: '9780306406157', format: 'EAN_13' }) as unknown)
}));

vi.mock('@capacitor/core', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@capacitor/core')>();
	return {
		...actual,
		Capacitor: { ...actual.Capacitor, isNativePlatform: () => platform.native }
	};
});
vi.mock('~/composables/useResolve', () => ({ useResolve: () => ({ resolve }) }));
vi.mock('~/composables/usePermissions', async (importOriginal) => {
	const actual = await importOriginal<typeof import('~/composables/usePermissions')>();
	return {
		...actual,
		usePermissions: () => ({ ...actual.usePermissions(), require: requirePermission })
	};
});
vi.mock('~/composables/useCapture', async (importOriginal) => {
	const actual = await importOriginal<typeof import('~/composables/useCapture')>();
	return { ...actual, scanBarcode: scan };
});

const DATA = { kind: 'book' as const, require_checksum: true };

type Wrapper = Awaited<ReturnType<typeof mountSuspended<typeof ValidationBarcode>>>;
let mounted: Wrapper | null = null;

async function surface(run = runner({ status: 'passed', score: 1 })) {
	mounted = await mountSuspended(ValidationBarcode, { props: { nudge: task(), data: DATA, run } });
	return { w: mounted, run };
}

const button = (w: Wrapper, label: RegExp) =>
	w.findAll('ion-button').find((b) => label.test(b.text()));

async function scanned(w: Wrapper) {
	await button(w, /Scan a Barcode/)!.trigger('click');
	await vi.waitFor(() => expect(button(w, /Check it/)).toBeTruthy());
}

beforeEach(() => {
	vi.clearAllMocks();
	platform.native = true;
	requirePermission.mockImplementation(async () => true);
	scan.mockImplementation(async () => ({ data: '9780306406157', format: 'EAN_13' }));
	resolve.mockImplementation(async () => ({
		points: 7,
		feedback: 'Got it.',
		unlocked: [],
		isNewBest: false
	}));
});

afterEach(() => {
	mounted?.unmount();
	mounted = null;
});

describe('what it says it will check', () => {
	// naming the kind up front stops "scan a barcode" reading as "scan any barcode"
	it('names the kind of code the nudge wants', async () => {
		const { w } = await surface();
		expect(w.text()).toMatch(/book/i);
	});

	/**
	 * Nothing is looked up - there is no network. The copy has to say the check is structural, or a
	 * passing scan reads as "this is the right book" when it only means "this is a valid ISBN".
	 */
	it('says the check is structural rather than a lookup', async () => {
		const { w } = await surface();
		expect(w.text()).toMatch(/checks the code|structure|not.*look/i);
	});
});

describe('in a browser, where the scanner plugin does not exist', () => {
	beforeEach(() => {
		platform.native = false;
	});

	it('offers no scan button at all', async () => {
		const { w } = await surface();
		expect(button(w, /Scan a Barcode/), 'a web build offered a native scanner').toBeUndefined();
	});

	it('explains why and offers to mark it done instead', async () => {
		const { w } = await surface();
		expect(w.text()).toMatch(/app|device|phone/i);
		expect(button(w, /Mark it Done/), 'a web build left no way to finish').toBeTruthy();
	});

	it('resolves as self-attested', async () => {
		const { w } = await surface();
		await button(w, /Mark it Done/)!.trigger('click');
		await vi.waitFor(() => expect(resolve).toHaveBeenCalled());

		expect(resolve.mock.calls[0]![0]).toMatchObject({ outcome: 'self_attested' });
	});
});

describe('scanning', () => {
	it('asks for the camera before opening the scanner', async () => {
		const { w } = await surface();
		await button(w, /Scan a Barcode/)!.trigger('click');
		await vi.waitFor(() => expect(requirePermission).toHaveBeenCalledWith('camera'));
		expect(scan).toHaveBeenCalledOnce();
	});

	it('explains a denied camera and still lets the nudge be finished', async () => {
		requirePermission.mockImplementation(async () => false);
		const { w } = await surface();
		await button(w, /Scan a Barcode/)!.trigger('click');
		await vi.waitFor(() => expect(button(w, /Mark it Done/)).toBeTruthy());

		expect(scan, 'the scanner opened without permission').not.toHaveBeenCalled();
	});

	// cancelling is a choice, not a failure
	it('says nothing when the scanner is dismissed', async () => {
		scan.mockImplementation(async () => null);
		const { w } = await surface();
		await button(w, /Scan a Barcode/)!.trigger('click');
		await vi.waitFor(() => expect(scan).toHaveBeenCalled());
		await w.vm.$nextTick();

		expect(
			button(w, /Check it/),
			'a dismissed scanner produced a submittable scan'
		).toBeUndefined();
		expect(w.text()).not.toMatch(/error|failed/i);
	});

	/**
	 * The raw code is shown back. It is the only way to tell a misread from a genuinely wrong code,
	 * and the user can compare it against what is printed on the item.
	 */
	it('shows the code it read', async () => {
		const { w } = await surface();
		await scanned(w);
		expect(w.text()).toContain('9780306406157');
	});

	it('keeps the last scan when a rescan is dismissed', async () => {
		const { w } = await surface();
		await scanned(w);

		scan.mockImplementation(async () => null);
		await button(w, /Scan a Barcode/)!.trigger('click');
		await vi.waitFor(() => expect(scan).toHaveBeenCalledTimes(2));
		await w.vm.$nextTick();

		expect(w.text(), 'a dismissed rescan erased a good scan').toContain('9780306406157');
	});
});

describe('submitting', () => {
	it('hands the validator the scan rather than judging it here', async () => {
		const { w, run } = await surface();
		await scanned(w);
		await button(w, /Check it/)!.trigger('click');
		await vi.waitFor(() => expect(run).toHaveBeenCalled());

		expect((run.mock.calls[0] as unknown[])[1]).toMatchObject({
			kind: 'barcode',
			scan: { data: '9780306406157' }
		});
	});

	it('resolves on a pass', async () => {
		const { w } = await surface();
		await scanned(w);
		await button(w, /Check it/)!.trigger('click');
		await vi.waitFor(() => expect(w.emitted('resolved')).toHaveLength(1));

		expect(resolve.mock.calls[0]![0]).toMatchObject({ outcome: 'passed' });
	});

	// a failed checksum is a rescan, not a self-attestation prompt; the code is on the item
	it('reports a miss and leaves the nudge unresolved', async () => {
		const run = runner({ status: 'missed', detail: 'Checksum failed.' });
		const { w } = await surface(run);
		await scanned(w);
		await button(w, /Check it/)!.trigger('click');
		await vi.waitFor(() => expect(w.emitted('verdict')).toHaveLength(1));

		expect(resolve).not.toHaveBeenCalled();
		expect(button(w, /Scan a Barcode/), 'a miss left no way to rescan').toBeTruthy();
	});

	it('ignores a second tap while the first is in flight', async () => {
		const { run, release } = pendingRunner();
		const { w } = await surface(run);
		await scanned(w);

		const check = button(w, /Check it/)!;
		await check.trigger('click');
		await check.trigger('click');

		expect(run).toHaveBeenCalledOnce();
		release();
	});
});
