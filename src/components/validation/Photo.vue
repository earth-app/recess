<template>
	<div class="flex flex-col gap-3">
		<UAlert
			v-if="!hasPack"
			color="warning"
			variant="subtle"
			icon="mdi:cloud-off-outline"
			:title="t('validation.unavailableTitle')"
			:description="t('validation.packMissing', { pack: t('settings.packVision') })"
		/>

		<UAlert
			v-if="denied"
			color="error"
			variant="subtle"
			icon="mdi:camera-off-outline"
			:title="t('permissions.cameraTitle')"
			:description="t('permissions.cameraBody')"
		/>

		<img
			v-if="photo"
			:src="photo.preview"
			:alt="t('validation.photoAlt')"
			class="max-h-72 w-full rounded-2xl object-cover"
		/>

		<IonButton
			v-if="!photo"
			expand="block"
			:disabled="busy"
			:style="accent"
			class="m-0! h-12! rounded-full! text-base! font-semibold! normal-case!"
			@click="take"
		>
			<IonSpinner
				v-if="busy"
				name="crescent"
				class="mr-2! h-4! w-4!"
			/>
			{{ t('validation.photoTake') }}
		</IonButton>

		<template v-else>
			<IonButton
				expand="block"
				:disabled="busy"
				:style="accent"
				class="m-0! h-12! rounded-full! text-base! font-semibold! normal-case!"
				@click="hasPack ? submit() : attest()"
			>
				<IonSpinner
					v-if="busy"
					name="crescent"
					class="mr-2! h-4! w-4!"
				/>
				{{ hasPack ? t('validation.submit') : t('validation.selfAttest') }}
			</IonButton>

			<IonButton
				expand="block"
				fill="outline"
				color="medium"
				:disabled="busy"
				class="m-0! h-11! rounded-full! text-sm! font-semibold! normal-case!"
				@click="take"
			>
				{{ t('validation.photoRetake') }}
			</IonButton>
		</template>

		<IonButton
			v-if="denied"
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
	capturePhoto,
	mediaExtension,
	persistMedia,
	type CapturedPhoto
} from '~/composables/useCapture';
import type { ResolveInput, ResolveResult } from '~/composables/useResolve';
import type { Nudge, PhotoValidationData } from '~/types/nudge';
import type { Submission, Verdict } from '~/utils/validate';

const props = defineProps<{
	nudge: Nudge;
	data: PhotoValidationData;
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

const photo = ref<CapturedPhoto | null>(null);
const denied = ref(false);
const busy = ref(false);

const accent: Record<string, string> = {
	'--background': 'var(--nudge-accent)',
	'--color': 'var(--nudge-on-accent)'
};

const hasPack = computed(() => models.has('vision'));

function revoke() {
	if (photo.value) URL.revokeObjectURL(photo.value.preview);
	photo.value = null;
}

async function take() {
	if (busy.value) return;
	busy.value = true;

	try {
		if (!(await requirePermission('camera'))) {
			denied.value = true;
			return;
		}

		denied.value = false;
		const captured = await capturePhoto();
		// a cancelled camera is not a failure worth reporting
		if (!captured) return;

		revoke();
		photo.value = captured;
	} finally {
		busy.value = false;
	}
}

async function keep(): Promise<string | undefined> {
	const captured = photo.value;
	if (!captured) return undefined;
	return (
		(await persistMedia(captured.blob, props.nudge.id, mediaExtension(captured.blob, 'image'))) ??
		undefined
	);
}

async function submit() {
	const captured = photo.value;
	if (busy.value || !captured) return;
	busy.value = true;

	try {
		const verdict = await props.run(props.nudge, { kind: 'photo', image: captured.blob });
		// a missed photo gets retaken, so it is not worth the disk
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

onBeforeUnmount(revoke);
</script>
