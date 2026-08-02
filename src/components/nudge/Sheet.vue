<template>
	<IonModal
		:is-open="isOpen"
		:breakpoints="[0, 0.75, 1]"
		:initial-breakpoint="0.75"
		:handle="true"
		@did-dismiss="onDidDismiss"
	>
		<IonHeader class="ion-no-border">
			<IonToolbar>
				<IonTitle class="text-sm! font-semibold! opacity-70!">{{ categoryLabel }}</IonTitle>
				<IonButtons slot="end">
					<IonButton
						fill="clear"
						color="medium"
						:aria-label="t('common.close')"
						class="min-w-11!"
						@click="close"
					>
						<UIcon
							name="mdi:close"
							class="text-xl!"
						/>
					</IonButton>
				</IonButtons>
			</IonToolbar>
		</IonHeader>

		<IonContent>
			<div
				v-if="nudge"
				:key="nudge.id"
				class="nudge-wash flex min-h-full flex-col gap-6 px-5 pt-3 pb-8"
				:style="vars"
			>
				<div class="flex items-center justify-between gap-3">
					<span
						class="flex size-12 shrink-0 items-center justify-center rounded-2xl"
						:style="softStyle"
					>
						<UIcon
							:name="nudge.icon"
							class="text-2xl"
							:style="accentText"
						/>
					</span>

					<div class="flex items-center gap-2">
						<span
							v-if="placeLine"
							class="text-xs opacity-70"
						>
							{{ placeLine }}
						</span>
						<span
							v-if="nudge.duration_minutes"
							class="text-xs opacity-60"
						>
							{{ t('nudge.takesMinutes', { count: nudge.duration_minutes }) }}
						</span>
						<span
							class="rounded-full px-3 py-1 text-sm font-semibold"
							:style="pillStyle"
						>
							{{ t('common.pointsShort', { count: nudge.points }) }}
						</span>
					</div>
				</div>

				<div
					v-show="phase === 'body'"
					class="flex flex-col"
				>
					<NudgeBodyTask
						v-if="task"
						:nudge="task"
						:run="run"
						@verdict="onVerdict"
						@resolved="onResolved"
					/>
					<NudgeBodyQuestion
						v-else-if="question"
						:nudge="question"
						@leads-to="onLeadsTo"
						@resolved="onResolved"
					/>
					<NudgeBodyThink
						v-else-if="think"
						:nudge="think"
						@resolved="onResolved"
					/>
					<NudgeBodyChoose
						v-else-if="choose"
						:nudge="choose"
						@resolved="onResolved"
					/>
					<NudgeBodyCreate
						v-else-if="create"
						:nudge="create"
						:run="run"
						@verdict="onVerdict"
						@resolved="onResolved"
					/>
					<NudgeBodyNotice
						v-else-if="notice"
						:nudge="notice"
						:run="run"
						@verdict="onVerdict"
						@resolved="onResolved"
					/>
					<NudgeBodyCount
						v-else-if="count"
						:nudge="count"
						:run="run"
						@verdict="onVerdict"
						@resolved="onResolved"
					/>
				</div>

				<div
					v-if="phase === 'busy'"
					class="flex flex-col gap-3 py-6"
				>
					<IonProgressBar
						type="indeterminate"
						:style="progressStyle"
					/>
					<p class="text-sm font-medium">{{ busyMessage }}</p>
				</div>

				<div
					v-if="passed"
					class="flex flex-col gap-4"
				>
					<div class="flex items-center gap-3">
						<UIcon
							name="mdi:check-circle"
							class="text-4xl"
							:style="accentText"
						/>
						<div class="flex flex-col">
							<h3 class="text-xl font-semibold">{{ t('validation.passed') }}</h3>
							<span
								class="text-sm font-semibold"
								:style="accentText"
							>
								{{ t('common.points', { count: passed.points }) }}
							</span>
						</div>
					</div>

					<p
						v-if="passed.feedback"
						class="text-base opacity-80"
					>
						{{ passed.feedback }}
					</p>

					<p
						v-if="attested"
						class="text-xs opacity-60"
					>
						{{ t('validation.attested') }}
					</p>
					<p
						v-else-if="passedDetail"
						class="text-sm opacity-60"
					>
						{{ passedDetail }}
					</p>

					<UBadge
						v-if="passed.isNewBest"
						variant="soft"
						size="lg"
						icon="mdi:trophy-outline"
					>
						{{ t('week.personalBest.longest') }}
					</UBadge>

					<div
						v-for="unlock in passed.unlocked"
						:key="unlock.id"
						class="flex items-start gap-3 rounded-2xl px-4 py-3"
						:style="softStyle"
					>
						<UIcon
							:name="unlock.icon"
							class="mt-0.5 text-xl"
							:style="accentText"
						/>
						<div class="flex flex-col gap-0.5">
							<span class="text-sm font-semibold">
								{{ t('nudge.youCanNow', { capability: unlock.capability }) }}
							</span>
							<span class="text-xs opacity-70">{{ unlock.description }}</span>
						</div>
					</div>

					<div
						v-if="nextNudge"
						class="flex flex-col gap-2 rounded-2xl px-4 py-3"
						:style="softStyle"
					>
						<span class="text-xs font-semibold uppercase opacity-60">
							{{ t('nudge.nextUp') }}
						</span>
						<span class="text-base font-semibold">{{ nudgeTitle(nextNudge) }}</span>
						<IonButton
							expand="block"
							:style="accent"
							class="m-0! mt-1! h-11! rounded-full! text-sm! font-semibold! normal-case!"
							@click="openNext"
						>
							{{ t('today.openNudge') }}
						</IonButton>
					</div>

					<IonButton
						expand="block"
						:fill="nextNudge ? 'clear' : undefined"
						:color="nextNudge ? 'medium' : undefined"
						:style="nextNudge ? undefined : accent"
						class="m-0! h-12! rounded-full! text-base! font-semibold! normal-case!"
						@click="close"
					>
						{{ t('common.done') }}
					</IonButton>
				</div>

				<div
					v-if="missed"
					class="flex flex-col gap-4"
				>
					<div class="flex items-center gap-3">
						<UIcon
							name="mdi:target"
							class="text-4xl opacity-70"
						/>
						<h3 class="text-xl font-semibold">{{ t('validation.missed') }}</h3>
					</div>

					<p
						v-if="missed.detail"
						class="text-base opacity-80"
					>
						{{ missed.detail }}
					</p>

					<p
						v-if="scoreLine"
						class="text-sm opacity-60"
					>
						{{ scoreLine }}
					</p>

					<div
						v-if="observed.length > 0"
						class="flex flex-col gap-2"
					>
						<span class="text-sm font-semibold">{{ t('validation.missedSaw') }}</span>
						<div class="flex flex-wrap gap-2">
							<IonChip
								v-for="(seen, index) in observed"
								:key="index"
								:outline="true"
								color="medium"
								class="m-0! border! text-xs!"
							>
								{{ seen }}
							</IonChip>
						</div>
					</div>

					<IonButton
						expand="block"
						:style="accent"
						class="m-0! h-12! rounded-full! text-base! font-semibold! normal-case!"
						@click="tryAgain"
					>
						{{ t('common.retry') }}
					</IonButton>

					<IonButton
						expand="block"
						fill="clear"
						color="medium"
						:disabled="busy"
						class="m-0! text-sm! font-semibold! normal-case!"
						@click="notNow"
					>
						{{ t('nudge.notNow') }}
					</IonButton>
				</div>

				<div
					v-if="unavailable"
					class="flex flex-col gap-4"
				>
					<div class="flex items-center gap-3">
						<UIcon
							name="mdi:cloud-off-outline"
							class="text-4xl opacity-70"
						/>
						<h3 class="text-xl font-semibold">{{ t('validation.unavailableTitle') }}</h3>
					</div>

					<p class="text-base opacity-80">{{ t('validation.unavailableBody') }}</p>
					<p class="text-sm opacity-50">{{ unavailable.reason }}</p>

					<IonButton
						expand="block"
						:disabled="busy"
						:style="accent"
						class="m-0! h-12! rounded-full! text-base! font-semibold! normal-case!"
						@click="selfAttest"
					>
						<IonSpinner
							v-if="busy"
							name="crescent"
							class="mr-2! h-4! w-4!"
						/>
						{{ t('validation.selfAttest') }}
					</IonButton>

					<IonButton
						expand="block"
						fill="outline"
						color="medium"
						:disabled="busy"
						class="m-0! h-11! rounded-full! text-sm! font-semibold! normal-case!"
						@click="tryAgain"
					>
						{{ t('common.retry') }}
					</IonButton>

					<IonButton
						expand="block"
						fill="clear"
						color="medium"
						:disabled="busy"
						class="m-0! text-sm! font-semibold! normal-case!"
						@click="notNow"
					>
						{{ t('nudge.notNow') }}
					</IonButton>
				</div>

				<div
					v-if="phase === 'body'"
					class="mt-auto pt-4"
				>
					<IonButton
						expand="block"
						fill="clear"
						color="medium"
						:disabled="busy"
						class="m-0! text-sm! font-semibold! normal-case!"
						@click="notNow"
					>
						{{ t('nudge.notNow') }}
					</IonButton>
				</div>
			</div>
		</IonContent>
	</IonModal>
