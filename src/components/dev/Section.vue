<template>
	<section
		class="flex flex-col gap-2 rounded-2xl p-3"
		:style="surfaceStyle"
	>
		<h2 class="text-xs font-semibold tracking-wide uppercase opacity-60">{{ title }}</h2>
		<slot />
	</section>
</template>

<script setup lang="ts">
defineProps<{ title: string }>();

// the Ionic item surface rather than a Nuxt UI token, so it tracks the same palette
// as everything else inside the sheet
const surfaceStyle = {
	background: 'var(--ion-item-background, var(--ion-background-color-step-50))'
};
</script>
