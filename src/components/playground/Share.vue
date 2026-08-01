<template>
	<IonModal
		:is-open="isOpen"
		:breakpoints="[0, 0.75, 0.95]"
		:initial-breakpoint="0.95"
		@did-dismiss="emit('didDismiss')"
	>
		<IonHeader class="ion-no-border">
			<IonToolbar>
				<IonTitle class="text-base!">{{ t('playground.shareTitle') }}</IonTitle>
				<IonButtons slot="end">
					<IonButton
						color="medium"
						fill="clear"
						@click="emit('didDismiss')"
					>
						{{ t('common.close') }}
					</IonButton>
				</IonButtons>
			</IonToolbar>
		</IonHeader>

		<IonContent>
			<div class="mx-auto flex w-full max-w-md flex-col gap-5 px-4 py-4">
				<p class="text-sm text-(--ion-text-color-step-300)">{{ t('playground.shareBody') }}</p>

				<IonSegment
					:value="mode"
					@ion-change="onMode($event)"
				>
					<IonSegmentButton value="show">
						<IonLabel class="text-xs!">{{ t('playground.showCode') }}</IonLabel>
					</IonSegmentButton>
					<IonSegmentButton value="scan">
						<IonLabel class="text-xs!">{{ t('playground.scanCode') }}</IonLabel>
					</IonSegmentButton>
				</IonSegment>

				<template v-if="mode === 'show'">
					<div
						class="flex flex-col items-center gap-3 rounded-3xl border border-(--ion-background-color-step-150) bg-(--ion-background-color-step-50) p-4"
					>
						<div
							v-if="codeSvg"
							class="w-full max-w-[16rem] rounded-2xl bg-white p-3"
							v-html="codeSvg"
						/>
						<IonSpinner
							v-else
							name="crescent"
							color="primary"
						/>

						<p class="text-center text-xs text-(--ion-text-color-step-350)">
							{{ t('playground.codeExpires') }}
						</p>
					</div>

					<div class="flex flex-col gap-2">
						<h3
							class="text-xs font-semibold tracking-wide text-(--ion-text-color-step-350) uppercase"
						>
							{{ t('playground.codePreviewNote') }}
						</h3>
						<div
							class="overflow-hidden rounded-2xl border border-(--ion-background-color-step-150)"
						>
							<PlaygroundCanvas
								v-if="previewScene"
								:scene="previewScene"
								:height="180"
							/>
						</div>
					</div>
				</template>

				<template v-else>
					<div
						class="relative aspect-square w-full overflow-hidden rounded-3xl border border-(--ion-background-color-step-150) bg-black"
					>
						<div
							:id="SCANNER_ELEMENT_ID"
							class="size-full"
						/>
						<div
							v-if="!scanning"
							class="absolute inset-0 flex items-center justify-center"
						>
							<IonSpinner
								name="crescent"
								color="light"
							/>
						</div>
					</div>

					<p class="text-center text-xs text-(--ion-text-color-step-350)">
						{{ t('playground.codeHint') }}
					</p>

					<p
						v-if="scanError"
						class="text-center text-sm text-(--ion-color-danger)"
					>
						{{ scanError }}
					</p>
				</template>
			</div>
		</IonContent>
	</IonModal>

	<IonModal
		:is-open="visitorOpen"
		@did-dismiss="closeVisitor"
	>
		<IonHeader class="ion-no-border">
			<IonToolbar>
				<IonTitle class="text-base!">{{ t('playground.visitorTitle') }}</IonTitle>
			</IonToolbar>
		</IonHeader>

		<IonContent>
			<div class="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-4">
				<div class="overflow-hidden rounded-3xl border border-(--ion-background-color-step-150)">
					<PlaygroundCanvas
						v-if="visitorScene"
						:scene="visitorScene"
						:height="280"
					/>
				</div>

				<p class="text-sm text-(--ion-text-color-step-300)">
					{{ t('playground.visitorBody', { count: visitorCount }, visitorCount) }}
				</p>

				<IonButton
					expand="block"
					color="primary"
					class="rounded-full!"
					@click="closeVisitor"
				>
					{{ t('playground.visitorClose') }}
				</IonButton>
			</div>
		</IonContent>
	</IonModal>
</template>

