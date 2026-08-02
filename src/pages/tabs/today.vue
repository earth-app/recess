<template>
	<IonPage>
		<IonHeader :translucent="true">
			<IonToolbar>
				<IonTitle>{{ t('today.title') }}</IonTitle>
			</IonToolbar>
		</IonHeader>

		<IonContent :fullscreen="true">
			<IonRefresher
				slot="fixed"
				@ion-refresh="onRefresh"
			>
				<IonRefresherContent />
			</IonRefresher>

			<div class="mx-auto flex w-full max-w-md flex-col gap-6 px-4 pt-4 pb-10">
				<section
					v-if="ready"
					data-testid="today-ready"
					class="flex flex-col gap-4 rounded-3xl border border-(--ion-background-color-step-150) bg-(--ion-background-color-step-50) p-4"
				>
					<div
						v-if="total > 0"
						data-tour="ring"
						class="flex items-center gap-4"
					>
						<UiRing
							:value="done"
							:max="total"
							:size="80"
							:thickness="7"
							color="var(--ion-color-success)"
						/>

						<div class="flex min-w-0 flex-1 flex-col gap-1">
							<h1 class="text-xl leading-tight font-semibold text-balance">{{ headline }}</h1>
							<p class="text-sm font-medium text-(--ion-text-color-step-300)">
								{{ t('today.progress', { done, total }) }}
							</p>
						</div>
					</div>

					<div
						class="flex flex-col gap-2"
						:class="total > 0 ? 'border-t border-(--ion-background-color-step-150) pt-4' : ''"
					>
						<span
							class="text-[0.6875rem] font-semibold tracking-wide text-(--ion-text-color-step-400) uppercase"
						>
							{{ t('today.streakLabel') }}
						</span>

						<UiStreakStrip
							:days="streak.week"
							:label="streakCaption"
						/>
					</div>
				</section>

				<div
					v-if="!ready"
					class="flex justify-center py-20"
				>
					<IonSpinner
						name="crescent"
						color="primary"
					/>
				</div>

				<div
					v-else-if="deckNudges.length > 0"
					class="flex flex-col gap-3"
				>
					<div class="flex items-center justify-between gap-3 px-1">
						<span
							class="text-[0.6875rem] font-semibold tracking-wide text-(--ion-text-color-step-400) uppercase"
						>
							{{ t('today.deckLabel') }}
						</span>
						<span class="text-xs font-semibold tabular-nums text-(--ion-text-color-step-350)">
							{{ deckNudges.length }}
						</span>
					</div>

					<div data-tour="deck">
						<NudgeDeck
							:nudges="deckNudges"
							@open="openNudge"
							@skip="skipNudge"
						/>
					</div>

					<div
						data-deck-hint
						class="flex items-center justify-center gap-3 text-xs font-medium text-(--ion-text-color-step-400)"
					>
						<span class="flex items-center gap-1">
							<UIcon
								name="mdi:gesture-tap"
								class="shrink-0 text-sm"
							/>
							{{ t('today.openNudge') }}
						</span>
						<span class="h-3 w-px bg-(--ion-background-color-step-150)" />
						<span class="flex items-center gap-1">
							<UIcon
								name="mdi:arrow-left-thin"
								class="shrink-0 text-sm"
							/>
							{{ t('nudge.notNow') }}
						</span>
					</div>
				</div>

				<NudgeCaughtUp v-else-if="allResolved" />

				<div
					v-else
					class="flex flex-col items-center gap-3 rounded-3xl border border-(--ion-background-color-step-150) bg-(--ion-background-color-step-50) px-6 py-14 text-center"
				>
					<UIcon
						name="mdi:weather-partly-cloudy"
						class="text-4xl text-(--ion-text-color-step-400)"
					/>
					<h2 class="text-xl font-semibold text-balance">{{ t('today.emptyTitle') }}</h2>
					<p class="text-sm leading-relaxed text-pretty text-(--ion-text-color-step-250)">
						{{ t('today.emptyBody') }}
					</p>
				</div>

				<div
					v-if="ready && todayList.length > 0"
					class="flex flex-col gap-2"
				>
					<div class="flex flex-col gap-0.5 px-1">
						<h2 class="text-base font-semibold">{{ t('today.listTitle') }}</h2>
						<p class="text-xs text-(--ion-text-color-step-400)">{{ t('today.listHint') }}</p>
					</div>

					<div data-tour="list">
						<NudgeList
							:nudges="todayList"
							:resolved-ids="resolvedIds"
							@open="openNudge"
						/>
					</div>
				</div>

				<div
					v-if="ready && bonusHint"
					class="flex w-full items-center gap-3 rounded-2xl border p-3"
					:style="bonusStyle"
				>
					<span
						class="flex size-9 shrink-0 items-center justify-center rounded-xl"
						:style="bonusTileStyle"
					>
						<UIcon
							:name="bonusAvailable ? 'mdi:gift-outline' : 'mdi:lock-outline'"
							class="text-lg"
						/>
					</span>

					<span class="flex min-w-0 flex-col gap-0.5 text-left">
						<span
							class="text-[0.6875rem] font-semibold tracking-wide text-(--ion-text-color-step-400) uppercase"
						>
							{{ t('today.bonusLabel') }}
						</span>
						<span class="text-sm leading-snug font-semibold text-balance">{{ bonusHint }}</span>
					</span>
				</div>
			</div>

			<Tour />

			<NudgeSheet
				:nudge="active"
				:is-open="sheetOpen"
				@did-dismiss="onSheetDismiss"
				@resolved="onResolved"
				@open-nudge="openById"
			/>
		</IonContent>
	</IonPage>
