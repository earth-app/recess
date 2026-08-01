<template>
	<div class="flex min-h-full flex-col justify-center gap-8 px-6 py-12">
		<div class="flex flex-col items-center gap-3 text-center">
			<h1 class="font-title text-2xl font-semibold tracking-tight">
				{{ t('onboarding.interestsTitle') }}
			</h1>
			<p class="max-w-sm text-sm leading-relaxed opacity-70">
				{{ t('onboarding.interestsBody') }}
			</p>
		</div>

		<div class="flex flex-wrap justify-center gap-2.5">
			<IonChip
				v-for="category in categories"
				:key="category"
				role="button"
				tabindex="0"
				:aria-pressed="isOn(category)"
				:outline="!isOn(category)"
				class="m-0! h-11! rounded-full! border! px-4! text-sm! font-semibold!"
				:style="chipStyle(category)"
				@click="toggle(category)"
				@keydown.enter.prevent="toggle(category)"
				@keydown.space.prevent="toggle(category)"
			>
				<UIcon
					:name="ICONS[category]"
					class="mr-2! text-base!"
				/>
				{{ t(`nudge.category.${category}`) }}
			</IonChip>
		</div>

		<div class="flex flex-col items-center gap-1.5 text-center">
			<p class="max-w-sm text-xs leading-relaxed opacity-60">
				{{ t('onboarding.interestsNothingHidden') }}
			</p>
			<p class="text-xs opacity-40">
				{{ t('onboarding.interestsCount', { count: selected.length }) }}
			</p>
		</div>
	</div>
</template>

<script setup lang="ts">
import type { NudgeCategory } from '~/types/nudge';
import { NUDGE_CATEGORIES } from '~/types/nudge';
import { readableOn, resolveColor, withAlpha } from '~/utils/color';
import { categoryColorToken } from '~/utils/playground';

const { t } = useI18n();
const { setInterests } = useOnboarding();
const { settings, init } = useAppSettings();
const haptics = useHaptics();

const ICONS: Record<NudgeCategory, string> = {
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

const categories = NUDGE_CATEGORIES;
const selected = ref<NudgeCategory[]>([]);

function isOn(category: NudgeCategory): boolean {
	return selected.value.includes(category);
}

function chipStyle(category: NudgeCategory) {
	const token = categoryColorToken(category);
	return {
		'--background': isOn(category) ? resolveColor(token) : withAlpha(token, 0.12),
		'--color': isOn(category) ? readableOn(token) : resolveColor(token)
	};
}

async function toggle(category: NudgeCategory) {
	selected.value = isOn(category)
		? selected.value.filter((entry) => entry !== category)
		: [...selected.value, category];

	haptics.selection();
	// interests only weight the recommender, so an empty set is a valid answer
	await setInterests(selected.value);
}

onMounted(async () => {
	await init();
	selected.value = [...settings.value.interests];
});
</script>
