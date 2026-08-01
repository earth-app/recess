<template>
	<div
		class="relative flex h-full w-full flex-col overflow-hidden rounded-3xl border border-(--ion-background-color-step-150) shadow-xl"
		:style="vars"
	>
		<div class="nudge-wash absolute inset-0" />

		<div
			class="absolute inset-x-0 top-0 h-1.5"
			:style="{
				background: 'linear-gradient(90deg, var(--nudge-accent), var(--nudge-accent-strong))'
			}"
		/>

		<div class="relative flex h-full flex-col gap-5 p-6 pt-7">
			<div class="flex items-start gap-3">
				<span
					class="flex size-14 shrink-0 items-center justify-center rounded-2xl shadow-sm"
					:style="{ background: 'var(--nudge-accent)' }"
				>
					<UIcon
						:name="nudge.icon"
						class="text-3xl"
						:style="{ color: 'var(--nudge-on-accent)' }"
					/>
				</span>

				<div class="flex min-w-0 flex-col items-start gap-1.5">
					<UBadge
						variant="soft"
						size="sm"
						class="max-w-full truncate"
						:style="{
							background: 'var(--nudge-accent-soft)',
							color: 'var(--ion-text-color-step-200)'
						}"
					>
						{{ categoryLabel }}
					</UBadge>

					<span
						v-if="nudge.duration_minutes"
						class="flex items-center gap-1 text-xs font-medium text-(--ion-text-color-step-350)"
					>
						<UIcon
							name="mdi:clock-outline"
							class="shrink-0"
						/>
						{{ t('nudge.takesMinutes', { count: nudge.duration_minutes }) }}
					</span>
				</div>
			</div>

			<div class="flex min-h-0 flex-1 flex-col justify-start gap-2.5">
				<h2
					data-testid="nudge-title"
					class="text-2xl leading-tight font-semibold text-balance"
				>
					{{ title }}
				</h2>
				<p
					v-if="body"
					class="text-base leading-relaxed text-pretty text-(--ion-text-color-step-250)"
				>
					{{ body }}
				</p>
			</div>

			<div class="flex items-center justify-between gap-3">
				<span
					class="rounded-full px-3 py-1 text-sm font-semibold tabular-nums"
					:style="{
						background: 'var(--nudge-accent)',
						color: 'var(--nudge-on-accent)'
					}"
				>
					{{ t('common.pointsShort', { count: nudge.points }) }}
				</span>

				<span
					v-if="validationLabel"
					class="flex items-center gap-1.5 rounded-full bg-(--ion-background-color-step-100) px-2.5 py-1 text-xs font-medium text-(--ion-text-color-step-300)"
				>
					<UIcon
						:name="validationIcon"
						class="shrink-0"
					/>
					{{ validationLabel }}
				</span>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import type { Nudge, ValidationType } from '~/types/nudge';
import { nudgeBody, nudgeTitle, nudgeValidationType } from '~/types/nudge';
import { nudgeColorVars } from '~/utils/color';

const props = defineProps<{ nudge: Nudge }>();

const { t } = useI18n();

const vars = computed(() => nudgeColorVars(props.nudge.color));
const title = computed(() => nudgeTitle(props.nudge));
const body = computed(() => nudgeBody(props.nudge));
const categoryLabel = computed(() => t(`nudge.category.${props.nudge.category}`));

const VALIDATION_ICONS: Record<ValidationType, string> = {
	confirm: 'mdi:check-circle-outline',
	text: 'mdi:pencil-outline',
	photo: 'mdi:camera-outline',
	audio: 'mdi:microphone-outline',
	barcode: 'mdi:barcode-scan',
	count: 'mdi:numeric'
};

const validation = computed(() => nudgeValidationType(props.nudge));
const validationIcon = computed(() =>
	validation.value ? VALIDATION_ICONS[validation.value] : 'mdi:circle-outline'
);
const validationLabel = computed(() =>
	validation.value ? t(`nudge.type.${props.nudge.type}`) : null
);
</script>
