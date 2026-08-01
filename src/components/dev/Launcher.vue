<template>
	<button
		type="button"
		aria-label="Open Developer Panel"
		class="pb-safe fixed right-3 bottom-20 z-50! flex! size-11! items-center! justify-center! rounded-full! shadow-lg!"
		:style="buttonStyle"
		@click="open = true"
	>
		<UIcon
			name="mdi:wrench-outline"
			class="text-xl"
		/>
		<span
			v-if="active"
			class="absolute -top-0.5 -right-0.5 size-3 rounded-full"
			:style="dotStyle"
		/>
	</button>

	<DevPanel
		:is-open="open"
		@did-dismiss="open = false"
	/>
</template>

<script setup lang="ts">
import { resolveColor, withAlpha } from '~/utils/color';
import { devOverridesActive } from '~/utils/dev';

const open = ref(false);

// polled rather than reactive: the override store is a plain object so the panel can
// be read from outside a component, and a dot that lags a second costs nothing
const active = ref(false);
let timer: ReturnType<typeof setInterval> | null = null;

const buttonStyle = {
	background: 'var(--ion-background-color-step-150)',
	color: 'var(--ion-text-color)',
	border: `1px solid ${withAlpha('@orange', 0.5)}`
};

const dotStyle = { background: resolveColor('@orange') };

onMounted(() => {
	active.value = devOverridesActive();
	timer = setInterval(() => {
		active.value = devOverridesActive();
	}, 1000);
});

onBeforeUnmount(() => {
	if (timer !== null) clearInterval(timer);
	timer = null;
});
</script>
