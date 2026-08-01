import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { defineNuxtConfig } from 'nuxt/config';
import { version } from './package.json';

const emptyStub = fileURLToPath(new URL('./src/stubs/empty.ts', import.meta.url));
const devMode = process.env.NUXT_PUBLIC_DEV_MODE === '1';

export default defineNuxtConfig({
	ssr: false,
	runtimeConfig: {
		public: {
			// mirrors __DEV_MODE__ for anything that needs it reactively; the literal is
			// what actually gates the bundle
			devMode
		}
	},
	hooks: {
		// a page is always reachable from the router manifest, so gating it in the
		// template would still emit the chunk; the route has to go
		'pages:extend'(pages) {
			if (devMode) return;

			const strip = (list: typeof pages) => {
				for (let index = list.length - 1; index >= 0; index--) {
					const page = list[index];
					if (!page) continue;
					if (page.path === '/dev' || page.path.startsWith('/dev/')) list.splice(index, 1);
					else if (page.children) strip(page.children);
				}
			};

			strip(pages);
		}
	},
	// emit client sourcemaps only in test builds so the e2e V8->istanbul merge can remap
	sourcemap: {
		client: process.env.NUXT_PUBLIC_TEST_BUILD === '1'
	},
	/**
	 * Off in production for bundle size, and off in test builds because the devtools frame
	 * is an overlay that intercepts pointer events - on a phone viewport it sits over the
	 * tab bar, so `dev:test` failed every tab click with a click-interception timeout that
	 * looks exactly like an app bug.
	 */
	devtools: {
		enabled: process.env.NODE_ENV !== 'production' && process.env.NUXT_PUBLIC_TEST_BUILD !== '1'
	},
	srcDir: 'src',
	serverDir: 'src/server',
	css: ['~/assets/css/main.css'],
	compatibilityDate: '2025-12-09',
	nitro: {
		preset: 'static',
		routeRules: {
			'/**': {
				cors: true,
				headers: { 'Access-Control-Allow-Origin': '*', 'Referrer-Policy': 'no-referrer' }
			}
		}
	},
	vite: {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		plugins: [tailwindcss() as any],
		resolve: {
			dedupe: ['@ionic/core', '@ionic/vue', '@ionic/vue-router'],
			alias: {
				'onnxruntime-node': emptyStub,
				sharp: emptyStub
			}
		},
		build: {
			cssCodeSplit: false,
			rollupOptions: {
				external: ['onnxruntime-node', 'sharp']
			}
		},
		server: {
			hmr: {
				host: '127.0.0.1',
				clientPort: Number(process.env.RECESS_PORT) || 3001,
				protocol: 'ws'
			}
		},
		optimizeDeps: {
			// prebundling the transformers wasm/onnx graph makes esbuild choke; it is
			// only ever reached through a dynamic import, so exclude it
			exclude: ['@huggingface/transformers', 'onnxruntime-node', 'sharp'],
			include: [
				'@capacitor/app',
				'@capacitor/barcode-scanner',
				'@capacitor/camera',
				'@capacitor/core',
				'@capacitor/device',
				'@capacitor/dialog',
				'@capacitor/filesystem',
				'@capacitor/geolocation',
				'@capacitor/haptics',
				'@capacitor/keyboard',
				'@capacitor/local-notifications',
				'@capacitor/network',
				'@capacitor/preferences',
				'@capacitor/share',
				'@capacitor/splash-screen',
				'@capacitor/status-bar',
				'@capacitor/toast',
				'@capgo/capacitor-audio-recorder',
				'@capgo/capacitor-watch',
				'@ionic/pwa-elements/loader',
				'@ionic/vue',
				'@vue/devtools-core',
				'@vue/devtools-kit',
				'exifreader',
				'@paulmillr/qr',
				'html5-qrcode',
				'luxon',
				'piexifjs',
				'zod'
			]
		},
		define: {
			__APP_VERSION__: JSON.stringify(version),
			__DEV_MODE__: JSON.stringify(devMode)
		}
	},
	i18n: {
		strategy: 'no_prefix',
		defaultLocale: 'en',
		langDir: 'locales',
		locales: [
			{ code: 'en', language: 'en-US', name: 'English', file: 'en.json' },
			{ code: 'en-GB', language: 'en-GB', name: 'English (UK)', file: 'en-GB.json' },
			{ code: 'es', language: 'es-ES', name: 'Español', file: 'es.json' },
			{ code: 'es-MX', language: 'es-MX', name: 'Español (México)', file: 'es-MX.json' }
		]
	},
	ionic: {
		css: {
			utilities: true
		},
		config: {
			statusTap: true,
			mode: (process.env.NUXT_MODE as 'md' | 'ios') || 'md'
		}
	},
	image: {
		provider: 'none'
	},
	modules: [
		'@nuxtjs/ionic',
		'@nuxt/ui',
		'@nuxt/image',
		'@nuxtjs/i18n',
		'@pinia/nuxt',
		'@vueuse/nuxt',
		[
			'@nuxtjs/google-fonts',
			{
				families: {
					'Noto Sans': [400, 500, 600, 700],
					Inter: [400, 500, 600, 700],
					Roboto: [400, 500, 700],
					'Open Sans': [400, 500, 600, 700]
				},
				display: 'swap'
			}
		],
		[
			'@nuxt/icon',
			{
				icon: {
					mode: 'css',
					cssLayer: 'base',
					size: '48px'
				}
			}
		],
		[
			'@codecov/nuxt-plugin',
			{
				enableBundleAnalysis: process.env.CODECOV_TOKEN !== undefined,
				bundleName: process.env.NUXT_MODE === 'ios' ? 'recess-ios' : 'recess-android',
				uploadToken: process.env.CODECOV_TOKEN
			}
		]
	],
	icon: {
		serverBundle: 'local'
	},
	experimental: {
		renderJsonPayloads: true,
		payloadExtraction: true,
		viteEnvironmentApi: true
	}
});
