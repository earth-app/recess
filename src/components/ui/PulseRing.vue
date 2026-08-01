<template>
	<span class="relative inline-flex rounded-[inherit]">
		<slot />
		<span
			v-if="showRing"
			aria-hidden="true"
			class="pulse-ring-anim pointer-events-none absolute inset-0 rounded-[inherit]"
			:style="ringStyle"
		/>
	</span>
</template>

<script setup lang="ts">
import { parseColor, resolveColor } from '~/utils/color';

const props = withDefaults(
	defineProps<{
		color?: string;
		active?: boolean;
		speed?: number;
	}>(),
	{ color: 'var(--nudge-accent)', active: true, speed: 1.4 }
);

const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
const settings = useAppSettingsState();

const showRing = computed(
	() => props.active && !prefersReducedMotion.value && settings.value.animations
);

// authored tokens (@green, #rrggbb, rgb(...)) resolve; anything else is already css
const ringColor = computed(() =>
	parseColor(props.color) ? resolveColor(props.color) : props.color
);

const ringStyle = computed(() => ({
	border: `2px solid ${ringColor.value}`,
	'--pr-speed': `${props.speed}s`
}));
</script>

<style scoped>
@keyframes pulse-ring {
	0% {
		opacity: 0.8;
		transform: scale(1);
	}
	80% {
		opacity: 0;
		transform: scale(1.35);
	}
	100% {
		opacity: 0;
		transform: scale(1.4);
	}
}

.pulse-ring-anim {
	opacity: 0;
	animation: pulse-ring var(--pr-speed, 1.4s) ease-out infinite;
}

@media (prefers-reduced-motion: reduce) {
	.pulse-ring-anim {
		animation: none;
	}
}
</style>
