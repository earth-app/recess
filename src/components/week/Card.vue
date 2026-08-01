<template>
	<div
		class="flex flex-col overflow-hidden rounded-2xl border border-(--ion-background-color-step-150)"
	>
		<button
			type="button"
			class="flex w-full! items-center justify-between gap-3 bg-(--ion-background-color-step-50)! px-4! py-3! text-left! active:bg-(--ion-background-color-step-100)!"
			:aria-expanded="open"
			:aria-label="`${open ? t('common.close') : t('week.openWeek')}: ${label}`"
			@click="toggle"
		>
			<span class="flex flex-col gap-0.5">
				<span class="text-sm font-semibold">{{ label }}</span>
				<span class="text-xs font-medium text-(--ion-text-color-step-400)">{{ subtitle }}</span>
			</span>

			<UIcon
				:name="open ? 'mdi:chevron-up' : 'mdi:chevron-down'"
				class="shrink-0 text-xl text-(--ion-text-color-step-400)"
			/>
		</button>

		<div
			v-if="open"
			class="flex flex-col gap-3 border-t border-(--ion-background-color-step-150) p-4"
		>
			<WeekStats :summary="summary" />

			<WeekMix
				:mix="summary.mix"
				:total="summary.resolved"
			/>

			<div
				class="rounded-2xl border border-(--ion-background-color-step-150) bg-(--ion-background-color-step-50) p-4"
			>
				<div
					v-if="!note"
					class="flex items-center gap-3"
				>
					<IonSpinner
						name="crescent"
						color="primary"
						class="size-5!"
					/>
					<span class="text-sm text-(--ion-text-color-step-300)">
						{{ t('week.reflectionWaiting') }}
					</span>
				</div>
				<p
					v-else
					class="text-sm leading-relaxed text-pretty"
				>
					{{ note }}
				</p>
			</div>

			<WeekHighlights :entries="summary.highlights" />
		</div>
	</div>
</template>

<script setup lang="ts">
import type { WeekSummary } from '~/composables/useWeek';

const props = defineProps<{ summary: WeekSummary }>();

const { t, locale } = useI18n();
const { reflection } = useWeek();
const progress = useProgressStore();

const open = ref(false);
const note = ref('');

/** monday of an iso week key; jan 4 is always inside iso week 1 */
function mondayOf(week: string): Date | null {
	const match = /^(\d{4})-W(\d{1,2})$/.exec(week);
	if (!match) return null;

	const jan4 = new Date(Date.UTC(Number(match[1]), 0, 4));
	const offset = (jan4.getUTCDay() || 7) - 1;
	const firstMonday = jan4.getTime() - offset * 86_400_000;
	return new Date(firstMonday + (Number(match[2]) - 1) * 7 * 86_400_000);
}

const label = computed(() => {
	const monday = mondayOf(props.summary.week);
	if (!monday) return props.summary.week;

	const date = new Intl.DateTimeFormat(locale.value, {
		month: 'short',
		day: 'numeric',
		timeZone: 'UTC'
	}).format(monday);

	return t('week.weekOf', { date });
});

const subtitle = computed(() =>
	t('week.nudgesValue', { count: props.summary.resolved }, props.summary.resolved)
);

async function toggle() {
	open.value = !open.value;
	if (!open.value || note.value) return;

	try {
		note.value = await reflection(props.summary.week);
	} catch {
		// never leave a spinner running; the deterministic line is always available
		note.value = fallbackReflection(progress.entriesForWeek(props.summary.week));
	}
}
</script>
