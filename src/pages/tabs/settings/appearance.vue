<template>
	<IonPage>
		<IonHeader :translucent="true">
			<IonToolbar>
				<IonButtons slot="start">
					<IonBackButton default-href="/tabs/settings" />
				</IonButtons>
				<IonTitle>{{ t('settings.appearance') }}</IonTitle>
			</IonToolbar>
		</IonHeader>

		<IonContent :fullscreen="true">
			<IonList
				:inset="true"
				class="mt-2!"
			>
				<IonItem
					lines="full"
					class="[--min-height:62px]"
				>
					<span
						slot="start"
						class="flex size-10 items-center justify-center rounded-2xl"
						:style="{ background: withAlpha('@purple', 0.16) }"
					>
						<UIcon
							name="mdi:theme-light-dark"
							class="text-xl"
							:style="{ color: resolveColor('@purple') }"
						/>
					</span>

					<IonSelect
						:label="t('settings.theme')"
						label-placement="start"
						interface="popover"
						:value="settings.theme"
						@ion-change="(event) => write('theme', event.detail.value)"
					>
						<IonSelectOption
							v-for="option in themes"
							:key="option.value"
							:value="option.value"
						>
							{{ option.label }}
						</IonSelectOption>
					</IonSelect>
				</IonItem>

				<IonItem
					lines="none"
					class="[--min-height:62px]"
				>
					<span
						slot="start"
						class="flex size-10 items-center justify-center rounded-2xl"
						:style="{ background: withAlpha('@indigo', 0.16) }"
					>
						<UIcon
							name="mdi:format-font"
							class="text-xl"
							:style="{ color: resolveColor('@indigo') }"
						/>
					</span>

					<IonSelect
						:label="t('settings.font')"
						label-placement="start"
						interface="popover"
						:value="settings.font"
						@ion-change="(event) => write('font', event.detail.value)"
					>
						<IonSelectOption
							v-for="option in fonts"
							:key="option.value"
							:value="option.value"
						>
							{{ option.label }}
						</IonSelectOption>
					</IonSelect>
				</IonItem>
			</IonList>

			<IonList
				:inset="true"
				class="mt-4!"
			>
				<IonItem
					lines="full"
					class="[--min-height:62px]"
				>
					<span
						slot="start"
						class="flex size-10 items-center justify-center rounded-2xl"
						:style="{ background: withAlpha('@blue', 0.16) }"
					>
						<UIcon
							name="mdi:format-size"
							class="text-xl"
							:style="{ color: resolveColor('@blue') }"
						/>
					</span>

					<IonLabel>
						<h2 class="text-base! font-semibold!">{{ t('settings.textSize') }}</h2>
					</IonLabel>

					<IonNote
						slot="end"
						class="self-center! pt-0! text-sm! font-semibold! tabular-nums! text-(--ion-text-color-step-300)!"
						>{{ scaleLabel }}</IonNote
					>
				</IonItem>

				<IonItem lines="none">
					<IonRange
						color="primary"
						class="py-3!"
						:min="SCALE_MIN"
						:max="SCALE_MAX"
						:step="0.05"
						:snaps="true"
						:value="scale"
						@ion-change="(event) => writeScale(event.detail.value)"
					>
						<span
							slot="start"
							class="text-xs text-(--ion-text-color-step-400)"
						>
							A
						</span>
						<span
							slot="end"
							class="text-lg text-(--ion-text-color-step-400)"
						>
							A
						</span>
					</IonRange>
				</IonItem>
			</IonList>

			<p
				class="mx-auto max-w-sm px-8 pt-1 pb-2 text-center text-sm leading-relaxed text-(--ion-text-color-step-300)"
			>
				{{ t('settings.textSizePreview') }}
			</p>

			<IonList
				:inset="true"
				class="mt-4!"
			>
				<IonItem
					v-for="row in switches"
					:key="row.key"
					:lines="row.key === 'sounds' ? 'none' : 'full'"
					class="[--min-height:70px]"
				>
					<span
						slot="start"
						class="flex size-10 items-center justify-center rounded-2xl"
						:style="{ background: withAlpha(row.token, 0.16) }"
					>
						<UIcon
							:name="row.icon"
							class="text-xl"
							:style="{ color: resolveColor(row.token) }"
						/>
					</span>

					<IonToggle
						color="primary"
						:checked="settings[row.key]"
						@ion-change="(event) => write(row.key, event.detail.checked)"
					>
						<span class="flex! flex-col! gap-0.5! py-1! whitespace-normal!">
							<span class="text-base! font-semibold!">{{ row.label }}</span>
							<span class="text-sm! leading-snug! text-(--ion-text-color-step-400)!">
								{{ row.hint }}
							</span>
						</span>
					</IonToggle>
				</IonItem>
			</IonList>

			<div class="h-8" />
		</IonContent>
	</IonPage>
</template>

<script setup lang="ts">
import type { AppSettingKey } from '~/composables/useSettings';
import { resolveColor, withAlpha } from '~/utils/color';

const SCALE_MIN = 0.7;
const SCALE_MAX = 1.5;

const { t } = useI18n();
const { settings, setValue } = useAppSettings();

const themes = computed(() => [
	{ value: 'system', label: t('settings.themeSystem') },
	{ value: 'light', label: t('settings.themeLight') },
	{ value: 'dark', label: t('settings.themeDark') }
]);

const fonts = computed(() => [
	{ value: 'system', label: t('settings.fontSystem') },
	{ value: 'inter', label: t('settings.fontInter') },
	{ value: 'roboto', label: t('settings.fontRoboto') },
	{ value: 'open-sans', label: t('settings.fontOpenSans') },
	{ value: 'noto-sans', label: t('settings.fontNotoSans') }
]);

const switches = computed<
	{
		key: 'animations' | 'haptics' | 'sounds';
		label: string;
		hint: string;
		icon: string;
		token: string;
	}[]
>(() => [
	{
		key: 'animations',
		label: t('settings.animations'),
		hint: t('settings.animationsHint'),
		icon: 'mdi:animation-outline',
		token: '@teal'
	},
	{
		key: 'haptics',
		label: t('settings.haptics'),
		hint: t('settings.hapticsHint'),
		icon: 'mdi:vibrate',
		token: '@coral'
	},
	{
		key: 'sounds',
		label: t('settings.sounds'),
		hint: t('settings.soundsHint'),
		icon: 'mdi:volume-high',
		token: '@orange'
	}
]);

const scale = computed(() => {
	const parsed = Number.parseFloat(settings.value.scale);
	return Number.isFinite(parsed) ? parsed : 1;
});

const scaleLabel = computed(() => `${Math.round(scale.value * 100)}%`);

/** coerceSetting owns every bound and enum check, so anything unknown is safe here */
async function write(key: AppSettingKey, value: unknown) {
	await setValue(key, coerceSetting(key, value));
}

async function writeScale(value: number | { lower: number; upper: number }) {
	if (typeof value !== 'number') return;
	await write('scale', String(value));
}
</script>
