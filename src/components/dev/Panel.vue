<template>
	<IonModal
		:is-open="isOpen"
		:breakpoints="[0, 0.6, 0.95]"
		:initial-breakpoint="0.95"
		@did-dismiss="emit('didDismiss')"
	>
		<IonHeader class="ion-no-border">
			<IonToolbar>
				<IonTitle class="text-base!">Developer</IonTitle>
				<IonButtons slot="end">
					<IonButton
						color="medium"
						fill="clear"
						@click="emit('didDismiss')"
					>
						Close
					</IonButton>
				</IonButtons>
			</IonToolbar>
		</IonHeader>

		<IonContent>
			<div class="flex flex-col gap-4 px-4 py-4">
				<div
					v-if="overridesActive"
					class="flex items-center justify-between gap-3 rounded-2xl px-3 py-2 text-xs"
					:style="warningStyle"
				>
					<span>Overrides are active. This is not stock behaviour.</span>
					<IonButton
						size="small"
						fill="clear"
						color="medium"
						@click="clearOverrides"
					>
						Reset
					</IonButton>
				</div>

				<IonSegment
					:value="tab"
					@ion-change="tab = String(($event.detail.value ?? 'progress') as string)"
				>
					<IonSegmentButton value="progress">
						<IonLabel class="text-xs!">Progress</IonLabel>
					</IonSegmentButton>
					<IonSegmentButton value="deck">
						<IonLabel class="text-xs!">Deck</IonLabel>
					</IonSegmentButton>
					<IonSegmentButton value="context">
						<IonLabel class="text-xs!">Context</IonLabel>
					</IonSegmentButton>
					<IonSegmentButton value="notify">
						<IonLabel class="text-xs!">Notify</IonLabel>
					</IonSegmentButton>
				</IonSegment>

				<template v-if="tab === 'progress'">
					<DevSection title="Points">
						<p class="text-xs opacity-65">
							Recorded as real completions, so streak, bests and the Playground stay consistent with
							the ledger.
						</p>
						<div class="flex flex-wrap gap-2">
							<IonButton
								v-for="stop in DEV_POINT_STOPS"
								:key="stop"
								size="small"
								fill="outline"
								color="primary"
								class="text-xs!"
								@click="tools.jumpToPoints(stop)"
							>
								{{ stop }}
							</IonButton>
						</div>
						<p class="text-xs tabular-nums opacity-55">
							Now: {{ progress.points }} points, {{ progress.entries.length }} entries, streak
							{{ progress.streak.current }}
						</p>
					</DevSection>

					<DevSection title="Seed a History">
						<div class="grid grid-cols-3 gap-2">
							<IonInput
								v-model.number="seed.days"
								type="number"
								label="Days"
								label-placement="stacked"
								fill="outline"
								class="text-sm!"
							/>
							<IonInput
								v-model.number="seed.perDay"
								type="number"
								label="Per Day"
								label-placement="stacked"
								fill="outline"
								class="text-sm!"
							/>
							<IonInput
								v-model.number="seed.gaps"
								type="number"
								label="Gap Every"
								label-placement="stacked"
								fill="outline"
								class="text-sm!"
							/>
						</div>
						<IonButton
							size="small"
							color="primary"
							class="text-xs!"
							@click="tools.seedLedger({ ...seed })"
						>
							Seed
						</IonButton>
					</DevSection>

					<DevSection title="Unlocks">
						<IonItem lines="none">
							<IonToggle
								color="primary"
								:checked="overrides.unlockEverything"
								@ion-change="setUnlockAll($event)"
							>
								<span class="text-sm!">Unlock Everything</span>
							</IonToggle>
						</IonItem>
					</DevSection>

					<DevSection title="Danger">
						<IonButton
							size="small"
							color="danger"
							class="text-xs!"
							@click="tools.resetEverything"
						>
							Wipe Everything
						</IonButton>
					</DevSection>
				</template>

				<template v-else-if="tab === 'deck'">
					<DevSection title="Pin a Nudge">
						<p class="text-xs opacity-65">
							A pinned nudge is forced to the front of today's set, past every filter.
						</p>
						<IonSearchbar
							:value="query"
							placeholder="Search the catalog"
							class="px-0!"
							@ion-input="query = String($event.detail.value ?? '')"
						/>
						<IonList
							:inset="true"
							class="mx-0! rounded-2xl!"
						>
							<IonItem
								v-for="nudge in matches"
								:key="nudge.id"
								:button="true"
								:detail="false"
								lines="full"
								@click="pinAndClose(nudge)"
							>
								<IonLabel class="whitespace-normal!">
									<h3 class="text-sm!">{{ nudgeTitle(nudge) }}</h3>
									<p class="text-xs!">{{ nudge.id }}</p>
								</IonLabel>
							</IonItem>
						</IonList>
						<IonButton
							v-if="overrides.pinnedNudgeIds.length > 0"
							size="small"
							fill="clear"
							color="medium"
							class="text-xs!"
							@click="tools.unpin"
						>
							Unpin
						</IonButton>
					</DevSection>

					<DevSection title="Bonus">
						<IonItem lines="none">
							<IonToggle
								color="primary"
								:checked="overrides.forceBonus"
								@ion-change="setForceBonus($event)"
							>
								<span class="text-sm!">Release the Bonus Now</span>
							</IonToggle>
						</IonItem>
					</DevSection>

					<DevSection title="Validation">
						<p class="text-xs opacity-65">
							Short-circuits every validator, so a flow can be walked without a model.
						</p>
						<IonSegment
							:value="overrides.verdict ?? 'off'"
							@ion-change="setVerdict($event)"
						>
							<IonSegmentButton value="off">
								<IonLabel class="text-xs!">Off</IonLabel>
							</IonSegmentButton>
							<IonSegmentButton value="passed">
								<IonLabel class="text-xs!">Pass</IonLabel>
							</IonSegmentButton>
							<IonSegmentButton value="missed">
								<IonLabel class="text-xs!">Miss</IonLabel>
							</IonSegmentButton>
							<IonSegmentButton value="unavailable">
								<IonLabel class="text-xs!">Can't Check</IonLabel>
							</IonSegmentButton>
						</IonSegment>
					</DevSection>

					<DevSection title="Model Packs">
						<p class="text-xs opacity-65">
							Marks packs present without downloading, to reach the validated paths.
						</p>
						<div class="flex flex-wrap gap-2">
							<IonButton
								size="small"
								fill="outline"
								color="primary"
								class="text-xs!"
								@click="tools.fakePacks([...tools.packs])"
							>
								All Present
							</IonButton>
							<IonButton
								size="small"
								fill="outline"
								color="medium"
								class="text-xs!"
								@click="tools.fakePacks([])"
							>
								None Present
							</IonButton>
							<IonButton
								size="small"
								fill="clear"
								color="medium"
								class="text-xs!"
								@click="tools.fakePacks(null)"
							>
								Use Real State
							</IonButton>
						</div>
					</DevSection>
				</template>

				<template v-else-if="tab === 'context'">
					<DevSection title="Clock and Sky">
						<p class="text-xs opacity-65">
							Overrides what the filters and the Playground read, without changing the device clock.
						</p>
						<DevSelect
							v-model="context.time_of_day"
							label="Time of Day"
							:options="TIMES_OF_DAY"
						/>
						<DevSelect
							v-model="context.season"
							label="Season"
							:options="SEASONS"
						/>
						<DevSelect
							v-model="context.moon_phase"
							label="Moon Phase"
							:options="MOON_PHASES"
						/>
						<IonInput
							v-model.number="hourInput"
							type="number"
							min="0"
							max="23"
							label="Hour"
							label-placement="stacked"
							fill="outline"
							class="text-sm!"
						/>
					</DevSection>

					<DevSection title="Weather">
						<DevSelect
							v-model="context.weather"
							label="Condition"
							:options="WEATHER_CONDITIONS"
						/>
						<IonInput
							v-model.number="tempInput"
							type="number"
							label="Temperature (C)"
							label-placement="stacked"
							fill="outline"
							class="text-sm!"
						/>
					</DevSection>

					<DevSection title="Where You Are">
						<p class="text-xs opacity-65">
							Sets the position the deck and Out There read, without the OS prompt. Stored snapped
							to the same 100 m grid a real fix is.
						</p>
						<div class="flex flex-wrap gap-2">
							<IonButton
								v-for="spot in DEV_PLACES"
								:key="spot.label"
								size="small"
								fill="outline"
								class="text-xs!"
								@click="pinAt(spot.latitude, spot.longitude)"
							>
								{{ spot.label }}
							</IonButton>
						</div>
						<IonInput
							v-model.number="latInput"
							type="number"
							label="Latitude"
							label-placement="stacked"
							fill="outline"
							class="text-sm!"
						/>
						<IonInput
							v-model.number="lonInput"
							type="number"
							label="Longitude"
							label-placement="stacked"
							fill="outline"
							class="text-sm!"
						/>
						<div class="flex flex-wrap gap-2">
							<IonButton
								size="small"
								fill="outline"
								class="text-xs!"
								:disabled="latInput === null || lonInput === null"
								@click="pinAt(latInput ?? 0, lonInput ?? 0)"
							>
								Pin Here
							</IonButton>
							<IonButton
								size="small"
								fill="outline"
								color="medium"
								class="text-xs!"
								@click="clearPosition"
							>
								Forget Position
							</IonButton>
						</div>
					</DevSection>

					<DevSection title="Area Pack">
						<p class="text-xs opacity-65">
							Installs the committed Chicago Loop fixture, so Out There has real places without a
							download. Pin Chicago above first or nothing will be in range.
						</p>
						<div class="flex flex-wrap gap-2">
							<IonButton
								size="small"
								fill="outline"
								class="text-xs!"
								@click="loadFixturePack"
							>
								{{ packBusy ? 'Loading' : 'Install Fixture Pack' }}
							</IonButton>
							<IonButton
								size="small"
								fill="outline"
								color="medium"
								class="text-xs!"
								@click="dropPacks"
							>
								Remove Packs
							</IonButton>
						</div>
						<p class="text-xs opacity-65">{{ packSummary }}</p>
					</DevSection>

					<IonButton
						size="small"
						color="primary"
						class="text-xs!"
						@click="applyContext"
					>
						Apply Context
					</IonButton>
				</template>

				<template v-else>
					<DevSection title="Fire a Digest">
						<p class="text-xs opacity-65">
							Schedules a real notification one second out, so tap routing runs for real.
						</p>
						<div class="flex flex-wrap gap-2">
							<IonButton
								v-for="slot in DIGEST_SLOTS"
								:key="slot"
								size="small"
								fill="outline"
								color="primary"
								class="text-xs!"
								@click="tools.fireDigest(slot)"
							>
								{{ slot }}
							</IonButton>
						</div>
					</DevSection>

					<DevSection title="Schedule">
						<div class="flex flex-wrap gap-2">
							<IonButton
								size="small"
								fill="outline"
								color="primary"
								class="text-xs!"
								@click="tools.rebuildSchedule"
							>
								Rebuild
							</IonButton>
							<IonButton
								size="small"
								fill="clear"
								color="medium"
								class="text-xs!"
								@click="refreshPending"
							>
								List Pending
							</IonButton>
						</div>
						<p
							v-if="pending !== null"
							class="text-xs tabular-nums opacity-55"
						>
							{{ pending.length }} pending
						</p>
						<ul
							v-if="pending && pending.length > 0"
							class="flex flex-col gap-1"
						>
							<li
								v-for="item in pending.slice(0, 12)"
								:key="item.id"
								class="text-xs tabular-nums opacity-70"
							>
								{{ item.id }} - {{ item.title }}
							</li>
						</ul>
					</DevSection>
				</template>
			</div>
		</IonContent>
	</IonModal>