<script setup lang="ts">
import type { Html5Qrcode } from 'html5-qrcode';
import PlaygroundCanvas from '~/components/playground/Canvas.vue';
import { installSeed } from '~/utils/install';
import { buildScene, type PlaygroundScene, type SceneTuple } from '~/utils/playground';
import {
	decodeSceneCode,
	encodeSceneCode,
	SceneCodeError,
	shareableTuple
} from '~/utils/scene-code';

const props = defineProps<{ isOpen: boolean; tuple: SceneTuple | null }>();
const emit = defineEmits<{ didDismiss: [] }>();

const { t } = useI18n();
const { success, warning } = useHaptics();

const SCANNER_ELEMENT_ID = 'recess-playground-scanner';

type Mode = 'show' | 'scan';

const mode = ref<Mode>('show');
const codeSvg = ref('');
const previewScene = ref<PlaygroundScene | null>(null);
const scanning = ref(false);
const scanError = ref('');
/**
 * A scanned scene lives here and nowhere else - never in `Preferences`, never in
 * `localStorage`. Closing the sheet is what makes it a one-time view; the day bound in
 * the payload is what stops the code being re-used tomorrow.
 */
const visitorScene = ref<PlaygroundScene | null>(null);

// hoisted so the same value feeds the interpolation and the plural choice
const visitorCount = computed(() => visitorScene.value?.elements.length ?? 0);
const visitorOpen = ref(false);

let scanner: Html5Qrcode | null = null;

async function buildCode() {
	if (!props.tuple) return;

	const seed = await installSeed();
	const options = { installSeed: seed };

	// the sharer previews the tuple that is actually encoded, not their own, so the
	// re-rolled placement is visible before they hand the screen over
	previewScene.value = buildScene(shareableTuple(props.tuple, options));

	const { encodeQR } = await import('@paulmillr/qr');
	codeSvg.value = encodeQR(encodeSceneCode(props.tuple, options), 'svg', {
		ecc: 'medium',
		// alphanumeric is the whole reason the payload is base45; byte mode would be
		// denser but neither installed scanner can return bytes
		encoding: 'alphanumeric',
		border: 2
	});
}

function messageFor(error: unknown): string {
	if (error instanceof SceneCodeError) {
		if (error.kind === 'expired') return t('playground.codeExpired');
		if (error.kind === 'unsupported') return t('playground.codeUnsupported');
	}
	return t('playground.codeUnreadable');
}

function onScanned(text: string) {
	try {
		visitorScene.value = buildScene(decodeSceneCode(text).tuple);
		visitorOpen.value = true;
		scanError.value = '';
		success();
		void stopScanner();
	} catch (error) {
		warning();
		scanError.value = messageFor(error);
	}
}

async function startScanner() {
	scanError.value = '';

	try {
		const { Html5Qrcode } = await import('html5-qrcode');
		scanner = new Html5Qrcode(SCANNER_ELEMENT_ID, { verbose: false });
		await scanner.start(
			{ facingMode: 'environment' },
			{ fps: 10, qrbox: { width: 240, height: 240 } },
			onScanned,
			() => {
				// per-frame decode misses are the normal case, not an error worth surfacing
			}
		);
		scanning.value = true;
	} catch {
		scanning.value = false;
		scanError.value = t('playground.scannerUnavailable');
	}
}

async function stopScanner() {
	scanning.value = false;
	if (!scanner) return;

	try {
		await scanner.stop();
		scanner.clear();
	} catch {
		// already stopped, or the element went away with the sheet
	}
	scanner = null;
}

function onMode(event: Event) {
	const next = String((event as CustomEvent<{ value?: unknown }>).detail?.value ?? 'show');
	mode.value = next === 'scan' ? 'scan' : 'show';
}

function closeVisitor() {
	visitorOpen.value = false;
	// dropped rather than kept; the whole point is that it was one look
	visitorScene.value = null;
}

watch(
	() => [props.isOpen, mode.value] as const,
	async ([open, current]) => {
		if (!open) {
			await stopScanner();
			return;
		}

		if (current === 'show') {
			await stopScanner();
			await buildCode();
			return;
		}

		// the target element only exists once the segment has rendered it
		await nextTick();
		await startScanner();
	},
	{ immediate: true }
);

onBeforeUnmount(stopScanner);
</script>
