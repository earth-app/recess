<template>
	<div
		class="relative inline-flex items-center justify-center"
		role="img"
		:aria-label="ariaLabel || fallbackLabel"
		:style="{ width: `${size}px`, height: `${size}px` }"
	>
		<svg
			:width="size"
			:height="size"
			:viewBox="`0 0 ${size} ${size}`"
		>
			<circle
				:cx="center"
				:cy="center"
				:r="radius"
				fill="none"
				:stroke="trackColor"
				:stroke-width="thickness"
			/>
			<circle
				:class="motionOk ? 'ring-progress' : undefined"
				:cx="center"
				:cy="center"
				:r="radius"
				fill="none"
				:stroke="ringColor"
				:stroke-width="thickness"
				stroke-linecap="round"
				:stroke-dasharray="circumference"
				:stroke-dashoffset="offset"
				:transform="`rotate(-90 ${center} ${center})`"
			/>
		</svg>
		<span
			class="absolute leading-none font-semibold tabular-nums"
			:style="{ fontSize: `${textSize}px`, color: labelColor }"
		>
			{{ label ?? clamped }}
		</span>
	</div>
</template>

<script setup lang="ts">
import { parseColor, resolveColor } from '~/utils/color';

const props = withDefaults(
	defineProps<{
		value: number;
		max: number;
		size?: number;
		thickness?: number;
		color?: string;
		/** the unfilled remainder; a solid step so the arc reads against it */
		track?: string;
		/** the centre count; neutral by default because an accent can be any hue */
		textColor?: string;
		label?: string;
		ariaLabel?: string;
	}>(),
	{
		size: 72,
		thickness: 6,
		color: 'var(--nudge-accent)',
		track: 'var(--ion-background-color-step-150)',
		textColor: 'var(--ion-text-color)'
	}
);

const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
const settings = useAppSettingsState();
const motionOk = computed(() => !prefersReducedMotion.value && settings.value.animations);

const max = computed(() => Math.max(0, Math.floor(props.max || 0)));
const clamped = computed(() => Math.min(max.value, Math.max(0, Math.floor(props.value || 0))));
const pct = computed(() => (max.value > 0 ? clamped.value / max.value : 0));

const center = computed(() => props.size / 2);
const radius = computed(() => Math.max(0, (props.size - props.thickness) / 2));
const circumference = computed(() => 2 * Math.PI * radius.value);
const offset = computed(() => circumference.value * (1 - pct.value));
const textSize = computed(() => Math.round(props.size * 0.32));

const fallbackLabel = computed(() => `${clamped.value} of ${max.value} resolved`);

// authored tokens (@green, #rrggbb, rgb(...)) resolve; anything else is already css
function asCss(token: string): string {
	return parseColor(token) ? resolveColor(token) : token;
}

const ringColor = computed(() => asCss(props.color));
const trackColor = computed(() => asCss(props.track));
const labelColor = computed(() => asCss(props.textColor));
</script>

<style scoped>
.ring-progress {
	transition: stroke-dashoffset 600ms cubic-bezier(0.22, 1, 0.36, 1);
}
</style>
