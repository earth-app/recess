<template>
	<div class="flex flex-col gap-6">
		<h2 class="text-2xl leading-tight font-semibold">{{ nudge.prompt }}</h2>

		<div class="flex flex-col gap-2">
			<IonButton
				v-for="(option, index) in nudge.options"
				:key="index"
				expand="block"
				fill="outline"
				:disabled="busy"
				:style="optionStyle(option)"
				class="m-0! h-12! rounded-full! text-base! font-semibold! normal-case!"
				@click="pick(option, index)"
			>
				<IonSpinner
					v-if="pending === index"
					name="crescent"
					class="mr-2! h-4! w-4!"
				/>
				<UIcon
					v-else-if="option.icon"
					:name="option.icon"
					class="mr-2! text-lg!"
				/>
				{{ option.text }}
			</IonButton>
		</div>
	</div>
</template>

<script setup lang="ts">
import type { ResolveResult } from '~/composables/useResolve';
import type { ChooseNudge, NudgeOption } from '~/types/nudge';
import { resolveColor } from '~/utils/color';

const props = defineProps<{ nudge: ChooseNudge }>();

const emit = defineEmits<{ resolved: [ResolveResult] }>();

const { resolve } = useResolve();

const busy = ref(false);
const pending = ref<number | null>(null);

function optionStyle(option: NudgeOption): Record<string, string> {
	const color = resolveColor(option.color);
	return { '--border-color': color, '--color': color };
}

async function pick(option: NudgeOption, index: number) {
	if (busy.value) return;
	busy.value = true;
	pending.value = index;

	try {
		emit(
			'resolved',
			await resolve({ nudge: props.nudge, outcome: 'answered', choice: option.text })
		);
	} finally {
		busy.value = false;
		pending.value = null;
	}
}
</script>