</template>

<script setup lang="ts">
import type { Nudge } from '~/types/nudge';
import { installSeed } from '~/utils/install';

const { t } = useI18n();

const nudges = useNudgesStore();
const progress = useProgressStore();
const settings = useAppSettingsState();
const { build } = useNudgeContext();
const { skip, refreshToday } = useResolve();
const { refresh: refreshWeather } = useWeather();
const { hydrate: hydratePosition } = usePosition();
const { refreshSchedule } = useLocalNotifications();
const { toast } = useNotify();
const { startIfUnseen } = useAppTour();

const ready = ref(false);
const active = ref<Nudge | null>(null);
const sheetOpen = ref(false);

const streak = computed(() => progress.streak);

const resolvedIds = computed(() => nudges.resolvedIds);
const todayList = computed(() => nudges.today);
const total = computed(() => todayList.value.length);
const done = computed(() => total.value - nudges.remaining.length);
const left = computed(() => Math.max(0, total.value - done.value));
const allResolved = computed(() => total.value > 0 && nudges.remaining.length === 0);
const bonusAvailable = computed(() => nudges.bonusAvailable);

const headline = computed(() =>
	left.value === 0 ? t('today.headlineDone') : t('today.headlineLeft', { count: left.value })
);

// same wording as streakLabel() in utils/streak.ts, localised for the screen
const streakCaption = computed(() => {
	const state = streak.value;
	if (state.current === 0) return t('today.streakNone');
	if (state.paused) return t('today.graceUsed');
	if (state.current === 1) return t('today.streakDayOne');
	if (state.current === state.longest && state.current > 2)
		return t('today.streakLongest', { count: state.current });
	return t('today.streakDays', { count: state.current });
});

/** the bonus only joins the deck once every core nudge is resolved */
const deckNudges = computed(() => {
	const core = nudges.remaining;
	if (core.length > 0) return core;
	return bonusAvailable.value && nudges.bonus ? [nudges.bonus] : [];
});

const bonusHint = computed(() => {
	if (!nudges.bonus) return null;
	if (resolvedIds.value.has(nudges.bonus.id)) return null;
	return bonusAvailable.value ? t('today.bonusUnlocked') : t('today.bonusLocked');
});

const bonusStyle = computed(() =>
	bonusAvailable.value
		? {
				// a 45% green frame on an 8% green field lands at 1.7:1; the full role clears 3
				borderColor: 'var(--ion-color-success)',
				background: 'color-mix(in srgb, var(--ion-color-success) 8%, var(--ion-background-color))'
			}
		: {
				borderColor: 'var(--ion-background-color-step-150)',
				background: 'var(--ion-background-color-step-50)'
			}
);

const bonusTileStyle = computed(() =>
	bonusAvailable.value
		? { background: 'var(--ion-color-success)', color: 'var(--ion-color-success-contrast)' }
		: {
				background: 'var(--ion-background-color-step-100)',
				color: 'var(--ion-text-color-step-350)'
			}
);

async function hydrate() {
	// the install seed keys the day's stream, so it has to be resolved before the first
	// `ensure()`. `app.vue` also awaits it, but this page's onMounted can win that race,
	// and a deck picked with an empty seed then sticks for the rest of the day
	// hydratePosition only reads the cache and never prompts, so boot stays silent - asking
	// for location is the Out There tab's job. Without it the coordinate loop never closes
	// and weather can never fetch on a fresh install
	await Promise.all([
		installSeed(),
		progress.load(),
		nudges.load(settings.value.locale),
		hydratePosition()
	]);

	// weather is opportunistic: a missing snapshot makes weather filters pass, so
	// the deck is never blocked waiting on it
	const coords = build();
	if (coords.latitude !== undefined && coords.longitude !== undefined) {
		void refreshWeather(coords.latitude, coords.longitude);
	}

	await nudges.ensure(build());
	ready.value = true;

	// after the deck exists, so the spotlight has something to point at
	if (deckNudges.value.length > 0) {
		await nextTick();
		await startIfUnseen();
	}
}

function openNudge(nudge: Nudge) {
	active.value = nudge;
	sheetOpen.value = true;
}

function openById(id: string) {
	const found = nudges.find(id);
	if (found) openNudge(found);
}

async function skipNudge(nudge: Nudge) {
	await skip(nudge);
	await toast(t('today.skipped'));
}

// pairing is-open with did-dismiss is mandatory; a swipe-down otherwise leaves the
// ref true and the sheet can never reopen
function onSheetDismiss() {
	sheetOpen.value = false;
	active.value = null;
}

async function onResolved() {
	refreshToday();
	await refreshSchedule({ force: true });
}

async function onRefresh(event: CustomEvent) {
	await nudges.ensure(build());
	(event.target as HTMLIonRefresherElement | null)?.complete();
}

onMounted(hydrate);

// a day rollover while the app sits open should quietly bring a new set
onActivated(() => {
	if (ready.value) void nudges.ensure(build());
});
</script>
