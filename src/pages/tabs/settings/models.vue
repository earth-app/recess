<template>
	<IonPage>
		<IonHeader :translucent="true">
			<IonToolbar>
				<IonButtons slot="start">
					<IonBackButton default-href="/tabs/settings" />
				</IonButtons>
				<IonTitle>{{ t('settings.models') }}</IonTitle>
			</IonToolbar>
		</IonHeader>

		<IonContent :fullscreen="true">
			<IonList
				:inset="true"
				class="mt-2!"
			>
				<IonItem
					lines="full"
					class="[--min-height:70px]"
				>
					<span
						slot="start"
						class="flex size-10 items-center justify-center rounded-2xl"
						:style="{ background: withAlpha(TIER_TOKEN, 0.16) }"
					>
						<UIcon
							name="mdi:chip"
							class="text-xl"
							:style="{ color: resolveColor(TIER_TOKEN) }"
						/>
					</span>

					<IonLabel class="whitespace-normal!">
						<h2 class="text-base! font-semibold!">{{ t('settings.deviceTier') }}</h2>
						<p class="mt-0.5! text-sm! text-(--ion-text-color-step-400)!">
							{{ tierLabel(tier) }}
						</p>
					</IonLabel>
				</IonItem>

				<IonItem lines="full">
					<div
						class="my-3 flex w-full items-stretch overflow-hidden rounded-2xl"
						:style="{ background: withAlpha(TIER_TOKEN, 0.1) }"
					>
						<IonButton
							size="small"
							fill="clear"
							color="medium"
							:disabled="tier <= 1"
							class="m-0! h-11! flex-1! text-xs! font-semibold!"
							@click="step(-1)"
						>
							{{ t('settings.useSmaller') }}
						</IonButton>

						<span
							class="w-px self-stretch"
							:style="{ background: withAlpha(TIER_TOKEN, 0.24) }"
						/>

						<IonButton
							size="small"
							fill="clear"
							color="medium"
							:disabled="tier >= 3"
							class="m-0! h-11! flex-1! text-xs! font-semibold!"
							@click="step(1)"
						>
							{{ t('settings.useLarger') }}
						</IonButton>
					</div>
				</IonItem>

				<IonItem
					v-if="overridden"
					lines="full"
					button
					:detail="false"
					class="[--min-height:70px]"
					@click="useDetected"
				>
					<span
						slot="start"
						class="flex size-10 items-center justify-center rounded-2xl"
						:style="{ background: withAlpha(TIER_TOKEN, 0.16) }"
					>
						<UIcon
							name="mdi:backup-restore"
							class="text-xl"
							:style="{ color: resolveColor(TIER_TOKEN) }"
						/>
					</span>

					<IonLabel class="whitespace-normal!">
						<h2 class="text-base! font-semibold!">{{ t('settings.useDetected') }}</h2>
						<p class="mt-0.5! text-sm! text-(--ion-text-color-step-400)!">
							{{ t('settings.tierDetected', { tier: tierLabel(detectedTier) }) }}
						</p>
					</IonLabel>
				</IonItem>

				<IonItem
					lines="none"
					button
					:detail="false"
					:disabled="benchmarking"
					class="[--min-height:62px] [&.item-disabled]:opacity-60!"
					@click="rerun"
				>
					<span
						slot="start"
						class="flex size-10 items-center justify-center rounded-2xl"
						:style="{ background: withAlpha(TIER_TOKEN, 0.16) }"
					>
						<UIcon
							name="mdi:speedometer"
							class="text-xl"
							:style="{ color: resolveColor(TIER_TOKEN) }"
						/>
					</span>

					<IonLabel class="whitespace-normal!">
						<h2 class="text-base! font-semibold!">
							{{ benchmarking ? t('settings.benchmarkRunning') : t('settings.rerunBenchmark') }}
						</h2>
					</IonLabel>

					<IonSpinner
						v-if="benchmarking"
						slot="end"
						name="crescent"
						color="medium"
						class="size-4!"
					/>
				</IonItem>
			</IonList>

			<p class="px-6 pt-2 text-xs leading-relaxed text-(--ion-text-color-step-400)">
				{{ t('settings.tierHint') }}
			</p>

			<div
				v-if="offline"
				class="px-4 pt-3"
			>
				<UAlert
					color="neutral"
					variant="subtle"
					icon="mdi:wifi-off"
					:title="t('settings.packOffline')"
				/>
			</div>

			<div
				v-else-if="cellular"
				class="px-4 pt-3"
			>
				<UAlert
					color="warning"
					variant="subtle"
					icon="mdi:signal-cellular-2"
					:title="t('settings.packOnCellular')"
				/>
			</div>

			<div
				v-if="stalePacks.length > 0"
				class="px-4 pt-3"
			>
				<UAlert
					color="warning"
					variant="subtle"
					icon="mdi:alert-outline"
					:title="t('settings.packStale')"
					:description="t('settings.packStaleBody')"
				/>
			</div>

			<IonList
				:inset="true"
				class="mt-4!"
			>
				<IonItem
					v-for="(pack, index) in MODEL_PACKS"
					:key="pack"
					:lines="index === MODEL_PACKS.length - 1 ? 'none' : 'full'"
					class="[--min-height:86px]"
				>
					<span
						slot="start"
						class="flex size-10 items-center justify-center rounded-2xl"
						:style="{ background: withAlpha(PACK_TOKENS[pack], 0.16) }"
					>
						<UIcon
							:name="PACK_ICONS[pack]"
							class="text-xl"
							:style="{ color: resolveColor(PACK_TOKENS[pack]) }"
						/>
					</span>

					<IonLabel class="whitespace-normal!">
						<h2 class="text-base! font-semibold!">
							{{ t(labelKeys[pack]) }}
							<UBadge
								v-if="isStale(pack)"
								color="warning"
								variant="subtle"
								size="sm"
								class="ml-2 align-middle"
							>
								{{ t('settings.packStale') }}
							</UBadge>
						</h2>
						<p class="mt-0.5! text-sm! leading-snug! text-(--ion-text-color-step-400)!">
							{{ t(hintKeys[pack]) }}
						</p>
						<p class="mt-1! text-xs! tabular-nums! text-(--ion-text-color-step-350)!">
							{{ sizeFor(pack) }}
						</p>

						<IonProgressBar
							v-if="progress?.pack === pack"
							color="primary"
							:type="progress.ratio === null ? 'indeterminate' : 'determinate'"
							:value="progress.ratio ?? 0"
							class="mt-2! h-1! rounded-full!"
						/>
					</IonLabel>

					<IonButton
						slot="end"
						size="small"
						:fill="packs[pack].installed ? 'clear' : 'outline'"
						:color="packs[pack].installed ? 'danger' : undefined"
						:disabled="busy !== null || (!packs[pack].installed && offline)"
						class="rounded-full! text-xs! font-semibold!"
						@click="packs[pack].installed ? onRemove(pack) : onDownload(pack)"
					>
						{{ actionLabel(pack) }}
					</IonButton>
				</IonItem>
			</IonList>

			<p class="px-6 pt-3 text-xs leading-relaxed text-(--ion-text-color-step-400)">
				{{ t('settings.packsHint') }}
			</p>

			<p
				v-if="totalBytes > 0"
				class="px-6 pt-1.5 pb-10 text-xs tabular-nums text-(--ion-text-color-step-350)"
			>
				{{ t('settings.onDisk') }}: {{ formatBytes(totalBytes) }}
			</p>
			<div
				v-else
				class="h-8"
			/>
		</IonContent>
	</IonPage>
