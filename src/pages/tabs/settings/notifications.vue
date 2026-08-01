<template>
	<IonPage>
		<IonHeader :translucent="true">
			<IonToolbar>
				<IonButtons slot="start">
					<IonBackButton default-href="/tabs/settings" />
				</IonButtons>
				<IonTitle>{{ t('settings.notifications') }}</IonTitle>
			</IonToolbar>
		</IonHeader>

		<IonContent :fullscreen="true">
			<IonList
				:inset="true"
				class="mt-2!"
			>
				<IonItem
					lines="none"
					class="[--min-height:70px]"
				>
					<span
						slot="start"
						class="flex size-10 items-center justify-center rounded-2xl"
						:style="{ background: withAlpha('@orange', 0.16) }"
					>
						<UIcon
							name="mdi:bell-ring-outline"
							class="text-xl"
							:style="{ color: resolveColor('@orange') }"
						/>
					</span>

					<IonToggle
						color="primary"
						:checked="settings.notifications"
						@ion-change="(event) => writeEnabled(event.detail.checked)"
					>
						<span class="flex! flex-col! gap-0.5! py-1! whitespace-normal!">
							<span class="text-base! font-semibold!">
								{{ t('settings.notificationsEnabled') }}
							</span>
							<span class="text-sm! leading-snug! text-(--ion-text-color-step-400)!">
								{{ t('settings.notificationsHint') }}
							</span>
						</span>
					</IonToggle>
				</IonItem>
			</IonList>

			<div
				v-if="denied"
				class="px-4 pb-2"
			>
				<UAlert
					color="warning"
					variant="subtle"
					icon="mdi:bell-off-outline"
					:title="t('permissions.notificationsTitle')"
					:description="t('settings.notificationsDenied')"
				/>

				<IonButton
					expand="block"
					fill="solid"
					color="primary"
					class="mt-3! text-sm! font-semibold!"
					@click="request"
				>
					{{ t('settings.requestNotifications') }}
				</IonButton>
			</div>

			<div class="px-6 pb-1">
				<h2 class="text-base! font-semibold!">{{ t('settings.notificationTimes') }}</h2>
				<p class="mt-0.5! text-sm! text-(--ion-text-color-step-400)!">
					{{ t('settings.notificationTimesHint') }}
				</p>
			</div>

			<IonList :inset="true">
				<IonItem
					v-for="(slot, index) in slots"
					:key="slot.key"
					:lines="index === slots.length - 1 ? 'none' : 'full'"
					class="[--min-height:70px]"
				>
					<span
						slot="start"
						class="flex size-10 items-center justify-center rounded-2xl"
						:style="{ background: withAlpha(slot.token, 0.16) }"
					>
						<UIcon
							:name="slot.icon"
							class="text-xl"
							:style="{ color: resolveColor(slot.token) }"
						/>
					</span>

					<IonLabel class="whitespace-normal!">
						<h2 class="text-base! font-semibold!">{{ slot.label }}</h2>
						<p class="mt-0.5! text-sm! text-(--ion-text-color-step-400)!">{{ slot.hint }}</p>
					</IonLabel>

					<IonDatetimeButton
						slot="end"
						class="self-center!"
						:datetime="`settings-time-${slot.key}`"
						:disabled="!settings.notifications"
					/>
				</IonItem>
			</IonList>

			<IonModal
				v-for="slot in slots"
				:key="`sheet-${slot.key}`"
				:keep-contents-mounted="true"
			>
				<IonDatetime
					:id="`settings-time-${slot.key}`"
					presentation="time"
					:value="slot.value"
					:prefer-wheel="true"
					@ion-change="(event) => writeTime(slot.key, event.detail.value)"
				/>
			</IonModal>

			<div class="h-8" />
		</IonContent>
	</IonPage>
</template>

<script setup lang="ts">
import { Capacitor } from '@capacitor/core';
import { resolveColor, withAlpha } from '~/utils/color';

type TimeKey = 'morningTime' | 'middayTime' | 'eveningTime';

const { t } = useI18n();
const { settings, setValue } = useAppSettings();
const { check } = usePermissions();
const { refreshSchedule } = useLocalNotifications();
const { alert } = useNotify();

const native = Capacitor.isNativePlatform();
const granted = ref(true);

// nothing to warn about on the web build, where local notifications never run
const denied = computed(() => native && settings.value.notifications && !granted.value);

const slots = computed<
	{ key: TimeKey; label: string; hint: string; value: string; icon: string; token: string }[]
>(() => [
	{
		key: 'morningTime',
		label: t('settings.morningTime'),
		hint: t('settings.morningTimeHint'),
		value: isoFor(settings.value.morningTime),
		icon: 'mdi:weather-sunset-up',
		token: '@gold'
	},
	{
		key: 'middayTime',
		label: t('settings.middayTime'),
		hint: t('settings.middayTimeHint'),
		value: isoFor(settings.value.middayTime),
		icon: 'mdi:weather-sunny',
		token: '@coral'
	},
	{
		key: 'eveningTime',
		label: t('settings.eveningTime'),
		hint: t('settings.eveningTimeHint'),
		value: isoFor(settings.value.eveningTime),
		icon: 'mdi:weather-night',
		token: '@indigo'
	}
]);

/** ion-datetime parses a full iso string reliably; the date part is never shown */
function isoFor(time: string): string {
	return `2000-01-01T${coerceTime(time, '09:00')}:00`;
}

async function writeEnabled(on: boolean) {
	await setValue('notifications', on);
	if (on && native) granted.value = await ensurePermission();
	await refreshSchedule({ force: true });
}

async function writeTime(key: TimeKey, raw: string | string[] | null | undefined) {
	const value = Array.isArray(raw) ? raw[0] : raw;
	if (typeof value !== 'string') return;

	// ion-datetime hands back an iso datetime; only the clock part is stored
	const match = /(\d{1,2}):(\d{2})/.exec(value);
	if (!match) return;

	await setValue(key, coerceTime(`${match[1]}:${match[2]}`, APP_SETTINGS_DEFAULTS[key]));
	await refreshSchedule({ force: true });
}

async function request() {
	granted.value = await ensurePermission();
	if (granted.value) {
		await refreshSchedule({ force: true });
		return;
	}
	// no installed plugin can open the OS settings screen, so say where to go instead
	await alert(t('permissions.notificationsTitle'), t('settings.notificationsDenied'));
}

onMounted(async () => {
	if (native) granted.value = await check('notifications');
});
</script>

<style scoped>
/**
 * `ion-datetime-button` defaults its background to `--ion-color-step-300`, which we never
 * declare - so it fell through to `--ion-background-color-step-300` (#b2b2b2) and three
 * mid-grey blocks read as disabled rather than tappable. Tinted with the primary role
 * instead, and the label mixed toward the page text so it clears 4.5:1 on the tint.
 */
ion-datetime-button::part(native) {
	background: color-mix(in srgb, var(--ion-color-primary) 14%, var(--ion-background-color));
	color: color-mix(in srgb, var(--ion-color-primary) 60%, var(--ion-text-color));
	min-height: 44px;
	font-weight: 600;
}

ion-datetime-button[disabled]::part(native) {
	background: var(--ion-background-color-step-100);
	color: var(--ion-text-color-step-500);
}
</style>