</template>

<script setup lang="ts">
import type { ResolveInput, ResolveResult } from '~/composables/useResolve';
import type { Nudge } from '~/types/nudge';
import { nudgeTitle } from '~/types/nudge';
import { nudgeColorVars } from '~/utils/color';
import type { Verdict } from '~/utils/validate';

type Extras = Pick<ResolveInput, 'text' | 'count' | 'media'>;

const props = defineProps<{
	nudge: Nudge | null;
	isOpen: boolean;
}>();

const emit = defineEmits<{
	didDismiss: [];
	resolved: [ResolveResult];
	openNudge: [string];
}>();

const { t } = useI18n();

const { bindingFor } = useBoundPlaces();

/**
 * Where this one could be done, when the day bound it to a spot.
 *
 * Says the walk and the direction, never "you have never been here" - recess keeps no passive
 * location history, so the only true novelty claim is about what has been *resolved* where, and
 * that is a weaker statement than it would sound. The name is OSM's when it has one.
 */
const placeLine = computed(() => {
	if (!props.nudge) return null;
	const binding = bindingFor(props.nudge.id);
	if (!binding) return null;

	const name = binding.place.place.n ?? t(`outThere.affordance.${binding.place.place.a[0]}`);
	const minutes = t('outThere.walkMinutes', {
		count: Math.max(1, Math.round(binding.place.minutes))
	});
	return `${name} - ${minutes} ${t(`outThere.compass.${binding.place.compass}`)}`;
});
const nudges = useNudgesStore();
const { resolve, skip } = useResolve();
const { validating, warming, status, run, reset } = useValidation();

