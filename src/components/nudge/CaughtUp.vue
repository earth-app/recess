<template>
	<div class="relative flex flex-col items-center gap-5 px-8 py-14 text-center">
		<UiSparkleBurst
			:trigger="burst"
			color="green"
			:count="34"
		/>

		<span
			class="flex size-20 items-center justify-center rounded-full shadow-sm"
			:style="{ background: 'var(--ion-color-success)' }"
		>
			<UIcon
				name="mdi:slide"
				class="text-4xl"
				:style="{ color: 'var(--ion-color-success-contrast)' }"
			/>
		</span>

		<div class="flex flex-col gap-2">
			<h2 class="text-2xl font-semibold text-balance">{{ t('today.caughtUpTitle') }}</h2>
			<p class="text-base leading-relaxed text-pretty text-(--ion-text-color-step-250)">
				{{ t('today.caughtUpBody') }}
			</p>
		</div>

		<IonButton
			fill="solid"
			color="primary"
			class="rounded-full! px-5! text-sm! font-semibold!"
			@click="navigateTo('/tabs/week')"
		>
			{{ t('today.caughtUpAction') }}
		</IonButton>
	</div>
</template>

<script setup lang="ts">
const { t } = useI18n();

// one burst when the day closes out; the component only mounts on that state
const burst = ref(0);
onMounted(() => {
	burst.value = 1;
});
</script>
