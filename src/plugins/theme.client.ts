import { applyAppSettingsToDocument, useAppSettingsState } from '~/composables/useSettings';

/**
 * Keeps the two theme owners from disagreeing.
 *
 * `@nuxtjs/color-mode` arrives with `@nuxt/ui` and writes `.dark` / `.light` on the
 * root from its own stored preference, while our settings write the same class plus
 * `.ion-palette-dark`. Two writers on one class means whichever ran last wins, so
 * this mirrors our setting into color-mode and makes ours the single source.
 *
 * It also re-applies on OS theme changes, which only `preference: 'system'` would
 * otherwise notice - the Ionic palette class is written once and would go stale.
 */
export default defineNuxtPlugin(() => {
	const settings = useAppSettingsState();
	const colorMode = useColorMode();

	watch(
		() => settings.value.theme,
		(theme) => {
			if (colorMode.preference !== theme) colorMode.preference = theme;
		},
		{ immediate: true }
	);

	// not torn down: Nuxt has no client-side app-unmount hook, and the listener is
	// meant to live exactly as long as the app does
	window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
		if (settings.value.theme === 'system') applyAppSettingsToDocument(settings.value);
	});
});