</template>

<script setup lang="ts">
import type { DeviceTier } from '~/types/models';
import type { ModelPack } from '~/types/nudge';
import { MODEL_PACKS } from '~/types/nudge';
import { resolveColor, withAlpha } from '~/utils/color';
import { tierLabel } from '~/utils/tiers';

const { t } = useI18n();
const { settings, setValue } = useAppSettings();
const { packs, progress, busy, tier, totalBytes, stalePacks, sizeOf, download, remove, isStale } =
	useModels();
const { detectedTier, runBenchmark } = useCapability();
const { toast, confirm } = useNotify();

// one hue for the whole tier group, so the three rows read as a single control
const TIER_TOKEN = '@teal';

const labelKeys: Record<ModelPack, string> = {
	vision: 'settings.packVision',
	text: 'settings.packText',
	audio: 'settings.packAudio',
	writing: 'settings.packWriting'
};

const hintKeys: Record<ModelPack, string> = {
	vision: 'settings.packVisionHint',
	text: 'settings.packTextHint',
	audio: 'settings.packAudioHint',
	writing: 'settings.packWritingHint'
};

// mirrors onboarding/Models.vue so a pack keeps one identity across the app
const PACK_ICONS: Record<ModelPack, string> = {
	vision: 'mdi:camera-outline',
	text: 'mdi:pencil-outline',
	audio: 'mdi:microphone-outline',
	writing: 'mdi:message-text-outline'
};

