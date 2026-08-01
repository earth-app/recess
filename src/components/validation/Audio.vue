<template>
	<div class="flex flex-col gap-3">
		<UAlert
			v-if="missingPack"
			color="warning"
			variant="subtle"
			icon="mdi:cloud-off-outline"
			:title="t('validation.unavailableTitle')"
			:description="t('validation.packMissing', { pack: missingPack })"
		/>

		<UAlert
			v-if="denied"
			color="error"
			variant="subtle"
			icon="mdi:microphone-off"
			:title="t('permissions.microphoneTitle')"
			:description="t('permissions.microphoneBody')"
		/>

		<UAlert
			v-if="failed"
			color="error"
			variant="subtle"
			icon="mdi:alert-circle-outline"
			:title="t('validation.unavailableTitle')"
			:description="t('validation.recordingFailed')"
		/>

		<div
			v-if="recording || clip"
			class="flex flex-col items-center gap-3 rounded-2xl px-4 py-5"
			:style="wellStyle"
		>
			<div class="flex h-10 items-end gap-1.5">
				<span
					v-for="(height, index) in BARS"
					:key="index"
					class="w-1.5 rounded-full"
					:class="recording ? 'animate-pulse' : 'opacity-40'"
					:style="barStyle(height, index)"
				/>
			</div>

			<span class="font-mono text-2xl font-semibold tabular-nums">{{ clock }}</span>

			<span class="text-xs opacity-60">
				{{ recording ? t('validation.recording') : t('validation.recorded') }}
			</span>
		</div>

		<span
			v-if="minSeconds > 0 && !longEnough"
			class="text-xs opacity-60"
		>
			{{ t('validation.audioMinSeconds', { count: minSeconds }) }}
		</span>

		<IonButton
			v-if="recording"
			expand="block"
			:style="accent"
			class="m-0! h-12! rounded-full! text-base! font-semibold! normal-case!"
			@click="stop"
		>
			{{ t('validation.audioStop') }}
		</IonButton>

		<template v-else>
			<IonButton
				v-if="clip"
				expand="block"
				:disabled="busy || !longEnough"
				:style="accent"
				class="m-0! h-12! rounded-full! text-base! font-semibold! normal-case!"
				@click="canCheck ? submit() : attest()"
			>
				<IonSpinner
					v-if="busy"
					name="crescent"
					class="mr-2! h-4! w-4!"
				/>
				{{ longEnough ? submitLabel : t('validation.audioTooShort') }}
			</IonButton>

			<IonButton
				expand="block"
				:fill="clip ? 'outline' : undefined"
				:color="clip ? 'medium' : undefined"
				:disabled="busy"
				:style="clip ? undefined : accent"
				class="m-0! h-12! rounded-full! text-base! font-semibold! normal-case!"
				@click="start"
			>
				{{ t('validation.audioStart') }}
			</IonButton>
		</template>

		<IonButton
			v-if="denied || failed"
			expand="block"
			fill="clear"
			color="medium"
			:disabled="busy"
			class="m-0! text-sm! font-semibold! normal-case!"
			@click="attest"
		>
			{{ t('validation.selfAttest') }}
		</IonButton>
	</div>
</template>

<script setup lang="ts">
import {
	MAX_RECORDING_SECONDS,
	mediaExtension,
	persistMedia,
	startRecording,
	stopRecording,
	type CapturedAudio
} from '~/composables/useCapture';
import type { ResolveInput, ResolveResult } from '~/composables/useResolve';
import type { AudioValidationData, Nudge } from '~/types/nudge';
import type { Submission, Verdict } from '~/utils/validate';

const props = defineProps<{
	nudge: Nudge;
	data: AudioValidationData;
	run: (nudge: Nudge, submission: Submission) => Promise<Verdict>;
}>();

const emit = defineEmits<{
	verdict: [Verdict, Pick<ResolveInput, 'text' | 'count' | 'media'>];
	resolved: [ResolveResult];
}>();