const verdict = ref<Verdict | null>(null);
const result = ref<ResolveResult | null>(null);
const extras = ref<Extras>({});
const leadsTo = ref<string | null>(null);
const attested = ref(false);
const busy = ref(false);
// a pass runs straight into resolve(), which writes the feedback line before it returns
const settling = ref(false);

// #region painting

const vars = computed(() => (props.nudge ? nudgeColorVars(props.nudge.color) : {}));
const accent: Record<string, string> = {
	'--background': 'var(--nudge-accent)',
	'--color': 'var(--nudge-on-accent)'
};
const accentText: Record<string, string> = { color: 'var(--nudge-accent)' };
const softStyle: Record<string, string> = { background: 'var(--nudge-accent-soft)' };
const pillStyle: Record<string, string> = {
	background: 'var(--nudge-accent)',
	color: 'var(--nudge-on-accent)'
};
const progressStyle: Record<string, string> = {
	'--progress-background': 'var(--nudge-accent)'
};

// #endregion

// #region routing

const categoryLabel = computed(() =>
	props.nudge ? t(`nudge.category.${props.nudge.category}`) : ''
);

const task = computed(() => (props.nudge?.type === 'task' ? props.nudge : null));
const question = computed(() => (props.nudge?.type === 'question' ? props.nudge : null));
const think = computed(() => (props.nudge?.type === 'think' ? props.nudge : null));
const choose = computed(() => (props.nudge?.type === 'choose' ? props.nudge : null));
const create = computed(() => (props.nudge?.type === 'create' ? props.nudge : null));
const notice = computed(() => (props.nudge?.type === 'notice' ? props.nudge : null));
const count = computed(() => (props.nudge?.type === 'count' ? props.nudge : null));

