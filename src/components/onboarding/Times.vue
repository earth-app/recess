<template>
	<div class="flex min-h-full flex-col gap-6 px-5 py-10">
		<div class="flex flex-col items-center gap-3 text-center">
			<h1 class="font-title text-2xl font-semibold tracking-tight">
				{{ t('onboarding.timesTitle') }}
			</h1>
			<p class="max-w-sm text-sm leading-relaxed opacity-70">{{ t('onboarding.timesBody') }}</p>
			<p class="max-w-sm text-xs leading-relaxed opacity-55">
				{{ t('onboarding.timesDigest') }}
			</p>
		</div>

		<UAlert
			v-if="denied"
			color="neutral"
			variant="subtle"
			icon="mdi:bell-off-outline"
			:title="t('permissions.notificationsTitle')"
			:description="t('onboarding.notifDenied')"
		/>

		<div class="flex flex-col gap-3">
			<div
				v-for="slot in SLOTS"
				:key="slot.key"
				class="flex items-center justify-between gap-3 rounded-3xl p-4"
				:style="{ background: withAlpha(slot.token, 0.1) }"
			>
				<span class="flex items-center gap-3 text-sm font-semibold">
					<span
						class="flex size-9 shrink-0 items-center justify-center rounded-full"
						:style="{ background: withAlpha(slot.token, 0.22) }"
					>
						<UIcon
							:name="slot.icon"
							class="text-lg"
							:style="{ color: resolveColor(slot.token) }"
						/>
					</span>
					{{ t(slot.label) }}
				</span>

				<IonDatetimeButton
					:datetime="`onboarding-time-${slot.key}`"
					class="shrink-0"
				/>
			</div>
		</div>

		<IonModal
			v-for="slot in SLOTS"
			:key="`sheet-${slot.key}`"
			:keep-contents-mounted="true"
		>
			<IonDatetime
				:id="`onboarding-time-${slot.key}`"
				:value="isoFor(slot.key)"
				presentation="time"
				:prefer-wheel="true"
				@ion-change="onChange(slot.key, $event)"
			/>
		</IonModal>
	</div>
</template>

<script setup lang="ts">
import { Capacitor } from '@capacitor/core';
import { APP_SETTINGS_DEFAULTS, coerceTime } from '~/composables/useSettings';
import { resolveColor, withAlpha } from '~/utils/color';

type SlotKey = 'morning' | 'midday' | 'evening';

const { t } = useI18n();
const { setTimes } = useOnboarding();
const { settings, init } = useAppSettings();
const { require: requireNotifications } = usePermissions();

const SLOTS = [
	{
		key: 'morning',
		label: 'settings.morningTime',
		icon: 'mdi:weather-sunset-up',
		token: '@gold'
	},
	{
		key: 'midday',
		label: 'settings.middayTime',
		icon: 'mdi:white-balance-sunny',
		token: '@orange'
	},
	{
		key: 'evening',
		label: 'settings.eveningTime',
		icon: 'mdi:weather-night',
		token: '@indigo'
	}
] as const satisfies readonly { key: SlotKey; label: string; icon: string; token: string }[];

const FALLBACKS: Record<SlotKey, string> = {
	morning: APP_SETTINGS_DEFAULTS.morningTime,
	midday: APP_SETTINGS_DEFAULTS.middayTime,
	evening: APP_SETTINGS_DEFAULTS.eveningTime
};

const times = ref<Record<SlotKey, string>>({ ...FALLBACKS });
const allowed = ref<boolean | null>(null);

// only the native build can schedule anything, so a web run says nothing at all
const denied = computed(() => allowed.value === false);

/** ion-datetime speaks ISO, so the clock time rides on a throwaway date */
function isoFor(slot: SlotKey): string {
	return `2000-01-01T${times.value[slot]}:00`;
}

function toClock(value: unknown, fallback: string): string {
	if (typeof value !== 'string') return fallback;
	const match = /(?:^|T)(\d{1,2}):(\d{2})/.exec(value);
	return match ? coerceTime(`${match[1]}:${match[2]}`, fallback) : fallback;
}

async function onChange(slot: SlotKey, event: CustomEvent) {
	const raw = (event.detail as { value?: string | string[] | null } | undefined)?.value;
	const value = Array.isArray(raw) ? raw[0] : raw;

	times.value = { ...times.value, [slot]: toClock(value, FALLBACKS[slot]) };
	await setTimes(times.value);
}

onMounted(async () => {
	await init();
	times.value = {
		morning: coerceTime(settings.value.morningTime, FALLBACKS.morning),
		midday: coerceTime(settings.value.middayTime, FALLBACKS.midday),
		evening: coerceTime(settings.value.eveningTime, FALLBACKS.evening)
	};

	if (Capacitor.isNativePlatform()) {
		allowed.value = await requireNotifications('notifications');
	}
});
</script>
