/// <reference types="@capacitor/splash-screen" />

import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
	appId: 'com.earthapp.sky',
	appName: 'The Earth App',
	webDir: '.output/public',
	loggingBehavior: 'debug',
	appendUserAgent: 'The Earth App/Sky',
	server: {
		androidScheme: 'https',
		iosScheme: 'https'
	},
	plugins: {
		SplashScreen: {
			launchShowDuration: 3000,
			launchAutoHide: false,
			launchFadeOutDuration: 600,
			backgroundColor: '#1f1f1f',
			androidSplashResourceName: 'splash',
			androidScaleType: 'FIT_CENTER',
			showSpinner: true,
			splashImmersive: true,
			iosSpinnerStyle: 'small',
			androidSpinnerStyle: 'large'
		}
	}
};

export default config;