</template>

<script setup lang="ts">
import type { LocalNotificationSchema } from '@capacitor/local-notifications';
import type { Nudge } from '~/types/nudge';
import { MOON_PHASES, SEASONS, TIMES_OF_DAY, WEATHER_CONDITIONS, nudgeTitle } from '~/types/nudge';
import { withAlpha } from '~/utils/color';
import { devOverrides, devOverridesActive, resetDevOverrides, setDevOverrides } from '~/utils/dev';
import { DEV_POINT_STOPS, useDevTools } from './tools';

const props = defineProps<{ isOpen: boolean }>();
const emit = defineEmits<{ didDismiss: [] }>();

const tools = useDevTools();
const progress = useProgressStore();
const nudges = useNudgesStore();
const { build } = useNudgeContext();

const DIGEST_SLOTS = ['morning', 'midday', 'evening'] as const;

const tab = ref('progress');
const query = ref('');
const pending = ref<LocalNotificationSchema[] | null>(null);
const overrides = devOverrides();
const context = reactive({ ...overrides.context });
const hourInput = ref<number | null>(overrides.context.hour);
const tempInput = ref<number | null>(overrides.context.temperature);

// #region place

/** somewhere with a committed fixture pack, plus two contrasting densities to sanity-check against */
const DEV_PLACES = [
	{ label: 'Chicago Loop', latitude: 41.8819, longitude: -87.6278 },
	{ label: 'London', latitude: 51.5074, longitude: -0.1278 },
	{ label: 'Rural Montana', latitude: 47.0527, longitude: -109.6333 }
] as const;

