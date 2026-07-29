import { isRef, toValue } from 'vue';

export default defineNuxtPlugin({
	name: 'recess:unhead-unref',
	enforce: 'post',
	setup(nuxtApp) {
		if (!import.meta.client) return;

		// unref head values so @nuxt/ui's computed theme <style> is not JSON.stringify'd
		// (cyclic) under ssr:false. entirely cosmetic, so it is wrapped: a throw here
		// would abort the plugin chain and the app would never mount.
		try {
			const head = nuxtApp.vueApp.runWithContext(() => injectHead()) as unknown as {
				resolvedOptions?: {
					propResolvers?: ((key: string | undefined, value: unknown) => unknown)[];
				};
			};

			const options = head?.resolvedOptions;
			if (!options) return;

			const unref = (_key: string | undefined, value: unknown) =>
				isRef(value) ? toValue(value) : value;

			options.propResolvers = [...(options.propResolvers ?? []), unref];
		} catch {
			// the circular-JSON warning stays in the console; nothing else breaks
		}
	}
});
