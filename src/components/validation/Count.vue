<template>
	<div class="flex flex-col gap-3">
		<IonInput
			:value="entered"
			type="number"
			inputmode="numeric"
			:min="0"
			:placeholder="t('validation.countPlaceholder')"
			:disabled="busy"
			fill="outline"
			class="text-2xl! font-semibold!"
			@ion-input="
				(event) => {
					entered = parse(event.target.value);
				}
			"
		>
			<span
				v-if="unit"
				slot="end"
				class="pl-2! text-sm! font-normal! opacity-70!"
			>
				{{ t('validation.countUnit', { unit }) }}
			</span>
		</IonInput>

		<IonButton
			expand="block"
			:disabled="entered === null || busy"
			:style="accent"
			class="m-0! h-12! rounded-full! text-base! font-semibold! normal-case!"
			@click="submit"
		>
			<IonSpinner
				v-if="busy"
				name="crescent"
				class="mr-2! h-4! w-4!"
			/>
			{{ t('validation.submit') }}
		</IonButton>
	</div>
</template>

<script setup lang="ts">
import type { ResolveInput, ResolveResult } from '~/composables/useResolve';
import type { CountValidationData, Nudge } from '~/types/nudge';
import type { Submission, Verdict } from '~/utils/validate';

const props = defineProps<{
	nudge: Nudge;
	data: CountValidationData;
	unit?: string;
	run: (nudge: Nudge, submission: Submission) => Promise<Verdict>;
}>();

const emit = defineEmits<{
	verdict: [Verdict, Pick<ResolveInput, 'text' | 'count' | 'media'>];
	resolved: [ResolveResult];
}>();

const { t } = useI18n();
const { resolve } = useResolve();

const entered = ref<number | null>(null);
const busy = ref(false);

const accent: Record<string, string> = {
	'--background': 'var(--nudge-accent)',
	'--color': 'var(--nudge-on-accent)'
};

// no clamping and no range hint; validateCount explains a low or high answer itself
function parse(raw: unknown): number | null {
	if (raw === null || raw === undefined || raw === '') return null;
	const parsed = Number(raw);
	return Number.isFinite(parsed) ? parsed : null;
}

async function submit() {
	const count = entered.value;
	if (busy.value || count === null) return;
	busy.value = true;

	try {
		const verdict = await props.run(props.nudge, { kind: 'count', value: count });
		emit('verdict', verdict, { count });
		if (verdict.status !== 'passed') return;

		emit('resolved', await resolve({ nudge: props.nudge, outcome: 'passed', verdict, count }));
	} finally {
		busy.value = false;
	}
}
</script>
