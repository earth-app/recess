import tailwindcss from '@tailwindcss/vite';
import { defineNuxtConfig } from 'nuxt/config';

export default defineNuxtConfig({
	ssr: false,
	// Disable devtools in production to reduce client bundle size and overhead
	devtools: { enabled: process.env.NODE_ENV !== 'production' },
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
			dedupe: ['@ionic/core', '@ionic/vue', '@ionic/vue-router']
		},
		build: {
			cssCodeSplit: false
		},
		server: {
			hmr: {
				host: '127.0.0.1',
				clientPort: 3001,
				protocol: 'ws'
			}
		},
		optimizeDeps: {
			include: [
				'@capacitor/app',
				'@capacitor/core',
				'@capacitor/preferences',
				'@capacitor/haptics',
				'@capacitor/local-notifications',
				'@capacitor/splash-screen',
				'@capacitor/dialog',
				'@capacitor/toast',
				'@ionic/pwa-elements/loader',
				'@ionic/vue',
				'@vue/devtools-core',
				'@vue/devtools-kit',
				'luxon',
				'zod'
			]
		}
	},
	i18n: {
		locales: [{ code: 'en', language: 'en-US' }],
		defaultLocale: 'en'
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
				bundleName: 'recess',
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
