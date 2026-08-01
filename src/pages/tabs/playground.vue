<template>
	<IonPage>
		<IonHeader :translucent="true">
			<IonToolbar>
				<IonTitle>{{ t('playground.title') }}</IonTitle>
				<IonButtons slot="end">
					<IonButton
						:disabled="!ready"
						:aria-label="t('playground.shareTitle')"
						class="min-w-11!"
						@click="shareOpen = true"
					>
						<UIcon
							name="mdi:qrcode-scan"
							class="text-xl!"
						/>
					</IonButton>
					<IonButton
						:disabled="!ready"
						:aria-label="t('playground.export.open')"
						class="min-w-11!"
						@click="openExport"
					>
						<UIcon
							name="mdi:tray-arrow-up"
							class="text-xl!"
						/>
					</IonButton>
				</IonButtons>
			</IonToolbar>
		</IonHeader>

		<IonContent>
			<div class="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 pt-3 pb-10">
				<section class="flex flex-col gap-3">
					<div
						class="relative overflow-hidden rounded-3xl border border-(--ion-background-color-step-150) shadow-lg"
					>
						<div
							v-if="!ready"
							class="flex items-center justify-center bg-(--ion-background-color-step-50)"
							:style="{ height: `${canvasHeight}px` }"
						>
							<IonSpinner name="crescent" />
						</div>
						<PlaygroundCanvas
							v-else
							ref="canvas"
							:scene="scene"
							:height="canvasHeight"
						/>
						<span
							v-if="ready && grown > 0"
							class="pointer-events-none absolute right-3 bottom-3 rounded-full bg-black/35 px-3 py-1 text-xs font-medium text-white backdrop-blur-sm"
						>
							{{ t('playground.tapHint') }}
						</span>
					</div>

					<p class="text-center text-sm text-(--ion-text-color-step-350)">
						{{ t('playground.grownFrom', { count: resolved }, resolved) }}
					</p>
				</section>

				<div class="grid grid-cols-3 gap-2">
					<div
						v-for="tile in tiles"
						:key="tile.label"
						class="flex flex-col items-center gap-0.5 rounded-2xl border border-(--ion-background-color-step-150) bg-(--ion-background-color-step-50) px-2 py-3"
					>
						<span class="text-xl font-semibold tabular-nums">{{ tile.value }}</span>
						<span
							class="text-center text-[0.7rem] tracking-wide text-(--ion-text-color-step-450) uppercase"
						>
							{{ tile.label }}
						</span>
					</div>
				</div>

				<div
					v-if="ready && grown === 0"
					class="flex items-start gap-3 rounded-2xl border border-(--ion-background-color-step-150) bg-(--ion-background-color-step-50) p-4"
				>
					<UIcon
						name="mdi:seed-outline"
						class="mt-0.5 shrink-0 text-xl text-(--ion-color-primary)"
					/>
					<p class="text-sm">{{ t('playground.empty') }}</p>
				</div>

				<PlaygroundTraits
					v-if="ready"
					:traits="scene.traits"
				/>

				<section
					class="flex flex-col gap-3 rounded-2xl border border-(--ion-background-color-step-150) bg-(--ion-background-color-step-50) p-4"
				>
					<div class="flex items-baseline justify-between gap-3">
						<h2 class="text-base font-semibold">{{ t('playground.biomeTitle') }}</h2>
						<span class="text-xs text-(--ion-text-color-step-450)">{{ biomeCaption }}</span>
					</div>

					<IonProgressBar
						color="primary"
						:value="biomePercent / 100"
						class="h-1.5! rounded-full!"
					/>

					<p class="text-sm text-(--ion-text-color-step-350)">{{ biomeBody }}</p>

					<div class="flex flex-wrap gap-1.5">
						<IonChip
							v-for="chip in biomeChips"
							:key="chip.biome"
							:color="chip.color"
							:outline="chip.outline"
							class="m-0! h-7! border! border-(--ion-background-color-step-250)! text-xs! font-semibold!"
						>
							{{ chip.label }}
						</IonChip>
					</div>
				</section>

				<section
					v-if="unlocked.length > 0"
					class="flex flex-col gap-1"
				>
					<h2 class="px-1 text-base font-semibold">{{ t('playground.unlockedTitle') }}</h2>
					<IonList
						:inset="true"
						class="mx-0! my-0! rounded-2xl!"
					>
						<IonItem
							v-for="(unlock, index) in unlocked"
							:key="unlock.id"
							:lines="index === unlocked.length - 1 ? 'none' : 'full'"
						>
							<span
								slot="start"
								class="flex size-9 items-center justify-center rounded-full bg-[rgba(var(--ion-color-primary-rgb),0.14)]"
							>
								<UIcon
									:name="unlock.icon"
									class="text-lg! text-(--ion-color-primary)!"
								/>
							</span>
							<IonLabel class="whitespace-normal!">
								<h3 class="text-sm! font-semibold!">
									{{ t('playground.canNow', { capability: unlock.capability }) }}
								</h3>
								<p class="text-xs!">{{ unlock.description }}</p>
							</IonLabel>
						</IonItem>
					</IonList>
				</section>

				<section
					v-if="upcoming"
					class="flex flex-col gap-1"
				>
					<h2 class="px-1 text-base font-semibold">{{ t('playground.nextTitle') }}</h2>
					<IonList
						:inset="true"
						class="mx-0! my-0! rounded-2xl!"
					>
						<IonItem lines="none">
							<span
								slot="start"
								class="flex size-9 items-center justify-center rounded-full bg-(--ion-background-color-step-100)"
							>
								<UIcon
									:name="upcoming.icon"
									class="text-lg! text-(--ion-text-color-step-450)!"
								/>
							</span>
							<IonLabel class="whitespace-normal!">
								<h3 class="text-sm! font-semibold!">
									{{ t('playground.canNow', { capability: upcoming.capability }) }}
								</h3>
								<p class="text-xs!">{{ upcoming.description }}</p>
							</IonLabel>
							<IonNote
								slot="end"
								color="medium"
								class="text-xs!"
							>
								{{
									t('playground.pointsToGo', { count: remainingToNext ?? 0 }, remainingToNext ?? 0)
								}}
							</IonNote>
						</IonItem>
					</IonList>
				</section>

				<p class="px-2 text-center text-xs text-(--ion-text-color-step-450)">
					{{ t('playground.pointsNote') }}
				</p>
			</div>
		</IonContent>

		<PlaygroundExport
			v-if="ready"
			:open="exportOpen"
			:box="exportBox"
			:render="renderExport"
			@close="exportOpen = false"
		/>

		<PlaygroundShare
			:is-open="shareOpen"
			:tuple="shareTuple"
			@did-dismiss="shareOpen = false"
		/>
	</IonPage>
