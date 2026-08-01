<template>
	<IonPage>
		<IonHeader :translucent="true">
			<IonToolbar>
				<IonButtons slot="start">
					<IonBackButton default-href="/tabs/settings" />
				</IonButtons>
				<IonTitle>{{ t('settings.nudges') }}</IonTitle>
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
						:style="{ background: withAlpha('@gold', 0.16) }"
					>
						<UIcon
							name="mdi:counter"
							class="text-xl"
							:style="{ color: resolveColor('@gold') }"
						/>
					</span>

					<IonLabel>
						<h2 class="text-base! font-semibold!">{{ t('settings.dailyCount') }}</h2>
					</IonLabel>

					<IonNote
						slot="end"
						class="self-center! pt-0! text-sm! font-semibold! tabular-nums! text-(--ion-text-color-step-300)!"
					>
						{{ t('settings.dailyCountValue', { count: settings.dailyCount }) }}
					</IonNote>
				</IonItem>

				<IonItem lines="none">
					<IonRange
						color="primary"
						class="py-3!"
						:min="1"
						:max="8"
						:step="1"
						:snaps="true"
						:ticks="true"
						:pin="true"
						:value="settings.dailyCount"
						@ion-change="(event) => writeNumber('dailyCount', event.detail.value)"
					/>
				</IonItem>
			</IonList>

			<IonList
				:inset="true"
				class="mt-4!"
			>
				<IonItem
					lines="full"
					class="[--min-height:70px]"
				>
					<span
						slot="start"
						class="flex size-10 items-center justify-center rounded-2xl"
						:style="{ background: withAlpha('@orange', 0.16) }"
					>
						<UIcon
							name="mdi:calendar-refresh-outline"
							class="text-xl"
							:style="{ color: resolveColor('@orange') }"
						/>
					</span>

					<IonLabel class="whitespace-normal!">
						<h2 class="text-base! font-semibold!">{{ t('settings.cooldown') }}</h2>
						<p class="mt-0.5! text-sm! text-(--ion-text-color-step-400)!">
							{{ t('settings.cooldownHint') }}
						</p>
					</IonLabel>

					<IonNote
						slot="end"
						class="self-center! pt-0! text-sm! font-semibold! tabular-nums! text-(--ion-text-color-step-300)!"
					>
						{{
							t('settings.cooldownValue', { count: settings.cooldownDays }, settings.cooldownDays)
						}}
					</IonNote>
				</IonItem>

				<IonItem lines="none">
					<IonRange
						color="primary"
						class="py-3!"
						:min="1"
						:max="180"
						:step="1"
						:pin="true"
						:value="settings.cooldownDays"
						@ion-change="(event) => writeNumber('cooldownDays', event.detail.value)"
					/>
				</IonItem>
			</IonList>

			<IonList
				:inset="true"
				class="mt-4!"
			>
				<IonItem
					lines="full"
					class="[--min-height:70px]"
				>
					<span
						slot="start"
						class="flex size-10 items-center justify-center rounded-2xl"
						:style="{ background: withAlpha('@green', 0.16) }"
					>
						<UIcon
							name="mdi:shape-outline"
							class="text-xl"
							:style="{ color: resolveColor('@green') }"
						/>
					</span>

					<IonLabel class="whitespace-normal!">
						<h2 class="text-base! font-semibold!">{{ t('settings.categories') }}</h2>
						<p class="mt-0.5! text-sm! text-(--ion-text-color-step-400)!">
							{{ t('settings.categoriesHint') }}
						</p>
					</IonLabel>
				</IonItem>

				<IonItem
					v-for="(category, index) in NUDGE_CATEGORIES"
					:key="category"
					:lines="index === NUDGE_CATEGORIES.length - 1 ? 'none' : 'full'"
					class="[--min-height:56px]"
				>
					<span
						slot="start"
						class="flex size-9 items-center justify-center rounded-full"
						:style="{ background: withAlpha(categoryColorToken(category), 0.16) }"
					>
						<UIcon
							:name="CATEGORY_ICONS[category]"
							class="text-lg"
							:style="{ color: resolveColor(categoryColorToken(category)) }"
						/>
					</span>

					<IonCheckbox
						color="primary"
						:checked="isEnabled(category)"
						:disabled="isOnlyEnabled(category)"
						justify="space-between"
						@ion-change="(event) => toggleEnabled(category, event.detail.checked)"
					>
						<span class="text-base!">{{ t(`nudge.category.${category}`) }}</span>
					</IonCheckbox>
				</IonItem>
			</IonList>

			<IonList
				:inset="true"
				class="mt-4!"
			>
				<IonItem
					lines="full"
					class="[--min-height:70px]"
				>
					<span
						slot="start"
						class="flex size-10 items-center justify-center rounded-2xl"
						:style="{ background: withAlpha('@pink', 0.16) }"
					>
						<UIcon
							name="mdi:heart-outline"
							class="text-xl"
							:style="{ color: resolveColor('@pink') }"
						/>
					</span>

					<IonLabel class="whitespace-normal!">
						<h2 class="text-base! font-semibold!">{{ t('settings.interests') }}</h2>
						<p class="mt-0.5! text-sm! text-(--ion-text-color-step-400)!">
							{{ t('settings.interestsHint') }}
						</p>
					</IonLabel>
				</IonItem>

				<IonItem lines="none">
					<div class="flex flex-wrap gap-2.5 py-4">
						<IonChip
							v-for="category in NUDGE_CATEGORIES"
							:key="category"
							role="button"
							tabindex="0"
							:aria-pressed="isInterest(category)"
							:outline="!isInterest(category)"
							:color="isInterest(category) ? 'primary' : 'medium'"
							class="m-0! h-11! rounded-full! border! px-3.5! text-sm! font-semibold!"
							@click="toggleInterest(category)"
							@keydown.enter.prevent="toggleInterest(category)"
							@keydown.space.prevent="toggleInterest(category)"
						>
							<UIcon
								:name="CATEGORY_ICONS[category]"
								class="mr-1.5! text-base!"
							/>
							{{ t(`nudge.category.${category}`) }}
						</IonChip>
					</div>
				</IonItem>
			</IonList>

			<div class="h-8" />
		</IonContent>
	</IonPage>
