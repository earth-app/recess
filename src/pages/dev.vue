<template>
	<IonPage>
		<IonHeader :translucent="true">
			<IonToolbar>
				<IonButtons slot="start">
					<IonBackButton
						color="medium"
						default-href="/tabs/today"
					/>
				</IonButtons>
				<IonTitle>Developer</IonTitle>
			</IonToolbar>
		</IonHeader>

		<IonContent :fullscreen="true">
			<div class="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-6">
				<p class="text-sm opacity-70">
					This route only exists in a <code>dev:*:debug</code> build. Production strips it from the
					router, so the chunk is never emitted.
				</p>

				<dl class="flex flex-col gap-1 text-xs tabular-nums opacity-70">
					<div class="flex justify-between gap-3">
						<dt>Install seed</dt>
						<dd>{{ seed || 'not loaded' }}</dd>
					</div>
					<div class="flex justify-between gap-3">
						<dt>Day key</dt>
						<dd>{{ today }}</dd>
					</div>
					<div class="flex justify-between gap-3">
						<dt>Catalog</dt>
						<dd>{{ nudges.catalog.length }} nudges</dd>
					</div>
					<div class="flex justify-between gap-3">
						<dt>Locale</dt>
						<dd>{{ nudges.loadedLocale ?? 'none' }}</dd>
					</div>
				</dl>

				<IonButton
					expand="block"
					color="primary"
					class="rounded-full!"
					@click="open = true"
				>
					Open the Panel
				</IonButton>
			</div>

			<DevPanel
				:is-open="open"
				@did-dismiss="open = false"
			/>
		</IonContent>
	</IonPage>
</template>

<script setup lang="ts">
import { dayKey } from '~/utils/day';
import { installSeed } from '~/utils/install';

const nudges = useNudgesStore();

const open = ref(false);
const seed = ref('');
const today = dayKey(new Date());

onMounted(async () => {
	seed.value = await installSeed();
});
</script>