</template>

<script setup lang="ts">
import PlaygroundCanvas from '~/components/playground/Canvas.vue';
import type { MoonPhase, Season, TimeOfDay } from '~/types/nudge';
import { installSeed, installSeedSync } from '~/utils/install';
import type { PlaygroundExportFormat, SceneBox } from '~/utils/playground';
import {
	BIOMES,
	BIOME_THRESHOLDS,
	buildScene,
	sceneTupleFromLedger,
	unlockedBiomes
} from '~/utils/playground';

const { t, locale } = useI18n();
const progress = useProgressStore();
const { build } = useNudgeContext();
const { unlocked, upcoming, remainingToNext, biomeProgress } = useUnlocks();
const { height: viewportHeight } = useWindowSize();

interface SkyMoment {
	timeOfDay: TimeOfDay;
	season: Season;
	moonPhase: MoonPhase;
	moonIllumination: number;
}

/** only the four sky fields, so the whole context does not become reactive state */
function readMoment(): SkyMoment {
	const context = build();
	return {
		timeOfDay: context.time_of_day,
		season: context.season,
		moonPhase: context.moon_phase,
		moonIllumination: context.moon_illumination
	};
}

const ready = ref(false);
const moment = ref<SkyMoment>(readMoment());
const seed = ref(installSeedSync());
const exportOpen = ref(false);
const shareOpen = ref(false);
const canvas = ref<InstanceType<typeof PlaygroundCanvas> | null>(null);

