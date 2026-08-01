<template>
	<div
		class="overflow-hidden rounded-2xl border border-(--ion-background-color-step-150) bg-(--ion-background-color-step-50)"
	>
		<IonList
			:inset="false"
			class="bg-transparent! py-0!"
		>
			<IonItem
				v-for="(nudge, index) in nudges"
				:key="nudge.id"
				:button="!isDone(nudge)"
				:detail="false"
				:lines="index === nudges.length - 1 ? 'none' : 'full'"
				:style="itemStyle(nudge)"
				@click="open(nudge)"
			>
				<span
					class="mr-3! flex! size-9! shrink-0! items-center! justify-center! rounded-xl!"
					:style="markerStyle(nudge)"
				>
					<UIcon
						:name="isDone(nudge) ? 'mdi:check-bold' : nudge.icon"
						class="text-lg!"
					/>
					<span
						v-if="isDone(nudge)"
						class="sr-only!"
					>
						{{ t('common.done') }}
					</span>
				</span>

				<IonLabel>
					<p
						class="text-sm! font-semibold!"
						:class="
							isDone(nudge)
								? 'text-(--ion-text-color-step-400)! line-through!'
								: 'text-(--ion-text-color)!'
						"
					>
						{{ nudgeTitle(nudge) }}
					</p>
					<p
						class="text-xs! font-medium!"
						:class="
							isDone(nudge)
								? 'text-(--ion-text-color-step-400)!'
								: 'text-(--ion-text-color-step-350)!'
						"
					>
						{{ t(`nudge.category.${nudge.category}`) }}
					</p>
				</IonLabel>

				<span
					class="ml-2! shrink-0! text-xs! font-semibold! tabular-nums!"
					:class="
						isDone(nudge)
							? 'text-(--ion-text-color-step-400)!'
							: 'text-(--ion-text-color-step-300)!'
					"
				>
					{{ t('common.pointsShort', { count: nudge.points }) }}
				</span>
			</IonItem>
		</IonList>
	</div>
</template>

<script setup lang="ts">
import type { Nudge } from '~/types/nudge';
import { nudgeTitle } from '~/types/nudge';
import { resolveColor, withAlpha } from '~/utils/color';

const props = defineProps<{ nudges: Nudge[]; resolvedIds: Set<string> }>();
const emit = defineEmits<{ open: [Nudge] }>();

const { t } = useI18n();

function isDone(nudge: Nudge): boolean {
	return props.resolvedIds.has(nudge.id);
}

// a resolved row is not a control; the sheet has no review state, so reopening one
// would offer its resolution again and bank the points twice
function open(nudge: Nudge) {
	if (isDone(nudge)) return;
	emit('open', nudge);
}

function itemStyle(nudge: Nudge) {
	return {
		'--background': isDone(nudge)
			? 'color-mix(in srgb, var(--ion-color-success) 6%, transparent)'
			: 'transparent',
		'--border-color': 'var(--ion-background-color-step-150)',
		'--padding-start': '12px',
		'--inner-padding-end': '12px',
		'--min-height': '60px'
	};
}

/**
 * a resolved row reads as a filled success mark; an open one keeps its own accent,
 * pulled toward the page's text colour so a pale hue (@gold, @yellow) still lands
 */
function markerStyle(nudge: Nudge) {
	if (isDone(nudge)) {
		return {
			background: 'var(--ion-color-success)',
			color: 'var(--ion-color-success-contrast)'
		};
	}

	return {
		background: withAlpha(nudge.color, 0.18),
		color: `color-mix(in srgb, ${resolveColor(nudge.color)} 55%, var(--ion-text-color))`
	};
}
</script>
