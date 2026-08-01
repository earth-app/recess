<template>
	<div
		class="relative flex min-h-full flex-col items-center justify-center gap-10 px-8 py-16 text-center"
	>
		<div
			class="pointer-events-none absolute top-1/4 left-1/2 size-72 -translate-x-1/2 rounded-full blur-3xl"
			:style="{ background: halo }"
		/>

		<span
			class="relative flex size-28 items-center justify-center rounded-4xl"
			:style="{ background: soft }"
		>
			<UIcon
				:name="icon"
				class="text-6xl"
				:style="{ color: accentColor }"
			/>
		</span>

		<div class="relative flex max-w-sm flex-col gap-4">
			<h1 class="font-title text-3xl leading-tight font-semibold tracking-tight text-balance">
				{{ title }}
			</h1>
			<p class="text-base leading-relaxed opacity-70">{{ body }}</p>
		</div>
	</div>
</template>

<script setup lang="ts">
import { resolveColor, withAlpha } from '~/utils/color';

const props = withDefaults(
	defineProps<{
		icon: string;
		title: string;
		body: string;
		accent?: string;
	}>(),
	{ accent: '@green' }
);

const accentColor = computed(() => resolveColor(props.accent));
const soft = computed(() => withAlpha(props.accent, 0.14));
const halo = computed(() => withAlpha(props.accent, 0.16));
</script>