const PACK_TOKENS: Record<ModelPack, string> = {
	vision: '@blue',
	text: '@purple',
	audio: '@coral',
	writing: '@green'
};

const overridden = computed(() => settings.value.tierOverride !== null);
const benchmarking = ref(false);

// re-wrapped locally: an auto-import used only in the template compiles to
// `_ctx.x`, which the post-transform import never fills in
const offline = computed(() => isOffline.value);
const cellular = computed(() => isCellular.value);

// #region sizes

/** null means "we could not look it up"; a made-up estimate is never shown */
const remoteSizes = ref<Partial<Record<ModelPack, number | null>>>({});

function formatBytes(bytes: number): string {
	if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
	if (bytes >= 1_048_576) return `${Math.round(bytes / 1_048_576)} MB`;
	if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${bytes} B`;
}

function sizeFor(pack: ModelPack): string {
	const installed = packs.value[pack];
	if (installed.installed && installed.bytes > 0) {
		return `${t('settings.onDisk')}: ${formatBytes(installed.bytes)}`;
	}

	const remote = remoteSizes.value[pack];
	return typeof remote === 'number' ? formatBytes(remote) : t('settings.sizeUnavailable');
}

async function loadSizes() {
	for (const pack of MODEL_PACKS) {
		remoteSizes.value = { ...remoteSizes.value, [pack]: await sizeOf(pack) };
	}
}

// #endregion

function actionLabel(pack: ModelPack): string {
	if (busy.value === pack) return t('settings.downloading');
	return packs.value[pack].installed ? t('settings.packDelete') : t('settings.packDownload');
}

async function step(direction: -1 | 1) {
	const next = Math.min(3, Math.max(1, tier.value + direction)) as DeviceTier;
	await setValue('tierOverride', next);
	await loadSizes();
}

async function useDetected() {
	await setValue('tierOverride', null);
	await loadSizes();
}

async function rerun() {
	benchmarking.value = true;
	try {
		const result = await runBenchmark();
		await toast(t('settings.benchmarkDone', { tier: tierLabel(result.tier) }));
		await loadSizes();
	} finally {
		benchmarking.value = false;
	}
}

async function onDownload(pack: ModelPack) {
	const gate = downloadGate();
	if (!gate.allowed) {
		await toast(t('settings.packOffline'));
		return;
	}

	if (gate.warn === 'cellular') {
		const ok = await confirm({
			title: t('settings.packOnCellular'),
			message: t('settings.cellularConfirm'),
			okText: t('settings.packDownload'),
			cancelText: t('common.cancel')
		});
		if (!ok) return;
	}

	const result = await download(pack);
	if (!result.ok) {
		await toast(
			result.reason === 'offline' ? t('settings.packOffline') : t('settings.downloadFailed')
		);
		return;
	}

	await toast(t('settings.packInstalled', { pack: t(labelKeys[pack]) }));
}

async function onRemove(pack: ModelPack) {
	await remove(pack);
	await toast(t('settings.packRemoved', { pack: t(labelKeys[pack]) }));
	await loadSizes();
}

onMounted(loadSizes);
</script>
