<template>
	<div
		class="flex flex-col gap-4 rounded-2xl border border-(--ion-background-color-step-150) bg-(--ion-background-color-step-50) p-4"
	>
		<div
			v-if="days.length > 0"
			class="flex flex-col gap-2"
		>
			<UiStreakStrip
				:days="days"
				variant="bars"
			/>

			<div
				v-if="note"
				class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5"
			>
				<span
					class="text-sm font-semibold"
					:style="fresh ? { color: SUCCESS_INK } : undefined"
				>
					{{ note }}
				</span>
				<span
					v-if="noteHint"
					class="text-xs font-medium text-(--ion-text-color-step-400)"
				>
					{{ noteHint }}
				</span>
			</div>
		</div>

		<div class="grid grid-cols-3 divide-x divide-(--ion-background-color-step-150)">
			<div
				v-for="stat in stats"
				:key="stat.key"
				class="flex flex-col items-center gap-1 px-2"
			>
				<UiCountUp
					:value="stat.value"
					class="text-3xl leading-none font-semibold"
				/>
				<span class="text-center text-xs font-medium text-(--ion-text-color-step-350)">
					{{ stat.label }}
				</span>
			</div>
		</div>

		<p
			class="flex items-center justify-center gap-1.5 rounded-full bg-(--ion-background-color-step-100) py-1.5 text-xs font-semibold text-(--ion-text-color-step-250)"
		>
			<UIcon
				name="mdi:sparkles"
				class="shrink-0 text-sm"
			/>
			{{ t('common.points', { count: summary.points }) }}
		</p>
	</div>
</template>

<script setup lang="ts">
import type { WeekSummary } from '~/composables/useWeek';
import type { StreakDay } from '~/types/context';

const props = withDefaults(
	defineProps<{
		summary: WeekSummary;
		/** the trailing 7 days; omitted for a past week, which has no live streak */
		days?: readonly StreakDay[];
		note?: string | null;
		noteHint?: string | null;
		fresh?: boolean;
	}>(),
	{ days: () => [], note: null, noteHint: null, fresh: false }
);

const { t } = useI18n();

// the raw success green clears 4.5:1 on white but not on a step-50 card, so pull it
// toward the page's own text colour
const SUCCESS_INK = 'color-mix(in srgb, var(--ion-color-success) 68%, var(--ion-text-color))';

const stats = computed(() => [
	{ key: 'resolved', value: props.summary.resolved, label: t('week.resolved') },
	{ key: 'categories', value: props.summary.categories.length, label: t('week.categories') },
	{ key: 'minutes', value: props.summary.minutes, label: t('week.minutes') }
]);
</script>