const { setManual, clear: clearStoredPosition, snapshot: devPosition } = usePosition();
const { adopt, remove: removeArea, installed: installedAreas } = useAreas();

const latInput = ref<number | null>(devPosition.value?.latitude ?? null);
const lonInput = ref<number | null>(devPosition.value?.longitude ?? null);
const packBusy = ref(false);

const packSummary = computed(() =>
	installedAreas.value.length === 0
		? 'No pack installed.'
		: installedAreas.value
				.map((area) => `${area.label}: ${area.places} places, ${Math.round(area.bytes / 1024)} KB`)
				.join(' / ')
);

async function pinAt(latitude: number, longitude: number) {
	const stored = await setManual(latitude, longitude);
	latInput.value = stored.latitude;
	lonInput.value = stored.longitude;
}

async function clearPosition() {
	await clearStoredPosition();
	latInput.value = null;
	lonInput.value = null;
}

async function loadFixturePack() {
	packBusy.value = true;
	try {
		// the same real OSM cut the unit tests run against, so dev and CI see identical data
		const fixture = await import('../../../tests/fixtures/areas/us-il-chicago-loop.json');
		await adopt(fixture.default ?? fixture);
	} finally {
		packBusy.value = false;
	}
}

async function dropPacks() {
	for (const area of [...installedAreas.value]) await removeArea(area.id);
}