const { t } = useI18n();
const { resolve } = useResolve();
const { require: requirePermission } = usePermissions();
const models = useModelsStore();

// decorative bar heights; the recorder exposes no level readout to plot honestly
const BARS = [35, 65, 100, 70, 40];

const clip = ref<CapturedAudio | null>(null);
const recording = ref(false);
const elapsed = ref(0);
const denied = ref(false);
const failed = ref(false);
const busy = ref(false);

let timer: ReturnType<typeof setInterval> | null = null;

const accent: Record<string, string> = {
	'--background': 'var(--nudge-accent)',
	'--color': 'var(--nudge-on-accent)'
};
const wellStyle: Record<string, string> = { background: 'var(--nudge-accent-soft)' };

function barStyle(height: number, index: number): Record<string, string> {
	return {
		height: `${height}%`,
		background: 'var(--nudge-accent)',
		animationDelay: `${index * 120}ms`
	};
}

// scoring a transcript needs the transcriber and the embedder, so both packs count
const missingPack = computed(() => {
	if (!models.has('audio')) return t('settings.packAudio');
	if (!models.has('text')) return t('settings.packText');
	return null;
});

const minSeconds = computed(() => props.data.min_seconds ?? 0);
const seconds = computed(() => (recording.value ? elapsed.value : (clip.value?.seconds ?? 0)));
const longEnough = computed(() => seconds.value >= minSeconds.value);
const canCheck = computed(() => missingPack.value === null);
const submitLabel = computed(() =>
	canCheck.value ? t('validation.submit') : t('validation.selfAttest')
);

const clock = computed(() => {
	const total = seconds.value;
	return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
});

function clearTimer() {
	if (timer) clearInterval(timer);
	timer = null;
}

function revoke() {
	if (clip.value) URL.revokeObjectURL(clip.value.preview);
	clip.value = null;
}

async function start() {
	if (busy.value || recording.value) return;
	busy.value = true;
	failed.value = false;

	try {
		if (!(await requirePermission('microphone'))) {
			denied.value = true;
			return;
		}

		denied.value = false;
		revoke();

		if (!(await startRecording())) {
			denied.value = true;
			return;
		}

		elapsed.value = 0;
		recording.value = true;
		timer = setInterval(() => {
			elapsed.value += 1;
			// the hard cap belongs on the client; nothing downstream truncates for us
			if (elapsed.value >= MAX_RECORDING_SECONDS) void stop();
		}, 1000);
	} finally {
		busy.value = false;
	}
}

async function stop() {
	if (!recording.value) return;

	recording.value = false;
	clearTimer();
	busy.value = true;

	try {
		const captured = await stopRecording();
		clip.value = captured;
		failed.value = captured === null;
	} finally {
		busy.value = false;
	}
}

async function keep(): Promise<string | undefined> {
	const captured = clip.value;
	if (!captured) return undefined;
	return (
		(await persistMedia(captured.blob, props.nudge.id, mediaExtension(captured.blob, 'audio'))) ??
		undefined
	);
}

async function submit() {
	const captured = clip.value;
	if (busy.value || !captured || !longEnough.value) return;
	busy.value = true;

	try {
		const verdict = await props.run(props.nudge, {
			kind: 'audio',
			audio: captured.blob,
			durationSeconds: captured.seconds
		});
		const media = verdict.status === 'missed' ? undefined : await keep();

		emit('verdict', verdict, { media });
		if (verdict.status !== 'passed') return;

		emit('resolved', await resolve({ nudge: props.nudge, outcome: 'passed', verdict, media }));
	} finally {
		busy.value = false;
	}
}

async function attest() {
	if (busy.value) return;
	busy.value = true;

	try {
		emit(
			'resolved',
			await resolve({ nudge: props.nudge, outcome: 'self_attested', media: await keep() })
		);
	} finally {
		busy.value = false;
	}
}

onBeforeUnmount(() => {
	clearTimer();
	if (recording.value) void stopRecording();
	revoke();
});
</script>
