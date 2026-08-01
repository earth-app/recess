<template>
	<div class="flex flex-col gap-5">
		<div class="flex flex-col gap-2">
			<h2 class="text-2xl leading-tight font-semibold">{{ nudge.prompt }}</h2>
			<p class="text-sm opacity-70">{{ t('validation.countHowMany', { unit: nudge.unit }) }}</p>
		</div>

		<ValidationCount
			:nudge="nudge"
			:data="nudge.validation_data"
			:unit="nudge.unit"
			:run="run"
			@verdict="onVerdict"
			@resolved="onResolved"
		/>
	</div>
</template>

<script setup lang="ts">
import type { ResolveInput, ResolveResult } from '~/composables/useResolve';
import type { CountNudge, Nudge } from '~/types/nudge';
import type { Submission, Verdict } from '~/utils/validate';

defineProps<{
	nudge: CountNudge;
	run: (nudge: Nudge, submission: Submission) => Promise<Verdict>;
}>();

const emit = defineEmits<{
	verdict: [Verdict, Pick<ResolveInput, 'text' | 'count' | 'media'>];
	resolved: [ResolveResult];
}>();

const { t } = useI18n();

function onVerdict(verdict: Verdict, extras: Pick<ResolveInput, 'text' | 'count' | 'media'>) {
	emit('verdict', verdict, extras);
}

function onResolved(result: ResolveResult) {
	emit('resolved', result);
}
</script>
