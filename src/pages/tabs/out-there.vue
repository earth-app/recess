<template>
	<IonPage>
		<IonHeader :translucent="true">
			<IonToolbar>
				<IonTitle class="pl-4!">{{ t('outThere.title') }}</IonTitle>
			</IonToolbar>
		</IonHeader>

		<IonContent :fullscreen="true">
			<IonRefresher
				slot="fixed"
				@ion-refresh="onRefresh"
			>
				<IonRefresherContent />
			</IonRefresher>

			<div
				v-if="!hasPosition"
				class="flex flex-col items-center gap-4 px-8 pt-16 text-center"
			>
				<UIcon
					name="mdi:compass-outline"
					class="text-5xl text-(--ion-text-color-step-400)"
				/>
				<h1 class="font-title text-xl font-semibold">{{ t('outThere.needLocation') }}</h1>
				<p class="max-w-sm text-sm leading-relaxed text-(--ion-text-color-step-300)">
					{{ blocked ? t('outThere.blocked') : t('outThere.needLocationBody') }}
				</p>

				<IonButton
					class="mt-2 rounded-full! px-5! text-sm! font-semibold!"
					:disabled="locating"
					@click="onUseLocation"
				>
					{{ locating ? t('outThere.locating') : t('outThere.useLocation') }}
				</IonButton>
				<IonButton
					fill="clear"
					class="text-sm!"
					@click="onPinArea"
				>
					{{ t('outThere.pinArea') }}
				</IonButton>
			</div>

			<div
				v-else-if="!pack"
				class="flex flex-col items-center gap-4 px-8 pt-16 text-center"
			>
				<UIcon
					name="mdi:map-outline"
					class="text-5xl text-(--ion-text-color-step-400)"
				/>
				<h1 class="font-title text-xl font-semibold">{{ t('outThere.noPack') }}</h1>
				<p class="max-w-sm text-sm leading-relaxed text-(--ion-text-color-step-300)">
					{{ t('outThere.noPackBody') }}
				</p>

				<IonButton
					v-for="option in offers"
					:key="option.id"
					class="mt-2 rounded-full! px-5! text-sm! font-semibold!"
					:disabled="busy !== null"
					@click="onDownload(option.id)"
				>
					{{
						busy === option.id
							? t('outThere.downloading')
							: t('outThere.download', { size: formatBytes(option.bytes) })
					}}
				</IonButton>
			</div>

			<div
				v-else-if="!usable"
				class="flex flex-col items-center gap-4 px-8 pt-16 text-center"
			>
				<UIcon
					name="mdi:map-marker-question-outline"
					class="text-5xl text-(--ion-text-color-step-400)"
				/>
				<h1 class="font-title text-xl font-semibold">{{ t('outThere.thin') }}</h1>
				<p class="max-w-sm text-sm leading-relaxed text-(--ion-text-color-step-300)">
					{{ t('outThere.thinBody') }}
				</p>
			</div>

			<template v-else>
				<div class="px-4 pt-2">
					<PlaceFieldMap
						:places="nearby"
						:radius="radius"
						:selected-id="selectedId"
						:visited="visited"
						:install-seed="seed"
						:time-of-day="context.time_of_day"
						:season="context.season"
						@select="selectedId = $event"
					/>
				</div>

				<p class="px-6 pt-3 text-center text-xs text-(--ion-text-color-step-400)">
					{{ t('outThere.withinWalk', { minutes: Math.round(radius / 84) }) }}
				</p>

				<IonSegment
					:value="String(radius)"
					class="mx-4 mt-3"
					@ion-change="onRadius"
				>
					<IonSegmentButton
						v-for="option in RADIUS_OPTIONS"
						:key="option"
						:value="String(option)"
					>
						<IonLabel class="text-xs!">
							{{ t('outThere.walkMinutes', { count: Math.round(option / 84) }) }}
						</IonLabel>
					</IonSegmentButton>
				</IonSegment>

				<div
					v-if="nearby.length === 0"
					class="px-8 pt-10 text-center"
				>
					<h2 class="font-title text-base font-semibold">
						{{ t('outThere.nothingNearby', { minutes: Math.round(radius / 84) }) }}
					</h2>
					<p class="pt-2 text-sm text-(--ion-text-color-step-300)">
						{{ t('outThere.nothingNearbyBody') }}
					</p>
				</div>

				<IonList
					v-else
					:inset="true"
					class="mt-3!"
				>
					<IonItem
						v-for="entry in nearby.slice(0, 40)"
						:key="entry.place.id"
						button
						:detail="false"
						class="[--min-height:60px]"
						@click="selectedId = entry.place.id"
					>
						<span
							slot="start"
							class="flex size-9 items-center justify-center rounded-2xl"
							:style="{ background: tint(entry) }"
						>
							<UIcon
								:name="iconFor(entry)"
								class="text-lg"
								:style="{ color: colourFor(entry) }"
							/>
						</span>

						<IonLabel class="whitespace-normal!">
							<h2 class="text-sm! font-semibold!">
								{{ entry.place.n ?? affordanceLabel(entry) }}
							</h2>
							<p class="mt-0.5! text-xs! text-(--ion-text-color-step-400)!">
								{{ subtitle(entry) }}
							</p>
						</IonLabel>
					</IonItem>
				</IonList>

				<p class="px-6 pt-4 pb-2 text-center text-[0.6875rem] text-(--ion-text-color-step-450)">
					{{ t('outThere.attribution') }}
				</p>
			</template>

			<div class="h-10" />
		</IonContent>
	</IonPage>
