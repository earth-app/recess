<template>
	<div class="flex flex-col gap-5">
		<h2 class="text-2xl leading-tight font-semibold">{{ nudge.prompt }}</h2>

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
	</div>
</template>

<script setup lang="ts">
import type { ResolveInput, ResolveResult } from '~/composables/useResolve';
import type { NoticeNudge, Nudge } from '~/types/nudge';
import type { Submission, Verdict } from '~/utils/validate';

const props = defineProps<{
	nudge: NoticeNudge;
	run: (nudge: Nudge, submission: Submission) => Promise<Verdict>;
}>();

const emit = defineEmits<{
	verdict: [Verdict, Pick<ResolveInput, 'text' | 'count' | 'media'>];
	resolved: [ResolveResult];
}>();

const photoData = computed(() =>
	props.nudge.validation_type === 'photo' ? props.nudge.validation_data : null
);
const audioData = computed(() =>
	props.nudge.validation_type === 'audio' ? props.nudge.validation_data : null
);

function onVerdict(verdict: Verdict, extras: Pick<ResolveInput, 'text' | 'count' | 'media'>) {
	emit('verdict', verdict, extras);
}

function onResolved(result: ResolveResult) {
	emit('resolved', result);
}
</script>
