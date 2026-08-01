<template>
	<div :class="['relative rounded-[inherit]', motionOk && 'gradient-border-host']">
		<div
			v-if="motionOk"
			aria-hidden="true"
			class="gradient-border-ring"
			:style="ringStyle"
		/>
		<div class="relative z-10 rounded-[inherit]">
			<slot />
		</div>
	</div>
</template>

<script setup lang="ts">
const props = withDefaults(
	defineProps<{
		speed?: number;
		thickness?: number;
		from?: string;
		via?: string;
		to?: string;
	}>(),
	{
		speed: 8,
		thickness: 2,
		from: 'var(--nudge-accent, #2d9973)',
		via: 'var(--nudge-accent-soft, #2d997326)',
		to: 'var(--nudge-accent-strong, #227356)'
	}
);

const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
const settings = useAppSettingsState();

// a frozen conic gradient still reads as a glowing ring in the wrong place, so drop it entirely
const motionOk = computed(() => !prefersReducedMotion.value && settings.value.animations);

const ringStyle = computed(() => ({
	'--gb-from': props.from,
	'--gb-via': props.via,
	'--gb-to': props.to,
	'--gb-thickness': `${props.thickness}px`,
	'--gb-speed': `${props.speed}s`
}));
</script>

<style scoped>
/* rotate the gradient angle, not the element - rotating the element escapes the host
   without overflow:hidden and paints diagonal streaks across the page */
@property --gb-angle {
	syntax: '<angle>';
	initial-value: 0deg;
	inherits: false;
}

@keyframes gb-spin {
	to {
		--gb-angle: 360deg;
	}
}

.gradient-border-host {
	isolation: isolate;
	overflow: hidden;
}

.gradient-border-ring {
	position: absolute;
	inset: 0;
	border-radius: inherit;
	padding: var(--gb-thickness);
	background: conic-gradient(
		from var(--gb-angle),
		var(--gb-from),
		var(--gb-via),
		var(--gb-to),
		var(--gb-from)
	);
	-webkit-mask:
		linear-gradient(black, black) content-box,
		linear-gradient(black, black);
	-webkit-mask-composite: xor;
	mask:
		linear-gradient(black, black) content-box,
		linear-gradient(black, black);
	mask-composite: exclude;
	pointer-events: none;
	z-index: 0;
	animation: gb-spin var(--gb-speed) linear infinite;
	opacity: 0.85;
}

/* older firefox doesn't support @property; skip the animation rather than have the
   ring sit static-but-glowing in the wrong place */
@supports not (background: paint(something)) {
	.gradient-border-ring {
		animation: none;
	}
}
</style>
