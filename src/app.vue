<template>
	<IonApp>
		<IonRouterOutlet :animation="slide" />
		<component
			:is="DevLauncher"
			v-if="DevLauncher"
		/>
	</IonApp>
</template>

<script setup lang="ts">
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { defineCustomElements } from '@ionic/pwa-elements/loader';
import slide from './animations/slide';
import { DEV_MODE } from './utils/dev';
import { installSeed } from './utils/install';

if (import.meta.client) {
	defineCustomElements(window);
}

const DevLauncher = DEV_MODE
	? defineAsyncComponent(() => import('./components/dev/Launcher.vue'))
	: null;

const router = useIonRouter();
const isNative = Capacitor.isNativePlatform();

const { init: initSettings } = useAppSettings();
const { load: loadOnboarding } = useOnboarding();
const progress = useProgressStore();
const models = useModelsStore();

const teardowns: (() => void)[] = [];

useBackButton(10, () => {
	if (router.canGoBack()) {
		router.back(slide);
		return;
	}

	// no history; let the OS minimize the app instead of nav stack pop
	if (isNative) {
		void App.minimizeApp().catch(() => App.exitApp());
	}
});

onMounted(async () => {
	// settings first so the theme and scale apply before anything paints
	await initSettings();
	// the seed keys the day picker and the Playground, so it has to resolve before the
	// first `ensure()`; `installSeedSync()` returns '' until it does and degrades safely
	await installSeed();
	await Promise.all([loadOnboarding(), progress.load(), models.load()]);

	teardowns.push(await initNetwork());
	await checkAll();

	if (isNative) {
		teardowns.push(initLocalNotificationRouting());
		teardowns.push(initShortcutRouting());
		teardowns.push(await initWatchBridge());
		await refreshSchedule();
		await hideSplash();
	}

	await writeAppGroupSnapshot();
});

onBeforeUnmount(() => {
	for (const teardown of teardowns) teardown();
	teardowns.length = 0;
});

const { checkAll } = usePermissions();
const { refreshSchedule } = useLocalNotifications();
const { initWatchBridge, writeAppGroupSnapshot } = useWatchBridge();

async function hideSplash() {
	try {
		const { SplashScreen } = await import('@capacitor/splash-screen');
		await SplashScreen.hide({ fadeOutDuration: 400 });
	} catch {
		// plugin unavailable on this build
	}
}
</script>
