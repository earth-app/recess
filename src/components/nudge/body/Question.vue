<template>
	<div class="flex flex-col gap-6">
		<h2 class="text-2xl leading-tight font-semibold">{{ nudge.question }}</h2>

		<div class="flex flex-col gap-2">
			<IonButton
				v-for="(action, index) in nudge.actions"
				:key="index"
				expand="block"
				fill="outline"
				:disabled="busy"
				:style="actionStyle(action)"
				class="m-0! h-12! rounded-full! text-base! font-semibold! normal-case!"
				@click="pick(action, index)"
			>
				<IonSpinner
					v-if="pending === index"
					name="crescent"
					class="mr-2! h-4! w-4!"
				/>
				<UIcon
					v-else-if="action.icon"
					:name="action.icon"
					class="mr-2! text-lg!"
				/>
				{{ action.label }}
				<UIcon
					v-if="action.leads_to"
					name="mdi:arrow-right-thin"
					class="ml-2! text-lg!"
				/>
			</IonButton>
		</div>
	</div>
</template>

<script setup lang="ts">
import type { ResolveResult } from '~/composables/useResolve';
import type { NudgeAction, QuestionNudge } from '~/types/nudge';
import { resolveColor } from '~/utils/color';

const props = defineProps<{ nudge: QuestionNudge }>();

const emit = defineEmits<{
	resolved: [ResolveResult];
	leadsTo: [string | null];
}>();

const { resolve } = useResolve();

const busy = ref(false);
const pending = ref<number | null>(null);

function actionStyle(action: NudgeAction): Record<string, string> {
	const color = resolveColor(action.color);
	return { '--border-color': color, '--color': color };
}

async function pick(action: NudgeAction, index: number) {
	if (busy.value) return;
	busy.value = true;
	pending.value = index;

	try {
		// announced before the result so the sheet can offer the follow-up as it lands
		emit('leadsTo', action.leads_to ?? null);
		emit(
			'resolved',
			await resolve({ nudge: props.nudge, outcome: 'answered', choice: action.label })
		);
	} finally {
		busy.value = false;
		pending.value = null;
	}
}
</script>