</template>

<script setup lang="ts">
import { AFFORDANCE_COLORS, AFFORDANCE_ICONS } from '~/types/places';
import { resolveColor, withAlpha } from '~/utils/color';
import { installSeedSync } from '~/utils/install';
import { nearbyPlaces, visitedCells, type NearbyPlace } from '~/utils/places';

const { t } = useI18n();

const { build } = useNudgeContext();
const { snapshot: position, locating, blocked, locate, setManual, hydrate } = usePosition();
const { pack, load: loadPack, download, refreshManifest, suggestFor, busy, manifest } = useAreas();

/** 10, 20 and 40 minutes at the preferred walking speed */
const RADIUS_OPTIONS = [840, 1680, 3360] as const;

const radius = ref<number>(1680);
const selectedId = ref<string | null>(null);
const seed = ref('');

const context = computed(() => build());

/** the only location history recess keeps: cells a nudge was actually resolved in */
const visited = computed(() => visitedCells(useProgressStore().entries ?? []));
const hasPosition = computed(() => position.value !== null);

const origin = computed(() =>
	position.value ? { latitude: position.value.latitude, longitude: position.value.longitude } : null
);

const nearby = computed<NearbyPlace[]>(() =>
	nearbyPlaces(pack.value, origin.value, { within: radius.value })
);

// a pack can be present and still be too thin to build a surface on; see isPackUsable
const usable = computed(() => context.value.reachable_affordances !== undefined);

const offers = computed(() => {
	const covering = suggestFor(origin.value);
	// nothing covers you: offer whatever the manifest has rather than a dead end
	return covering.length > 0 ? covering.slice(0, 3) : manifest.value.slice(0, 3);
});

function colourFor(entry: NearbyPlace) {
	const primary = entry.place.a[0];
	return resolveColor(primary ? AFFORDANCE_COLORS[primary] : '@gray');
}

function tint(entry: NearbyPlace) {
	const primary = entry.place.a[0];
	return withAlpha(primary ? AFFORDANCE_COLORS[primary] : '@gray', 0.16);
}

function iconFor(entry: NearbyPlace) {
	const primary = entry.place.a[0];
	return primary ? AFFORDANCE_ICONS[primary] : 'mdi:map-marker-outline';
}

function affordanceLabel(entry: NearbyPlace) {
	const primary = entry.place.a[0];
	return primary ? t(`outThere.affordance.${primary}`) : t('outThere.unnamed');
}

function subtitle(entry: NearbyPlace) {
	const minutes = t('outThere.walkMinutes', { count: Math.max(1, Math.round(entry.minutes)) });
	return `${minutes} ${t(`outThere.compass.${entry.compass}`)}`;
}

/** real measured bytes from the manifest, never an estimate */
function formatBytes(bytes: number) {
	if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
	return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

async function onUseLocation() {
	await locate({ force: true });
	if (position.value) await afterPosition();
}

/**
 * Pinning uses the coarse coordinate the weather snapshot already produced when there is one.
 * A proper picker is a later job; what matters now is that refusing location is never a dead end.
 */
async function onPinArea() {
	const fallback = context.value;
	if (fallback.latitude !== undefined && fallback.longitude !== undefined) {
		await setManual(fallback.latitude, fallback.longitude);
		await afterPosition();
	}
}

async function afterPosition() {
	await refreshManifest();
	await loadPack();
}

async function onDownload(id: string) {
	const result = await download(id);
	if (result.ok) await loadPack(id);
}

function onRadius(event: CustomEvent) {
	const next = Number((event.detail as { value?: string }).value);
	if (Number.isFinite(next) && next > 0) radius.value = next;
}

async function onRefresh(event: CustomEvent) {
	await locate();
	await afterPosition();
	(event.target as HTMLIonRefresherElement | null)?.complete();
}

onMounted(async () => {
	seed.value = installSeedSync();
	await hydrate();
	await loadPack();
	if (position.value) void refreshManifest();
});
</script>
