<template>
	<IonPage>
		<IonHeader :translucent="true">
			<IonToolbar>
				<IonTitle>{{ t('week.title') }}</IonTitle>
			</IonToolbar>
		</IonHeader>

		<IonContent :fullscreen="true">
			<div
				v-if="isBlank"
				class="flex min-h-full flex-col items-center justify-center gap-3 px-8 py-16 text-center"
			>
				<span
					class="flex size-16 items-center justify-center rounded-2xl bg-(--ion-background-color-step-100)"
				>
					<UIcon
						name="mdi:calendar-blank-outline"
						class="text-3xl text-(--ion-text-color-step-400)"
					/>
				</span>
				<h2 class="text-xl font-semibold text-balance">{{ t('week.emptyTitle') }}</h2>
				<p class="max-w-xs text-sm leading-relaxed text-pretty text-(--ion-text-color-step-250)">
					{{ t('week.emptyBody') }}
				</p>

				<IonButton
					fill="solid"
					color="primary"
					router-link="/tabs/today"
					class="mt-2! rounded-full! px-5! text-sm! font-semibold!"
				>
					{{ t('week.exit') }}
				</IonButton>
			</div>

			<div
				v-else
				class="flex flex-col gap-8 px-4 py-6"
			>
				<section class="flex flex-col gap-3">
					<h2 class="px-1 text-lg font-semibold">{{ t('week.thisWeek') }}</h2>

					<WeekStats
						:summary="thisWeek"
						:days="streakDays"
						:note="streakNote"
						:note-hint="streakHint"
						:fresh="streakBest.isNew"
					/>

					<WeekMix
						:mix="thisWeek.mix"
						:total="thisWeek.resolved"
					/>
				</section>

				<section class="flex flex-col gap-3">
					<h2 class="px-1 text-lg font-semibold">{{ t('week.reflectionTitle') }}</h2>

					<div
						class="flex flex-col gap-2 rounded-2xl border border-(--ion-background-color-step-150) bg-(--ion-background-color-step-50) p-4"
					>
						<div
							v-if="reflecting || !reflectionText"
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
						<template v-else>
							<UIcon
								name="mdi:format-quote-open"
								class="text-2xl text-(--ion-text-color-step-400)"
							/>
							<p class="text-base leading-relaxed text-pretty">{{ reflectionText }}</p>
						</template>
					</div>
				</section>

				<WeekHighlights :entries="thisWeek.highlights" />

				<section
					v-if="newBests.length > 0"
					class="flex flex-col gap-3"
				>
					<h2 class="px-1 text-lg font-semibold">{{ t('week.bestsTitle') }}</h2>

					<div
						v-for="best in newBests"
						:key="best.key"
						class="flex items-center justify-between gap-3 rounded-2xl border px-4 py-3"
						:style="bestStyle"
					>
						<span class="flex items-center gap-2 text-sm font-semibold">
							<UIcon
								name="mdi:arrow-up-bold-circle-outline"
								class="shrink-0 text-lg"
								:style="{ color: SUCCESS_INK }"
							/>
							{{ best.label }}
						</span>
						<span
							class="shrink-0 text-sm font-semibold tabular-nums text-(--ion-text-color-step-300)"
						>
							{{ best.value }}
						</span>
					</div>

					<p class="px-1 text-xs text-(--ion-text-color-step-400)">{{ t('week.bestsBody') }}</p>
				</section>

				<section
					v-if="pastWeeks.length > 0"
					class="flex flex-col gap-3"
				>
					<h2 class="px-1 text-lg font-semibold">{{ t('week.pastTitle') }}</h2>

					<WeekCard
						v-for="past in pastSummaries"
						:key="past.week"
						:summary="past"
					/>

					<p class="px-1 text-xs text-(--ion-text-color-step-400)">{{ t('week.archiveNote') }}</p>
				</section>

				<div
					class="flex flex-col items-center gap-2 border-t border-(--ion-background-color-step-150) pt-6 pb-8"
				>
					<p class="text-xs text-(--ion-text-color-step-400)">{{ t('week.exitBody') }}</p>

					<IonButton
						fill="solid"
						color="primary"
						router-link="/tabs/today"
						class="rounded-full! px-5! text-sm! font-semibold!"
					>
						{{ t('week.exit') }}
					</IonButton>
				</div>
			</div>
		</IonContent>
	</IonPage>