const shareTuple = computed(() =>
	sceneTupleFromLedger({
		entries: progress.entries,
		seed: seed.value,
		points: progress.points,
		timeOfDay: moment.value.timeOfDay,
		season: moment.value.season,
		moonPhase: moment.value.moonPhase,
		moonIllumination: moment.value.moonIllumination
	})
);

const scene = computed(() => buildScene(shareTuple.value));

const grown = computed(() => scene.value.elements.length);
// the scene caps how much it draws, so the count comes from the ledger instead
const resolved = computed(
	() => progress.entries.filter((entry) => entry.outcome !== 'skipped').length
);
const grownBiomes = computed(() => unlockedBiomes(progress.points));

const biomeChips = computed(() =>
	BIOMES.map((biome) => {
		const grownIn = grownBiomes.value.includes(biome);
		return {
			biome,
			label: t(`playground.biome.${biome}`),
			color: grownIn ? 'primary' : 'medium',
			outline: !grownIn
		};
	})
);

const canvasHeight = computed(() =>
	Math.round(Math.min(420, Math.max(240, (viewportHeight.value || 720) * 0.42)))
);

// measured when the sheet opens, not computed: the canvas box is plain module state, so
// a computed would keep reporting the size the scene had at mount
const exportBox = ref<SceneBox>({ width: 360, height: 320 });

function openExport() {
	exportBox.value = canvas.value?.sceneBox() ?? { width: 360, height: canvasHeight.value };
	exportOpen.value = true;
}

function renderExport(
	format: PlaygroundExportFormat,
	scale: number,
	frame: SceneBox | null
): Promise<Blob> {
	const api = canvas.value;
	if (!api) return Promise.reject(new Error('The playground is not on screen yet.'));
	return api.exportBlob(format, scale, frame);
}

const numbers = computed(() => new Intl.NumberFormat(locale.value));

const tiles = computed(() => [
	{ label: t('playground.pointsLabel'), value: numbers.value.format(progress.points) },
	{ label: t('playground.nudgesLabel'), value: numbers.value.format(resolved.value) },
	{ label: t('playground.streakLabel'), value: numbers.value.format(progress.streak.current) }
]);

const biomeFloor = computed(() => {
	const grownSoFar = grownBiomes.value;
	const last = grownSoFar[grownSoFar.length - 1];
	return last ? BIOME_THRESHOLDS[last] : 0;
});

const biomePercent = computed(() => {
	const next = biomeProgress.value;
	if (!next) return 100;
	const span = BIOME_THRESHOLDS[next.biome] - biomeFloor.value;
	if (span <= 0) return 100;
	const done = ((progress.points - biomeFloor.value) / span) * 100;
	return Math.round(Math.min(100, Math.max(0, done)));
});

const biomeCaption = computed(() => {
	const next = biomeProgress.value;
	return next
		? t('playground.biomeNext', { biome: t(`playground.biome.${next.biome}`) })
		: t('playground.biomeAll');
});

const biomeBody = computed(() => {
	const next = biomeProgress.value;
	return next
		? t(
				'playground.biomeRemaining',
				{ count: next.remaining, biome: t(`playground.biome.${next.biome}`) },
				next.remaining
			)
		: t('playground.biomeComplete');
});

onMounted(async () => {
	// the seed decides the trait table, so it has to land before the first paint or the
	// scene would redraw itself the moment it resolves
	const [resolvedSeed] = await Promise.all([installSeed(), progress.load()]);
	seed.value = resolvedSeed;
	moment.value = readMoment();
	ready.value = true;
});

// coming back to the tab hours later should repaint the sky, not the sky from before
onIonViewWillEnter(() => {
	moment.value = readMoment();
});
</script>