// #endregion

// #region terminal states

const phase = computed(() => {
	if (result.value) return 'passed';
	if (validating.value || settling.value) return 'busy';
	if (verdict.value?.status === 'missed') return 'missed';
	if (verdict.value?.status === 'unavailable') return 'unavailable';
	return 'body';
});

const passed = computed(() => (phase.value === 'passed' ? result.value : null));
const missed = computed(() =>
	phase.value === 'missed' && verdict.value?.status === 'missed' ? verdict.value : null
);
const unavailable = computed(() =>
	phase.value === 'unavailable' && verdict.value?.status === 'unavailable' ? verdict.value : null
);

const passedDetail = computed(() =>
	verdict.value?.status === 'passed' ? (verdict.value.detail ?? null) : null
);
const observed = computed(() => missed.value?.observed ?? []);

const scoreLine = computed(() => {
	const entry = missed.value;
	if (!entry || entry.score === undefined || entry.threshold === undefined) return null;
	return t('validation.scoreLine', {
		score: Math.round(entry.score * 100),
		threshold: Math.round(entry.threshold * 100)
	});
});

const busyMessage = computed(() => {
	if (warming.value) return t('validation.warmingUp');
	if (validating.value) return status.value ?? t('validation.checking');
	return t('validation.finishing');
});

// never offer a follow-up already resolved today; that would bank its points twice
const nextNudge = computed(() => {
	const id = leadsTo.value;
	if (!id || nudges.resolvedIds.has(id)) return null;
	return nudges.find(id) ?? null;
});

// #endregion

function resetState() {
	verdict.value = null;
	result.value = null;
	extras.value = {};
	leadsTo.value = null;
	attested.value = false;
	busy.value = false;
	settling.value = false;
	reset();
}

// a new nudge or a fresh open always starts from a clean slate
watch(() => [props.isOpen, props.nudge?.id], resetState);

function onVerdict(next: Verdict, incoming: Extras) {
	verdict.value = next;
	extras.value = incoming;
	// hold the busy panel so a pass never flashes the form back before its result
	settling.value = next.status === 'passed';
}

function onResolved(next: ResolveResult) {
	settling.value = false;
	result.value = next;
	emit('resolved', next);
}

function onLeadsTo(id: string | null) {
	leadsTo.value = id;
}

function tryAgain() {
	verdict.value = null;
	settling.value = false;
	reset();
}

function close() {
	emit('didDismiss');
}

function onDidDismiss() {
	resetState();
	emit('didDismiss');
}

// the only path out of `unavailable`; a failed validator never passes on its own
async function selfAttest() {
	const nudge = props.nudge;
	if (!nudge || busy.value) return;
	busy.value = true;

	try {
		attested.value = true;
		const next = await resolve({
			nudge,
			outcome: 'self_attested',
			verdict: verdict.value,
			...extras.value
		});
		result.value = next;
		emit('resolved', next);
	} finally {
		busy.value = false;
	}
}

async function notNow() {
	const nudge = props.nudge;
	if (!nudge || busy.value) return;
	busy.value = true;

	try {
		emit('resolved', await skip(nudge));
	} finally {
		busy.value = false;
		close();
	}
}

function openNext() {
	const next = nextNudge.value;
	if (!next) return;
	emit('openNudge', next.id);
	close();
}
</script>