</template>

<script setup lang="ts">
import type { NudgeCategory } from '~/types/nudge';
import { NUDGE_CATEGORIES } from '~/types/nudge';
import { resolveColor, withAlpha } from '~/utils/color';
import { categoryColorToken } from '~/utils/playground';

const { t } = useI18n();
const { settings, setValue } = useAppSettings();
const { toast } = useNotify();

// mirrors onboarding/Interests.vue so a category reads the same wherever it is listed
const CATEGORY_ICONS: Record<NudgeCategory, string> = {
	people: 'mdi:account-group-outline',
	adventure: 'mdi:compass-outline',
	home: 'mdi:home-outline',
	learn: 'mdi:book-open-page-variant-outline',
	cooking: 'mdi:silverware-fork-knife',
	nature: 'mdi:leaf',
	errands: 'mdi:cart-outline',
	exercise: 'mdi:run',
	art: 'mdi:palette-outline'
};

function isEnabled(category: NudgeCategory): boolean {
	return settings.value.enabledCategories.includes(category);
}

/** the last one standing is disabled outright; an empty list would leave no nudges */
function isOnlyEnabled(category: NudgeCategory): boolean {
	const enabled = settings.value.enabledCategories;
	return enabled.length === 1 && enabled[0] === category;
}

function isInterest(category: NudgeCategory): boolean {
	return settings.value.interests.includes(category);
}

async function toggleEnabled(category: NudgeCategory, on: boolean) {
	const enabled = settings.value.enabledCategories;
	const next = on
		? [...new Set([...enabled, category])]
		: enabled.filter((entry) => entry !== category);

	if (next.length === 0) {
		await toast(t('settings.categoriesFloor'));
		return;
	}

	await setValue('enabledCategories', next);
}

async function toggleInterest(category: NudgeCategory) {
	const interests = settings.value.interests;
	await setValue(
		'interests',
		interests.includes(category)
			? interests.filter((entry) => entry !== category)
			: [...interests, category]
	);
}

async function writeNumber(
	key: 'dailyCount' | 'cooldownDays',
	value: number | { lower: number; upper: number }
) {
	if (typeof value !== 'number') return;
	await setValue(key, value);
}
</script>
