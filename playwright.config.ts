import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const isCI = !!process.env.CI;
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3001';
const prodServer = process.env.PLAYWRIGHT_PROD === '1';

const chromiumArgs = [
	'--disable-background-timer-throttling',
	'--disable-backgrounding-occluded-windows',
	'--disable-renderer-backgrounding'
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const reporters: any[] = [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]];
if (isCI) {
	reporters.push(['github']);
	reporters.push(['junit', { outputFile: 'playwright-report/junit.xml' }]);
}

export default defineConfig({
	testDir: './tests/e2e',
	testIgnore: ['**/utils/**'],
	fullyParallel: true,
	forbidOnly: isCI,
	retries: isCI ? 2 : 1,
	workers: isCI ? 2 : prodServer ? 4 : undefined,
	timeout: 120_000,
	expect: { timeout: 12_000 },
	reporter: reporters,
	outputDir: 'playwright-results',
	webServer: {
		// gated on the stamp `build:test` writes, not on `dist` existing: `dist` is a symlink
		// to `.output/public`, so any plain `generate` leaves a build here that is not a test
		// build, and the old `test -d dist` guard then served it silently
		command: prodServer
			? '{ test -f dist/.test-build || bun run build:test; } && bun run serve:test'
			: 'bun run dev:test',
		url: BASE_URL,
		reuseExistingServer: !isCI,
		timeout: prodServer ? 360_000 : 240_000,
		stdout: 'pipe',
		stderr: 'pipe'
	},
	use: {
		baseURL: BASE_URL,
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
		video: 'retain-on-failure',
		actionTimeout: 12_000,
		navigationTimeout: prodServer ? 30_000 : 90_000
	},
	projects: [
		{
			name: 'chromium',
			// mobile/responsive specs belong to the Pixel 7 project
			testIgnore: /\.(mobile|responsive)\.spec\.ts$/,
			use: { ...devices['Desktop Chrome'], launchOptions: { args: chromiumArgs } }
		},
		{
			// Android System WebView and Android Chrome both run Chromium (Blink)
			name: 'mobile-chromium',
			testMatch: /\.(mobile|responsive)\.spec\.ts$/,
			use: { ...devices['Pixel 7'], launchOptions: { args: chromiumArgs } }
		},
		{
			// closest engine to the shipped iOS WKWebView; opt-in via test:e2e:webkit
			name: 'webkit',
			testIgnore: /\.(mobile|responsive)\.spec\.ts$/,
			use: { ...devices['iPhone 14'] }
		}
	]
});

export const E2E_ROOT = fileURLToPath(new URL('./tests/e2e', import.meta.url));
