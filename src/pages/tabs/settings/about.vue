<template>
	<IonPage>
		<IonHeader :translucent="true">
			<IonToolbar>
				<IonButtons slot="start">
					<IonBackButton default-href="/tabs/settings" />
				</IonButtons>
				<IonTitle>{{ t('settings.about') }}</IonTitle>
			</IonToolbar>
		</IonHeader>

		<IonContent :fullscreen="true">
			<div class="flex flex-col items-center gap-3 px-8 pt-10 pb-2 text-center">
				<span
					class="flex size-20 items-center justify-center rounded-3xl"
					:style="{ background: withAlpha('@orange', 0.16) }"
				>
					<UIcon
						name="mdi:weather-sunny"
						class="text-4xl"
						:style="{ color: resolveColor('@orange') }"
					/>
				</span>

				<h1 class="font-title text-2xl font-semibold tracking-tight">{{ t('app.name') }}</h1>
				<p class="text-sm text-(--ion-text-color-step-300)">{{ t('app.tagline') }}</p>
			</div>

			<p
				class="mx-auto max-w-sm px-8 pt-4 pb-1 text-center text-sm leading-relaxed text-(--ion-text-color-step-300)"
			>
				{{ t('settings.aboutBody') }}
			</p>

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
							name="mdi:tag-outline"
							class="text-xl"
							:style="{ color: resolveColor('@blue') }"
						/>
					</span>

					<IonLabel>
						<h2 class="text-base! font-semibold!">{{ t('settings.version', { version }) }}</h2>
					</IonLabel>
				</IonItem>

				<IonItem
					lines="full"
					class="[--min-height:62px]"
				>
					<span
						slot="start"
						class="flex size-10 items-center justify-center rounded-2xl"
						:style="{ background: withAlpha('@indigo', 0.16) }"
					>
						<UIcon
							name="mdi:scale-balance"
							class="text-xl"
							:style="{ color: resolveColor('@indigo') }"
						/>
					</span>

					<IonLabel>
						<h2 class="text-base! font-semibold!">{{ t('settings.license') }}</h2>
					</IonLabel>

					<IonNote
						slot="end"
						class="self-center! pt-0! text-sm! text-(--ion-text-color-step-400)!"
						>{{ t('settings.licenseValue') }}</IonNote
					>
				</IonItem>

				<IonItem
					lines="none"
					class="[--min-height:66px]"
				>
					<span
						slot="start"
						class="flex size-10 items-center justify-center rounded-2xl"
						:style="{ background: withAlpha('@green', 0.16) }"
					>
						<UIcon
							name="mdi:shield-check-outline"
							class="text-xl"
							:style="{ color: resolveColor('@green') }"
						/>
					</span>

					<IonLabel class="whitespace-normal!">
						<h2 class="text-base! font-semibold!">{{ t('settings.privacyTitle') }}</h2>
						<p class="mt-0.5! text-sm! leading-snug! text-(--ion-text-color-step-400)!">
							{{ t('settings.storedOnDevice') }}
						</p>
					</IonLabel>
				</IonItem>
			</IonList>

			<div class="h-10" />
		</IonContent>
	</IonPage>
</template>

<script setup lang="ts">
import { resolveColor, withAlpha } from '~/utils/color';

// injected by vite's `define`; never read from a hardcoded string
declare const __APP_VERSION__: string;

const { t } = useI18n();

const version = __APP_VERSION__;
</script>
