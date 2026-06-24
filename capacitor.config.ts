/// <reference types="@capacitor/splash-screen" />

import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
	appId: 'com.earthapp.recess',
	appName: 'Recess',
	webDir: '.output/public',
	loggingBehavior: 'debug',
	appendUserAgent: 'Recess',
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
