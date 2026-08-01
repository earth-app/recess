import { Capacitor } from '@capacitor/core';

// Ionic owns the UI, and Nuxt UI's useToast needs a <UApp> host that does not
// exist here, so toasts and confirms go through Capacitor. On web they degrade to
// console and window.confirm rather than silently doing nothing.

export function useNotify() {
	async function toast(message: string, duration: 'short' | 'long' = 'short') {
		if (!Capacitor.isNativePlatform()) {
			console.info(`[toast] ${message}`);
			return;
		}
		try {
			const { Toast } = await import('@capacitor/toast');
			await Toast.show({ text: message, duration, position: 'bottom' });
		} catch {
			console.info(`[toast] ${message}`);
		}
	}

	async function alert(title: string, message: string) {
		if (!Capacitor.isNativePlatform()) {
			console.info(`[alert] ${title}: ${message}`);
			return;
		}
		try {
			const { Dialog } = await import('@capacitor/dialog');
			await Dialog.alert({ title, message, buttonTitle: 'OK' });
		} catch {
			console.info(`[alert] ${title}: ${message}`);
		}
	}

	/** returns false on cancel, so destructive actions can bail */
	async function confirm(options: {
		title: string;
		message: string;
		okText?: string;
		cancelText?: string;
	}): Promise<boolean> {
		if (!Capacitor.isNativePlatform()) {
			// the function, not just the object: a window without `confirm` used to call
			// undefined and throw out of whichever handler asked, from the one place that gates
			// Erase Everything. every path this cannot complete has to read as a refusal
			return typeof window !== 'undefined' && typeof window.confirm === 'function'
				? window.confirm(`${options.title}\n\n${options.message}`)
				: false;
		}
		try {
			const { Dialog } = await import('@capacitor/dialog');
			const { value } = await Dialog.confirm({
				title: options.title,
				message: options.message,
				okButtonTitle: options.okText ?? 'OK',
				cancelButtonTitle: options.cancelText ?? 'Cancel'
			});
			return value;
		} catch {
			return false;
		}
	}

	return { toast, alert, confirm };
}
