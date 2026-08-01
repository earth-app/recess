<template>
	<div class="flex flex-col gap-10 py-6">
		<h2 class="text-center text-3xl leading-snug font-semibold">{{ nudge.prompt }}</h2>

		<IonButton
			expand="block"
			:disabled="busy"
			:style="accent"
			class="m-0! h-12! rounded-full! text-base! font-semibold! normal-case!"
			@click="done"
		>
			<IonSpinner
				v-if="busy"
				name="crescent"
				class="mr-2! h-4! w-4!"
			/>
			{{ t('nudge.imDone') }}
		</IonButton>
	</div>
</template>

<script setup lang="ts">
import type { ResolveResult } from '~/composables/useResolve';
import type { ThinkNudge } from '~/types/nudge';

const props = defineProps<{ nudge: ThinkNudge }>();

const emit = defineEmits<{ resolved: [ResolveResult] }>();

const { t } = useI18n();
const { resolve } = useResolve();

const busy = ref(false);

const accent: Record<string, string> = {
	'--background': 'var(--nudge-accent)',
	'--color': 'var(--nudge-on-accent)'
};

async function done() {
	if (busy.value) return;
	busy.value = true;

	try {
		emit('resolved', await resolve({ nudge: props.nudge, outcome: 'answered' }));
	} finally {
		busy.value = false;
	}
}
</script>
