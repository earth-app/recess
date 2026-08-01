<template>
	<div class="flex min-h-full flex-col gap-6 px-5 py-10">
		<div class="flex flex-col items-center gap-3 text-center">
			<span
				class="flex size-16 items-center justify-center rounded-3xl"
				:style="{ background: withAlpha(ACCENT, 0.14) }"
			>
				<UIcon
					name="mdi:cellphone-check"
					class="text-3xl"
					:style="{ color: resolveColor(ACCENT) }"
				/>
			</span>

			<h1 class="font-title text-2xl font-semibold tracking-tight">
				{{ t('onboarding.modelsTitle') }}
			</h1>
			<p class="max-w-sm text-sm leading-relaxed opacity-70">{{ t('onboarding.modelsBody') }}</p>
			<p class="max-w-sm text-xs leading-relaxed opacity-55">
				{{ t('onboarding.modelsPrivate') }}
			</p>
		</div>

		<div class="flex items-center justify-center gap-2 text-xs">
			<template v-if="benchmarking">
				<IonSpinner
					name="crescent"
					color="medium"
					class="size-4!"
				/>
				<span class="opacity-60">{{ t('onboarding.modelsChecking') }}</span>
			</template>
			<template v-else>
				<span class="opacity-55">{{ t('settings.deviceTier') }}</span>
				<UBadge
					variant="soft"
					size="sm"
				>
					{{ tierLabel(detectedTier) }}
				</UBadge>
			</template>
		</div>

		<IonList
			:inset="true"
			class="m-0! rounded-3xl!"
		>
			<IonItem
				v-for="pack in MODEL_PACKS"
				:key="pack"
				lines="none"
			>
				<IonToggle
					color="primary"
					:checked="wanted.includes(pack)"
					:disabled="busy !== null || packs[pack].installed"
					@ion-change="togglePack(pack, $event)"
				>
					<span class="flex! flex-col! gap-0.5! py-0.5!">
						<span class="flex! items-center! gap-2! text-sm! font-semibold!">
							<UIcon :name="PACK_ICONS[pack]" />
							{{ t(PACK_LABELS[pack]) }}
						</span>
						<span class="text-xs! opacity-65!">{{ t(PACK_BODIES[pack]) }}</span>
						<span class="text-xs! tabular-nums! opacity-45!">{{ sizeLabel(pack) }}</span>
					</span>
				</IonToggle>
			</IonItem>
		</IonList>

		<div
			v-if="busy"
			class="flex flex-col gap-2"
		>
			<div class="flex items-center justify-between gap-3 text-xs">
				<span class="opacity-70">
					{{ t('onboarding.modelsDownloading', { pack: t(PACK_LABELS[busy]) }) }}
				</span>
				<span
					v-if="percent !== null"
					class="tabular-nums opacity-50"
				>
					{{ percent }}%
				</span>
			</div>
			<IonProgressBar
				color="primary"
				:type="ratio === null ? 'indeterminate' : 'determinate'"
				:value="ratio ?? 0"
				class="h-1! rounded-full!"
			/>
		</div>

		<div
			class="sticky bottom-0 mt-auto flex flex-col gap-3 border-t border-(--ion-background-color-step-100) bg-(--ion-background-color) pt-3 pb-1"
		>
			<p
				v-if="totalLabel && !busy && !finished"
				class="text-center text-xs opacity-55"
			>
				{{ t('onboarding.modelsTotal', { size: totalLabel }) }}
			</p>

			<template v-if="finished">
				<p class="flex items-center justify-center gap-1.5 text-xs opacity-60">
					<UIcon name="mdi:check-circle-outline" />
					{{ t('settings.packDownloaded') }}
				</p>
				<IonButton
					expand="block"
					class="h-12! rounded-full! text-base! font-semibold!"
					@click="emit('complete')"
				>
					{{ t('onboarding.finish') }}
				</IonButton>
			</template>

			<template v-else>
				<IonButton
					expand="block"
					:disabled="busy !== null || offline || wanted.length === 0"
					class="h-12! rounded-full! text-base! font-semibold!"
					@click="startDownload"
				>
					{{ t('onboarding.modelsDownload') }}
				</IonButton>

				<IonButton
					expand="block"
					fill="outline"
					color="medium"
					:disabled="busy !== null"
					class="h-12! rounded-full! text-base! font-semibold!"
					@click="notNow"
				>
					{{ t('onboarding.modelsSkip') }}
				</IonButton>

				<p class="text-center text-xs leading-relaxed opacity-55">
					{{ t('onboarding.modelsSkipBody') }}
				</p>

				<p
					v-if="offline"
					class="text-center text-xs opacity-60"
				>
					{{ t('settings.packOffline') }}
				</p>
				<p
					v-else-if="cellular"
					class="text-center text-xs opacity-60"
				>
					{{ t('settings.packOnCellular') }}
				</p>
			</template>
		</div>
	</div>
</template>

<script setup lang="ts">
import type { ModelPack } from '~/types/nudge';
import { MODEL_PACKS } from '~/types/nudge';
import { resolveColor, withAlpha } from '~/utils/color';
import { tierLabel } from '~/utils/tiers';

