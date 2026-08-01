import { ONBOARDING_KEY, parseOnboarding } from '~/composables/useOnboarding';

export default defineNuxtRouteMiddleware(async (to) => {
	if (!import.meta.client) return;
	if (to.path !== '/') return;

	const { get } = useSettings();
	await configurePreferencesGroup();

	const state = parseOnboarding(await get<unknown>(ONBOARDING_KEY, null));
	return navigateTo(state.completed ? '/tabs/today' : '/onboarding', { replace: true });
});
