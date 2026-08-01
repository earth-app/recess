<template>
	<IonPage>
		<IonHeader :translucent="true">
			<IonToolbar>
				<IonTitle>{{ t('settings.title') }}</IonTitle>
			</IonToolbar>
		</IonHeader>

		<IonContent>
			<IonList
				:inset="true"
				class="mt-2!"
			>
				<IonItem
					v-for="section in sections"
					:key="section.href"
					:router-link="section.href"
					:data-testid="`settings-${section.key}`"
					:detail="true"
					button
					lines="full"
					class="[--min-height:66px]"
				>
					<span
						slot="start"
						class="flex size-10 items-center justify-center rounded-2xl"
						:style="{ background: withAlpha(section.token, 0.16) }"
					>
						<UIcon
							:name="section.icon"
							class="text-xl"
							:style="{ color: resolveColor(section.token) }"
						/>
					</span>

					<IonLabel class="whitespace-normal!">
						<h2 class="text-base! font-semibold!">{{ section.label }}</h2>
						<p class="mt-0.5! text-sm! text-(--ion-text-color-step-400)!">
							{{ section.description }}
						</p>
					</IonLabel>
				</IonItem>
			</IonList>

			<p class="px-8 pt-2 pb-10 text-center text-xs text-(--ion-text-color-step-400)">
				{{ t('settings.storedOnDevice') }}
			</p>
		</IonContent>
	</IonPage>
</template>

<script setup lang="ts">
import { resolveColor, withAlpha } from '~/utils/color';

const { t } = useI18n();

const sections = computed(() => [
	{
		key: 'appearance',
		href: '/tabs/settings/appearance',
		icon: 'mdi:palette-outline',
		token: '@purple',
		label: t('settings.appearance'),
		description: t('settings.appearanceDescription')
	},
	{
		key: 'nudges',
		href: '/tabs/settings/nudges',
		icon: 'mdi:lightbulb-on-outline',
		token: '@gold',
		label: t('settings.nudges'),
		description: t('settings.nudgesDescription')
	},
	{
		key: 'notifications',
		href: '/tabs/settings/notifications',
		icon: 'mdi:bell-outline',
		token: '@orange',
		label: t('settings.notifications'),
		description: t('settings.notificationsDescription')
	},
	{
		key: 'models',
		href: '/tabs/settings/models',
		icon: 'mdi:chip',
		token: '@teal',
		label: t('settings.models'),
		description: t('settings.modelsDescription')
	},
	{
		key: 'data',
		href: '/tabs/settings/data',
		icon: 'mdi:database-outline',
		token: '@blue',
		label: t('settings.data'),
		description: t('settings.dataDescription')
	},
	{
		key: 'about',
		href: '/tabs/settings/about',
		icon: 'mdi:information-outline',
		token: '@green',
		label: t('settings.about'),
		description: t('settings.aboutDescription')
	}
]);
</script>
