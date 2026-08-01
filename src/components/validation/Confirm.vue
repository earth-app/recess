<template>
	<div class="flex flex-col gap-3">
		<p class="text-sm font-semibold opacity-70">{{ t('validation.confirmTitle') }}</p>

		<IonButton
			expand="block"
			:disabled="busy"
			:style="accent"
			class="m-0! h-12! rounded-full! text-base! font-semibold! normal-case!"
			@click="submit"
		>
			<IonSpinner
				v-if="busy"
				name="crescent"
				class="mr-2! h-4! w-4!"
			/>
			{{ t('nudge.markDone') }}
		</IonButton>
	</div>
</template>

<script setup lang="ts">
import type { ResolveInput, ResolveResult } from '~/composables/useResolve';
import type { Nudge } from '~/types/nudge';
import type { Submission, Verdict } from '~/utils/validate';

const props = defineProps<{
	nudge: Nudge;
	run: (nudge: Nudge, submission: Submission) => Promise<Verdict>;
}>();

const emit = defineEmits<{
	verdict: [Verdict, Pick<ResolveInput, 'text' | 'count' | 'media'>];
	resolved: [ResolveResult];
}>();

const { t } = useI18n();
const { resolve } = useResolve();

const busy = ref(false);

const accent: Record<string, string> = {
	'--background': 'var(--nudge-accent)',
	'--color': 'var(--nudge-on-accent)'
};

async function submit() {
	if (busy.value) return;
	busy.value = true;

	try {
		const verdict = await props.run(props.nudge, { kind: 'confirm' });
		emit('verdict', verdict, {});
		if (verdict.status !== 'passed') return;

		emit('resolved', await resolve({ nudge: props.nudge, outcome: 'passed', verdict }));
	} finally {
		busy.value = false;
	}
}
</script>