// #endregion
const seed = reactive({ days: 14, perDay: 3, gaps: 0 });

const overridesActive = computed(() => devOverridesActive());

const warningStyle = computed(() => ({
	background: withAlpha('@orange', 0.16),
	color: 'var(--ion-text-color)'
}));

const matches = computed(() => {
	const term = query.value.trim().toLowerCase();
	const pool = nudges.catalog;
	if (term.length === 0) return pool.slice(0, 20);
	return pool
		.filter(
			(nudge) =>
				nudge.id.toLowerCase().includes(term) || nudgeTitle(nudge).toLowerCase().includes(term)
		)
		.slice(0, 20);
});

function detailValue(event: Event): string {
	return String((event as CustomEvent<{ value?: unknown }>).detail?.value ?? '');
}

function detailChecked(event: Event): boolean {
	return (event as CustomEvent<{ checked?: boolean }>).detail?.checked === true;
}

function setVerdict(event: Event) {
	const value = detailValue(event);
	setDevOverrides({
		verdict: value === 'off' ? null : (value as 'passed' | 'missed' | 'unavailable')
	});
}

function setUnlockAll(event: Event) {
	setDevOverrides({ unlockEverything: detailChecked(event) });
}

function setForceBonus(event: Event) {
	setDevOverrides({ forceBonus: detailChecked(event) });
	void nudges.ensure(build());
}

function pinAndClose(nudge: Nudge) {
	tools.pin(nudge);
	emit('didDismiss');
}

function applyContext() {
	setDevOverrides({
		context: {
			...context,
			hour: Number.isFinite(hourInput.value) ? hourInput.value : null,
			temperature: Number.isFinite(tempInput.value) ? tempInput.value : null
		}
	});
	void nudges.ensure(build());
}

function clearOverrides() {
	resetDevOverrides();
	Object.assign(context, overrides.context);
	hourInput.value = null;
	tempInput.value = null;
	void nudges.ensure(build());
}

async function refreshPending() {
	pending.value = await tools.listPending();
}

// reopening should show what is actually set, not what was typed and abandoned
watch(
	() => props.isOpen,
	(open) => {
		if (!open) return;
		Object.assign(context, overrides.context);
		hourInput.value = overrides.context.hour;
		tempInput.value = overrides.context.temperature;
	}
);
</script>
