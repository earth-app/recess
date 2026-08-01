<template>
	<IonPage>
		<IonHeader class="ion-no-border">
			<IonToolbar :style="{ '--background': 'transparent' }">
				<IonButtons slot="end">
					<IonButton
						fill="clear"
						size="small"
						color="medium"
						class="text-xs! font-medium! opacity-90!"
						@click="complete"
					>
						{{ t('common.skip') }}
					</IonButton>
				</IonButtons>
			</IonToolbar>

			<IonProgressBar
				color="primary"
				:value="progress"
				:aria-label="t('onboarding.stepOf', { current: state.step + 1, total: steps.length })"
				class="h-0.5!"
			/>
		</IonHeader>

		<IonContent>
			<div
				v-if="!ready"
				class="flex min-h-full items-center justify-center"
			>
				<IonSpinner
					name="crescent"
					color="primary"
				/>
			</div>

			<Transition
				v-else
				mode="out-in"
				:enter-active-class="animate ? 'transition duration-300 ease-out' : ''"
				:enter-from-class="animate ? 'translate-y-2 opacity-0' : ''"
				:leave-active-class="animate ? 'transition duration-200 ease-in' : ''"
				:leave-to-class="animate ? '-translate-y-1 opacity-0' : ''"
			>
				<OnboardingSlide
					v-if="slide"
					:key="step"
					:icon="slide.icon"
					:title="slide.title"
					:body="slide.body"
					:accent="slide.accent"
				/>
				<OnboardingInterests
					v-else-if="step === 'interests'"
					key="interests"
				/>
				<OnboardingTimes
					v-else-if="step === 'times'"
					key="times"
				/>
				<OnboardingModels
					v-else
					key="models"
					@complete="complete"
				/>
			</Transition>
		</IonContent>

		<IonFooter class="ion-no-border">
			<IonToolbar :style="{ '--background': 'transparent' }">
				<IonButtons slot="start">
					<IonButton
						color="medium"
						fill="clear"
						:disabled="state.step === 0"
						class="text-sm!"
						@click="back"
					>
						{{ t('common.back') }}
					</IonButton>
				</IonButtons>

				<IonButtons slot="end">
					<IonButton
						v-if="step !== 'models'"
						fill="solid"
						:color="step === 'intro_private' ? 'success' : 'primary'"
						class="rounded-full! px-5! text-sm! font-semibold!"
						@click="goNext"
					>
						{{ nextLabel }}
					</IonButton>
				</IonButtons>
			</IonToolbar>
		</IonFooter>
	</IonPage>
</template>

<script setup lang="ts">
import { SLIDE_STEPS } from '~/composables/useOnboarding';

const { t } = useI18n();
const { state, step, steps, progress, load, next, back, finish } = useOnboarding();
const { settings, init } = useAppSettings();
const { build } = useNudgeContext();
const { refreshSchedule } = useLocalNotifications();
const nudges = useNudgesStore();

const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

const ready = ref(false);
const animate = computed(() => settings.value.animations && !reduceMotion.value);

const SLIDES: Record<string, { icon: string; accent: string }> = {
	intro_small: { icon: 'mdi:sprout-outline', accent: '@green' },
	intro_finite: { icon: 'mdi:weather-sunset', accent: '@gold' },
	intro_private: { icon: 'mdi:cellphone-lock', accent: '@indigo' }
};

const slide = computed(() => {
	const index = SLIDE_STEPS.indexOf(step.value);
	const meta = SLIDES[step.value];
	if (index < 0 || !meta) return null;

	return {
		...meta,
		title: t(`onboarding.slide${index + 1}Title`),
		body: t(`onboarding.slide${index + 1}Body`)
	};
});

const nextLabel = computed(() =>
	step.value === 'intro_private' ? t('onboarding.getStarted') : t('common.next')
);

async function goNext() {
	// the models step finishes through its own actions, never through Next
	if (step.value === 'models') return complete();
	await next();
}

/**
 * Suspected HARNESS problem, not an app bug, and not about routing.
 *
 * In a Maestro session that walks onboarding, the app then stops reacting to synthetic taps
 * altogether. Not just the tab bar - tapping the deck's own front card afterwards does not open
 * the sheet either, and the element is found and tapped (no "element not found"), so the tap is
 * dispatched and ignored. The tab bar only looked like the culprit because it was what the flows
 * tapped next.
 *
 * Evidence against it being this page's navigation: the same onboard-then-tap path passes under
 * Playwright's `webkit` project (iPhone 14, the nearest engine to WKWebView available there) and
 * under Chromium, both navigating and painting the destination. The device syslog shows the tap
 * delivered in failing runs (`ViewGestures: Synthetic click completed`) with no document
 * navigation. A `stopApp` + `launchApp` inside the flow does not restore it, while a session that
 * launches onto an already-onboarded container taps fine. And the XCUITest driver wedged across
 * seven consecutive runs on this machine.
 *
 * Also ruled out on device: a 20s settle; `location.assign('/tabs/today')` (genuinely
 * prerendered); `location.assign('/')` via the boot middleware; and the native "Skip the Models?"
 * dialog, since finishing through the header Skip fails identically.
 *
 * Run the lane on a clean runner before spending anything more here. If it passes there, this was
 * driver degradation and nothing in the app needs changing.
 */
async function complete() {
	await finish();
	await navigateTo('/tabs/today', { replace: true });
	void syncDigests();
}

async function syncDigests() {
	try {
		await nudges.load(settings.value.locale);
		void nudges.ensure(build());
		await refreshSchedule({ force: true });
	} catch {
		// best-effort; the window is rebuilt on the next foreground anyway
	}
}

onMounted(async () => {
	try {
		// settings first, then whatever step a half-finished run left behind
		await init();
		await load();
	} finally {
		// a storage failure must not leave the user staring at a spinner
		ready.value = true;
	}
});
</script>
