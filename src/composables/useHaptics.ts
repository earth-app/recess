import { Capacitor } from '@capacitor/core';

// Every call is fire-and-forget and gated on the setting; a missing plugin or a
// web build must never throw into a UI handler.

export function useHaptics() {
	const settings = useAppSettingsState();

	async function withHaptics<T>(
		work: (haptics: typeof import('@capacitor/haptics')) => Promise<T>
	) {
		if (!settings.value.haptics || !Capacitor.isNativePlatform()) return;
		try {
			await work(await import('@capacitor/haptics'));
		} catch {
			// plugin unavailable on this build
		}
	}

	return {
		/** a resolved nudge */
		success: () =>
			void withHaptics(async ({ Haptics, NotificationType }) =>
				Haptics.notification({ type: NotificationType.Success })
			),
		/** a miss, or a validator that could not run */
		warning: () =>
			void withHaptics(async ({ Haptics, NotificationType }) =>
				Haptics.notification({ type: NotificationType.Warning })
			),
		/** a card leaving the deck */
		swipe: () =>
			void withHaptics(async ({ Haptics, ImpactStyle }) =>
				Haptics.impact({ style: ImpactStyle.Light })
			),
		tap: () =>
			void withHaptics(async ({ Haptics, ImpactStyle }) =>
				Haptics.impact({ style: ImpactStyle.Medium })
			),
		selection: () => void withHaptics(async ({ Haptics }) => Haptics.selectionChanged())
	};
}
