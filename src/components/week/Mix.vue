<template>
	<div
		v-if="slices.length > 0"
		class="flex flex-col gap-3 rounded-2xl border border-(--ion-background-color-step-150) bg-(--ion-background-color-step-50) p-4"
	>
		<span
			class="text-[0.6875rem] font-semibold tracking-wide text-(--ion-text-color-step-400) uppercase"
		>
			{{ t('week.mixTitle') }}
		</span>

		<div
			class="flex h-3 w-full gap-px overflow-hidden rounded-full bg-(--ion-background-color-step-150)"
		>
			<div
				v-for="slice in slices"
				:key="slice.category"
				class="min-w-1"
				:style="{ width: slice.width, background: slice.color }"
			/>
		</div>

		<div class="flex flex-wrap gap-x-4 gap-y-1.5">
			<span
				v-for="slice in slices"
				:key="slice.category"
				class="flex items-center gap-1.5 text-xs font-medium"
			>
				<span
					class="size-2.5 shrink-0 rounded-full"
					:style="{ background: slice.color }"
				/>
				<span>{{ slice.label }}</span>
				<span class="tabular-nums text-(--ion-text-color-step-400)">{{ slice.count }}</span>
			</span>
		</div>
	</div>
</template>

<script setup lang="ts">
import type { WeekSummary } from '~/composables/useWeek';
import { resolveColor } from '~/utils/color';
import { categoryColorToken } from '~/utils/playground';

const props = defineProps<{
	mix: WeekSummary['mix'];
	total: number;
}>();

const { t } = useI18n();

const slices = computed(() => {
	// the summary's own total already excludes skips; fall back to the mix itself
	const total =
		props.total > 0 ? props.total : props.mix.reduce((sum, item) => sum + item.count, 0);
	if (total <= 0) return [];

	return props.mix.map((item) => ({
		category: item.category,
		count: item.count,
		label: t(`nudge.category.${item.category}`),
		color: resolveColor(categoryColorToken(item.category)),
		width: `${(item.count / total) * 100}%`
	}));
});
</script>
