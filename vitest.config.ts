import { defineVitestConfig } from '@nuxt/test-utils/config';

export default defineVitestConfig({
	test: {
		environment: 'nuxt',
		include: ['tests/unit/**/*.spec.ts'],
		globals: true,
		setupFiles: ['tests/setup/unit-setup.ts'],
		// mounting a component boots a Nuxt app, and the first mount in a file pays that cost;
		// the 5s default trips it once ~35 files run together. same values crust uses
		testTimeout: 30_000,
		hookTimeout: 120_000,
		coverage: {
			provider: 'v8',
			reportsDirectory: 'coverage',
			reporter: ['text', 'json', 'lcov'],
			include: ['src/composables/**', 'src/stores/**', 'src/utils/**', 'src/components/**'],
			exclude: ['**/*.d.ts', 'src/stubs/**']
		}
	}
});