const emit = defineEmits<{ complete: [] }>();

const { t } = useI18n();
const { init } = useAppSettings();
const { skipModels } = useOnboarding();
const { runBenchmark, detectedTier } = useCapability();
const { packs, progress, busy, sizeOf, download } = useModels();
const { toast, confirm } = useNotify();
const haptics = useHaptics();

const ACCENT = '@teal';

const PACK_LABELS: Record<ModelPack, string> = {
	vision: 'settings.packVision',
	text: 'settings.packText',
	audio: 'settings.packAudio',
	writing: 'settings.packWriting'
};

const PACK_BODIES: Record<ModelPack, string> = {
	vision: 'onboarding.packVisionBody',
	text: 'onboarding.packTextBody',
	audio: 'onboarding.packAudioBody',
	writing: 'onboarding.packWritingBody'
};

const PACK_ICONS: Record<ModelPack, string> = {
	vision: 'mdi:camera-outline',
	text: 'mdi:pencil-outline',
	audio: 'mdi:microphone-outline',
	writing: 'mdi:message-text-outline'
};

const benchmarking = ref(true);
const finished = ref(false);
const wanted = ref<ModelPack[]>([...MODEL_PACKS]);
const sizes = ref<Partial<Record<ModelPack, number | null>>>({});

// referenced here rather than straight from the template so the auto-import lands
const offline = computed(() => isOffline.value);
const cellular = computed(() => isCellular.value);

const ratio = computed(() => progress.value?.ratio ?? null);
const percent = computed(() => (ratio.value === null ? null : Math.round(ratio.value * 100)));

/** decimal MB/GB, straight from the hub listing; never an estimate */
function formatBytes(bytes: number): string {
	if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
	if (bytes >= 1_000_000) return `${Math.round(bytes / 1_000_000)} MB`;
	return `${Math.max(1, Math.round(bytes / 1_000))} KB`;
}

function sizeLabel(pack: ModelPack): string {
	if (packs.value[pack].installed) return t('settings.packDownloaded');

	const size = sizes.value[pack];
	if (size === undefined) return t('common.loading');
	// a made up "~50 MB" would read as real, so an unknown size says so plainly
	return size === null ? t('onboarding.sizeUnavailable') : formatBytes(size);
}

const pending = computed(() => wanted.value.filter((pack) => !packs.value[pack].installed));

const totalLabel = computed(() => {
	if (pending.value.length === 0) return null;

	let total = 0;
	for (const pack of pending.value) {
		const size = sizes.value[pack];
		if (typeof size !== 'number') return null;
		total += size;
	}
	return formatBytes(total);
});

function togglePack(pack: ModelPack, event: CustomEvent) {
	const checked = (event.detail as { checked?: boolean } | undefined)?.checked === true;
	wanted.value = checked
		? [...new Set([...wanted.value, pack])]
		: wanted.value.filter((entry) => entry !== pack);
}

async function loadSizes() {
	const entries = await Promise.all(
		MODEL_PACKS.map(async (pack) => [pack, await sizeOf(pack)] as const)
	);
	sizes.value = Object.fromEntries(entries) as Record<ModelPack, number | null>;
}

async function startDownload() {
	const gate = downloadGate();
	if (!gate.allowed) {
		await toast(t('settings.packOffline'));
		return;
	}

	if (gate.warn === 'cellular') {
		const proceed = await confirm({
			title: t('settings.packOnCellular'),
			message: t('onboarding.cellularWarn'),
			okText: t('onboarding.modelsDownload'),
			cancelText: t('common.cancel')
		});
		if (!proceed) return;
	}

	let failed = 0;
	for (const pack of pending.value) {
		const result = await download(pack);
		if (!result.ok) failed++;
	}

	if (failed > 0) {
		haptics.warning();
		await toast(t('onboarding.modelsFailed'));
		return;
	}

	haptics.success();
	finished.value = true;
}

/**
 * Skipping the packs is the one onboarding choice with a lasting consequence -
 * every photo, text and audio nudge drops to self-attestation - so it asks first.
 * The confirm names what changes rather than warning in the abstract.
 */
async function notNow() {
	const proceed = await confirm({
		title: t('onboarding.modelsSkipConfirmTitle'),
		message: t('onboarding.modelsSkipConfirmBody'),
		okText: t('onboarding.modelsSkipConfirmOk'),
		cancelText: t('onboarding.modelsSkipConfirmCancel')
	});
	if (!proceed) return;

	await skipModels();
	emit('complete');
}

onMounted(async () => {
	await init();

	try {
		await runBenchmark();
	} catch {
		// a failed benchmark leaves tier 1, which is the safe default anyway
	}
	benchmarking.value = false;

	// what a pack costs depends on the tier, so sizes wait for the benchmark
	wanted.value = MODEL_PACKS.filter((pack) => !packs.value[pack].installed);
	finished.value = wanted.value.length === 0;
	await loadSizes();
});
</script>
