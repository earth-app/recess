<template>
	<div class="flex flex-col gap-5">
		<h2 class="text-2xl leading-tight font-semibold">{{ nudge.prompt }}</h2>

		<ValidationPhoto
			:nudge="nudge"
			:data="nudge.validation_data"
			:run="run"
			@verdict="onVerdict"
			@resolved="onResolved"
		/>
	</div>
</template>

<script setup lang="ts">
import type { ResolveInput, ResolveResult } from '~/composables/useResolve';
import type { CreateNudge, Nudge } from '~/types/nudge';
import type { Submission, Verdict } from '~/utils/validate';

defineProps<{
	nudge: CreateNudge;
	run: (nudge: Nudge, submission: Submission) => Promise<Verdict>;
}>();

const emit = defineEmits<{
	verdict: [Verdict, Pick<ResolveInput, 'text' | 'count' | 'media'>];
	resolved: [ResolveResult];
}>();

function onVerdict(verdict: Verdict, extras: Pick<ResolveInput, 'text' | 'count' | 'media'>) {
	emit('verdict', verdict, extras);
}

function onResolved(result: ResolveResult) {
	emit('resolved', result);
}
</script>
