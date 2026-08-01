<template>
	<div class="flex flex-col gap-3">
		<UAlert
			v-if="!hasPack"
			color="warning"
			variant="subtle"
			icon="mdi:cloud-off-outline"
			:title="t('validation.unavailableTitle')"
			:description="t('validation.packMissing', { pack: t('settings.packText') })"
		/>

		<IonTextarea
			:value="text"
			:auto-grow="true"
			:rows="6"
			:maxlength="limits.max"
			:placeholder="t('validation.textPlaceholder')"
			:disabled="busy"
			fill="outline"
			class="text-base!"
			@ion-input="
				(event) => {
					text = event.target.value || '';
				}
			"
		/>

		<span
			class="text-xs"
			:class="met ? 'font-semibold' : 'opacity-60'"
			:style="met ? metStyle : undefined"
		>
			{{ counter }}
		</span>

		<IonButton
			v-if="hasPack"
			expand="block"
			:disabled="!met || busy"
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

		<IonButton
			v-else
			expand="block"
			:disabled="!met || busy"
			:style="accent"
			class="m-0! h-12! rounded-full! text-base! font-semibold! normal-case!"
			@click="attest"
		>
			{{ t('validation.selfAttest') }}
		</IonButton>
	</div>
</template>

<script setup lang="ts">
import type { ResolveInput, ResolveResult } from '~/composables/useResolve';
import type { Nudge, TextValidationData } from '~/types/nudge';
import { textLengthWindow, type Submission, type Verdict } from '~/utils/validate';

const props = defineProps<{
	nudge: Nudge;
	data: TextValidationData;
	run: (nudge: Nudge, submission: Submission) => Promise<Verdict>;
}>();

const emit = defineEmits<{
	verdict: [Verdict, Pick<ResolveInput, 'text' | 'count' | 'media'>];
	resolved: [ResolveResult];
}>();

const { t } = useI18n();
const { resolve } = useResolve();
const models = useModelsStore();

const text = ref('');
const busy = ref(false);

const accent: Record<string, string> = {
	'--background': 'var(--nudge-accent)',
	'--color': 'var(--nudge-on-accent)'
};
const metStyle: Record<string, string> = { color: 'var(--nudge-accent)' };

const hasPack = computed(() => models.has('text'));
// the same clamp the validator applies, so the counter cannot promise a pass it would refuse
const limits = computed(() => textLengthWindow(props.data));
const length = computed(() => text.value.trim().length);
const met = computed(() => length.value >= limits.value.min);

const counter = computed(() =>
	met.value
		? t('validation.textCounterDone', { count: length.value })
		: t('validation.textCounter', { count: length.value, min: limits.value.min })
);

async function submit() {
	if (busy.value || !met.value) return;
	busy.value = true;

	const written = text.value.trim();

	try {
		const verdict = await props.run(props.nudge, { kind: 'text', text: written });
		emit('verdict', verdict, { text: written });
		if (verdict.status !== 'passed') return;

		emit(
			'resolved',
			await resolve({ nudge: props.nudge, outcome: 'passed', verdict, text: written })
		);
	} finally {
		busy.value = false;
	}
}

async function attest() {
	if (busy.value || !met.value) return;
	busy.value = true;

	try {
		emit(
			'resolved',
			await resolve({ nudge: props.nudge, outcome: 'self_attested', text: text.value.trim() })
		);
	} finally {
		busy.value = false;
	}
}
</script>
