<template>
	<section
		class="flex flex-col gap-3 rounded-2xl border border-(--ion-background-color-step-150) bg-(--ion-background-color-step-50) p-4"
	>
		<div class="flex flex-col gap-1">
			<h2 class="text-base font-semibold">{{ t('playground.traitsTitle') }}</h2>
			<p class="text-sm text-(--ion-text-color-step-350)">{{ t('playground.traitsBody') }}</p>
		</div>

		<dl class="flex flex-col gap-2">
			<div
				v-for="row in rows"
				:key="row.id"
				class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1"
			>
				<dt class="text-xs tracking-wide text-(--ion-text-color-step-450) uppercase">
					{{ row.label }}
				</dt>
				<dd class="flex min-w-0 items-center gap-2">
					<span class="text-sm font-semibold">{{ row.value }}</span>
					<UBadge
						size="sm"
						variant="soft"
						color="neutral"
						class="shrink-0"
					>
						{{ t('playground.traitShare', { percent: row.percent }) }}
					</UBadge>
				</dd>
			</div>
		</dl>
	</section>
</template>

<script setup lang="ts">
import type { SceneTraits } from '~/utils/playground';
import { LAYOUT_GRAMMAR_WEIGHTS, MOTIF_WEIGHTS, PALETTE_FAMILY_WEIGHTS } from '~/utils/playground';

const props = defineProps<{ traits: SceneTraits }>();

const { t } = useI18n();

// every weight table sums to 100, so a weight already reads as a percentage
const rows = computed(() => [
	{
		id: 'palette',
		label: t('playground.trait.palette'),
		value: t(`playground.palette.${props.traits.paletteFamily}`),
		percent: PALETTE_FAMILY_WEIGHTS[props.traits.paletteFamily]
	},
	{
		id: 'layout',
		label: t('playground.trait.layout'),
		value: t(`playground.layout.${props.traits.layoutGrammar}`),
		percent: LAYOUT_GRAMMAR_WEIGHTS[props.traits.layoutGrammar]
	},
	{
		id: 'motif',
		label: t('playground.trait.motif'),
		value: t(`playground.motif.${props.traits.motif}`),
		percent: MOTIF_WEIGHTS[props.traits.motif]
	}
]);
</script>