</template>

<script setup lang="ts">
import type { BestFraming } from '~/composables/usePersonalBest';
import { isoWeekKey } from '~/utils/day';

// A finite surface. Five sections, then one way out. Nothing here loads more, and
// every cue is measured against this user's own history - there is nobody else.

const { t } = useI18n();
const progress = useProgressStore();
const { currentWeek, thisWeek, pastWeeks, reflecting, summaryFor, reflection } = useWeek();
const { streak: streakBest } = usePersonalBest();

const reflectionText = ref('');

// the raw success green clears 4.5:1 on white but not on a step-50 card, so pull it
// toward the page's own text colour
const SUCCESS_INK = 'color-mix(in srgb, var(--ion-color-success) 68%, var(--ion-text-color))';

// a tinted green frame on a tinted green field lands under 2:1, so the frame is the
// full role and only the field is mixed
const bestStyle = {
	borderColor: 'var(--ion-color-success)',
	background: 'color-mix(in srgb, var(--ion-color-success) 7%, var(--ion-background-color))'
};

const streakDays = computed(() => progress.streak.week);
const isBlank = computed(() => thisWeek.value.isEmpty && pastWeeks.value.length === 0);

function framingLabel(framing: BestFraming, best: number): string {
	if (framing.isNew) return t('week.personalBest.longest');
	if (framing.toBeat === 0) return t('week.personalBest.matching');
	if (framing.toBeat !== null) return t('week.personalBest.best', { count: best });
	return t('week.personalBest.starting');
}

const streakNote = computed(() => framingLabel(streakBest.value, progress.streak.longest));

const streakHint = computed(() => {
	const toBeat = streakBest.value.toBeat;
	return toBeat !== null && toBeat > 0 ? t('week.personalBest.toBeat', { count: toBeat }) : null;
});

// #region new bests

const pastSummaries = computed(() => pastWeeks.value.map((week) => summaryFor(week)));

/** the fullest single day this week, but only when no earlier day beat it */
const bestDay = computed(() => {
	const inWeek = new Map<string, number>();
	const earlier = new Map<string, number>();

	for (const entry of progress.entries) {
		if (entry.outcome === 'skipped') continue;
		const bucket = isoWeekKey(new Date(entry.at)) === currentWeek.value ? inWeek : earlier;
		bucket.set(entry.day, (bucket.get(entry.day) ?? 0) + 1);
	}

	const best = Math.max(0, ...inWeek.values());
	const previous = Math.max(0, ...earlier.values());
	return best > 1 && best > previous ? best : null;
});

const newBests = computed(() => {
	const out: { key: string; label: string; value: string }[] = [];
	const week = thisWeek.value;
	const earlier = pastSummaries.value;

	// a first week has nothing of its own to beat, so it claims no week records
	if (earlier.length > 0 && week.resolved > 0) {
		if (earlier.every((past) => week.resolved > past.resolved)) {
			out.push({
				key: 'week',
				label: t('week.bestWeek'),
				value: t('week.nudgesValue', { count: week.resolved }, week.resolved)
			});
		}

		if (week.minutes > 0 && earlier.every((past) => week.minutes > past.minutes)) {
			out.push({
				key: 'minutes',
				label: t('week.bestMinutes'),
				value: t('week.minutesValue', { count: week.minutes })
			});
		}

		if (earlier.every((past) => week.categories.length > past.categories.length)) {
			out.push({
				key: 'spread',
				label: t('week.bestSpread'),
				value: t('week.categoriesValue', { count: week.categories.length }, week.categories.length)
			});
		}
	}

	const streak = progress.streak;
	if (streak.current > 1 && streak.current >= streak.longest) {
		out.push({
			key: 'streak',
			label: t('week.bestStreak'),
			value: t('week.daysValue', { count: streak.current }, streak.current)
		});
	}

	if (bestDay.value !== null) {
		out.push({
			key: 'day',
			label: t('week.bestDay'),
			value: t('week.nudgesValue', { count: bestDay.value }, bestDay.value)
		});
	}

	return out;
});

// #endregion

onMounted(async () => {
	await progress.load();
	try {
		reflectionText.value = await reflection(currentWeek.value);
	} catch {
		// the section must never sit on a spinner; the fallback line is deterministic
		reflectionText.value = fallbackReflection(progress.entriesForWeek(currentWeek.value));
	}
});
</script>
