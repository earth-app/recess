/// <reference types="@capacitor/splash-screen" />
/// <reference types="@capacitor/local-notifications" />
/// <reference types="@capacitor/keyboard" />

import type { CapacitorConfig } from '@capacitor/cli';
import { KeyboardResize } from '@capacitor/keyboard';

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
		},
		LocalNotifications: {
			smallIcon: 'ic_stat_recess',
			iconColor: '#3498db'
		},
		Keyboard: {
			resize: KeyboardResize.Native,
			resizeOnFullScreen: true
		}
	}
};

export default config;
