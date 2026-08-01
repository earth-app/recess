import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Toasts, alerts and confirms.
 *
 * The property worth pinning is not the delegation - it is that `confirm` resolves **false**
 * on every path it cannot complete. It gates "Erase Everything" and "Reset Today", so a
 * dialog plugin that throws must read as "the user said no", never as consent.
 */

const { isNative, show, alertFn, confirmFn } = vi.hoisted(() => ({
	isNative: vi.fn(() => true),
	show: vi.fn(async (_opts: Record<string, unknown>) => {}),
	alertFn: vi.fn(async (_opts: Record<string, unknown>) => {}),
	confirmFn: vi.fn(async (_opts: Record<string, unknown>) => ({ value: true }))
}));

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: isNative } }));
vi.mock('@capacitor/toast', () => ({ Toast: { show } }));
vi.mock('@capacitor/dialog', () => ({ Dialog: { alert: alertFn, confirm: confirmFn } }));

import { useNotify } from '~/composables/useNotify';

beforeEach(() => {
	vi.clearAllMocks();
	isNative.mockReturnValue(true);
	show.mockImplementation(async (_opts: Record<string, unknown>) => {});
	alertFn.mockImplementation(async (_opts: Record<string, unknown>) => {});
	confirmFn.mockImplementation(async (_opts: Record<string, unknown>) => ({ value: true }));
});

describe('confirm', () => {
	it('returns what the native dialog reported', async () => {
		const { confirm } = useNotify();
		expect(await confirm({ title: 'T', message: 'M' })).toBe(true);

		confirmFn.mockImplementation(async (_opts: Record<string, unknown>) => ({ value: false }));
		expect(await confirm({ title: 'T', message: 'M' })).toBe(false);
	});

	// the whole reason this composable is worth a spec
	it('returns false when the dialog plugin throws', async () => {
		confirmFn.mockImplementation(async (_opts: Record<string, unknown>) => {
			throw new Error('plugin missing');
		});

		const { confirm } = useNotify();
		expect(
			await confirm({ title: 'Erase Everything', message: 'This cannot be undone.' }),
			'a failed dialog must read as a refusal, not as consent'
		).toBe(false);
	});

	it('passes the button titles through, defaulting them', async () => {
		const { confirm } = useNotify();

		await confirm({ title: 'T', message: 'M', okText: 'Wipe', cancelText: 'Keep' });
		expect(confirmFn.mock.calls[0]![0]).toMatchObject({
			okButtonTitle: 'Wipe',
			cancelButtonTitle: 'Keep'
		});

		confirmFn.mockClear();
		await confirm({ title: 'T', message: 'M' });
		expect(confirmFn.mock.calls[0]![0]).toMatchObject({
			okButtonTitle: 'OK',
			cancelButtonTitle: 'Cancel'
		});
	});

	// stubbed rather than spied: this environment does not define window.confirm at all
	it('falls back to window.confirm off native', async () => {
		isNative.mockReturnValue(false);
		const native = vi.fn(() => true);
		vi.stubGlobal('confirm', native);

		const { confirm } = useNotify();
		expect(await confirm({ title: 'Title', message: 'Body' })).toBe(true);
		expect(native).toHaveBeenCalledWith('Title\n\nBody');
		expect(confirmFn, 'the native dialog must not be reached off native').not.toHaveBeenCalled();

		vi.unstubAllGlobals();
	});

	// found by writing this test: it used to call undefined and throw out of the caller
	it('refuses rather than throwing when window has no confirm', async () => {
		isNative.mockReturnValue(false);
		vi.stubGlobal('confirm', undefined);

		const { confirm } = useNotify();
		await expect(confirm({ title: 'T', message: 'M' })).resolves.toBe(false);

		vi.unstubAllGlobals();
	});
});

describe('toast', () => {
	it('shows through the plugin on native, at the requested duration', async () => {
		const { toast } = useNotify();
		await toast('Saved', 'long');
		expect(show).toHaveBeenCalledWith({ text: 'Saved', duration: 'long', position: 'bottom' });
	});

	it('defaults to a short toast', async () => {
		const { toast } = useNotify();
		await toast('Saved');
		expect(show.mock.calls[0]![0]).toMatchObject({ duration: 'short' });
	});

	// a toast is never important enough to throw into a ui handler
	it('degrades to the console rather than throwing', async () => {
		show.mockImplementation(async (_opts: Record<string, unknown>) => {
			throw new Error('no plugin');
		});
		const spy = vi.spyOn(console, 'info').mockImplementation(() => {});

		const { toast } = useNotify();
		await expect(toast('Saved')).resolves.toBeUndefined();
		expect(spy).toHaveBeenCalled();

		spy.mockRestore();
	});

	it('never reaches the plugin off native', async () => {
		isNative.mockReturnValue(false);
		const spy = vi.spyOn(console, 'info').mockImplementation(() => {});

		const { toast } = useNotify();
		await toast('Saved');
		expect(show).not.toHaveBeenCalled();
		expect(spy).toHaveBeenCalled();

		spy.mockRestore();
	});
});

describe('alert', () => {
	it('shows through the plugin with a confirm button', async () => {
		const { alert } = useNotify();
		await alert('Camera Needed', 'Turn it on.');
		expect(alertFn).toHaveBeenCalledWith({
			title: 'Camera Needed',
			message: 'Turn it on.',
			buttonTitle: 'OK'
		});
	});

	it('degrades to the console rather than throwing', async () => {
		alertFn.mockImplementation(async (_opts: Record<string, unknown>) => {
			throw new Error('no plugin');
		});
		const spy = vi.spyOn(console, 'info').mockImplementation(() => {});

		const { alert } = useNotify();
		await expect(alert('T', 'M')).resolves.toBeUndefined();
		expect(spy).toHaveBeenCalled();

		spy.mockRestore();
	});
});
