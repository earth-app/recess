<template>
	<div class="flex flex-col gap-5">
		<div class="flex flex-col gap-2">
			<h2 class="text-2xl leading-tight font-semibold">{{ nudge.title }}</h2>
			<p class="text-base opacity-75">{{ nudge.description }}</p>
		</div>

		<ValidationConfirm
			v-if="nudge.validation_type === 'confirm'"
			:nudge="nudge"
			:run="run"
			@verdict="onVerdict"
			@resolved="onResolved"
		/>

		<ValidationText
			v-if="textData"
			:nudge="nudge"
			:data="textData"
			:run="run"
			@verdict="onVerdict"
			@resolved="onResolved"
		/>

		<ValidationPhoto
			v-if="photoData"
			:nudge="nudge"
			:data="photoData"
			:run="run"
			@verdict="onVerdict"
			@resolved="onResolved"
		/>

		<ValidationAudio
			v-if="audioData"
			:nudge="nudge"
			:data="audioData"
			:run="run"
			@verdict="onVerdict"
			@resolved="onResolved"
		/>

		<ValidationBarcode
			v-if="barcodeData"
			:nudge="nudge"
			:data="barcodeData"
			:run="run"
			@verdict="onVerdict"
			@resolved="onResolved"
		/>

		<ValidationCount
			v-if="countData"
			:nudge="nudge"
			:data="countData"
			:run="run"
			@verdict="onVerdict"
			@resolved="onResolved"
		/>
	</div>
</template>

<script setup lang="ts">
import type { ResolveInput, ResolveResult } from '~/composables/useResolve';
import type { Nudge, TaskNudge } from '~/types/nudge';
import type { Submission, Verdict } from '~/utils/validate';

const props = defineProps<{
	nudge: TaskNudge;
	run: (nudge: Nudge, submission: Submission) => Promise<Verdict>;
}>();

const emit = defineEmits<{
	verdict: [Verdict, Pick<ResolveInput, 'text' | 'count' | 'media'>];
	resolved: [ResolveResult];
}>();

// narrowed here rather than in the template so each surface gets its own data shape
const textData = computed(() =>
	props.nudge.validation_type === 'text' ? props.nudge.validation_data : null
);
const photoData = computed(() =>
	props.nudge.validation_type === 'photo' ? props.nudge.validation_data : null
);
const audioData = computed(() =>
	props.nudge.validation_type === 'audio' ? props.nudge.validation_data : null
);
const barcodeData = computed(() =>
	props.nudge.validation_type === 'barcode' ? props.nudge.validation_data : null
);
const countData = computed(() =>
	props.nudge.validation_type === 'count' ? props.nudge.validation_data : null
);

function onVerdict(verdict: Verdict, extras: Pick<ResolveInput, 'text' | 'count' | 'media'>) {
	emit('verdict', verdict, extras);
}

function onResolved(result: ResolveResult) {
	emit('resolved', result);
}
</script>
