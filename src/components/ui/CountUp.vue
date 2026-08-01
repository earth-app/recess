<template>
	<span class="tabular-nums">{{ display }}</span>
</template>

<script setup lang="ts">
const props = withDefaults(
	defineProps<{
		value: number;
		duration?: number;
		format?: (n: number) => string;
		/**
		 * animate a 0 -> n change. off by default because that change is almost
		 * always the ledger hydrating on app open, not points the user just earned.
		 */
		animateFromZero?: boolean;
	}>(),
	{ duration: 700, animateFromZero: false }
);

const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
const settings = useAppSettingsState();

// starts settled on the incoming value, so mounting never ticks up from zero
const current = ref(props.value);
let raf: number | null = null;

const display = computed(() =>
	props.format ? props.format(current.value) : String(Math.round(current.value))
);

function stop() {
	if (raf !== null) cancelAnimationFrame(raf);
	raf = null;
}

function jump(to: number) {
	stop();
	current.value = to;
}

function animate(from: number, to: number) {
	stop();
	if (!import.meta.client || prefersReducedMotion.value || !settings.value.animations) {
		current.value = to;
		return;
	}

	const span = Math.max(1, props.duration);
	const start = performance.now();
	const delta = to - from;
	current.value = from;

	const tick = (now: number) => {
		const t = Math.min(1, (now - start) / span);
		const eased = 1 - (1 - t) ** 3;
		current.value = from + delta * eased;
		if (t < 1) {
			raf = requestAnimationFrame(tick);
		} else {
			current.value = to;
			raf = null;
		}
	};
	raf = requestAnimationFrame(tick);
}

watch(
	() => props.value,
	(next, prev) => {
		const from = prev ?? 0;
		if (from === 0 && !props.animateFromZero) {
			jump(next);
			return;
		}
		animate(from, next);
	}
);

onBeforeUnmount(stop);
</script>
