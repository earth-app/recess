<template>
	<IonModal
		:is-open="open"
		:breakpoints="[0, 0.8]"
		:initial-breakpoint="0.8"
		@did-dismiss="emit('close')"
	>
		<IonHeader>
			<IonToolbar>
				<IonTitle>{{ t('playground.export.title') }}</IonTitle>
				<IonButtons slot="end">
					<IonButton
						:disabled="busy"
						@click="emit('close')"
					>
						{{ t('common.cancel') }}
					</IonButton>
				</IonButtons>
			</IonToolbar>
		</IonHeader>

		<IonContent>
			<div class="flex flex-col gap-4 px-4 pt-4 pb-8">
				<IonSegment
					:value="format"
					@ion-change="onFormat(String($event.detail.value ?? ''))"
				>
					<IonSegmentButton
						v-for="option in PLAYGROUND_EXPORT_FORMATS"
						:key="option"
						:value="option"
					>
						<IonLabel>{{ option.toUpperCase() }}</IonLabel>
					</IonSegmentButton>
				</IonSegment>

				<p class="text-sm text-(--ion-text-color-step-350)">
					{{ t(`playground.export.hint.${format}`) }}
				</p>

				<IonList
					:inset="true"
					class="mx-0! mt-0! rounded-2xl!"
				>
					<IonItem
						v-for="(size, index) in sizes"
						:key="size.key"
						button
						:detail="false"
						:lines="index === sizes.length - 1 ? 'none' : 'full'"
						@click="selected = size.key"
					>
						<UIcon
							slot="start"
							:name="size.key === selected ? 'mdi:radiobox-marked' : 'mdi:radiobox-blank'"
							class="text-xl!"
							:class="
								size.key === selected
									? 'text-(--ion-color-primary)!'
									: 'text-(--ion-text-color-step-550)!'
							"
						/>
						<IonLabel>
							<h3 class="text-sm! font-semibold!">{{ size.label }}</h3>
							<p class="text-xs!">{{ size.detail }}</p>
						</IonLabel>
					</IonItem>
				</IonList>

				<IonButton
					expand="block"
					color="primary"
					:disabled="busy"
					class="rounded-full! font-semibold!"
					@click="onSave"
				>
					<IonSpinner
						v-if="busy"
						slot="start"
						name="crescent"
					/>
					{{ busy ? t('playground.export.working') : saveLabel }}
				</IonButton>
			</div>
		</IonContent>
	</IonModal>
</template>

<script setup lang="ts">
import { Capacitor } from '@capacitor/core';
import { dayKey } from '~/utils/day';
import type { ExportTarget, PlaygroundExportFormat, SceneBox } from '~/utils/playground';
import {
	PLAYGROUND_EXPORT_FORMATS,
	playgroundFileName,
	RESOLUTION_PRESETS,
	resolutionTarget,
	SOCIAL_PRESETS,
	socialTarget
} from '~/utils/playground';

const props = defineProps<{
	open: boolean;
	/** the on-screen scene box, so a resolution preset scales from what the user saw */
	box: SceneBox;
	render: (format: PlaygroundExportFormat, scale: number, frame: SceneBox | null) => Promise<Blob>;
}>();

const emit = defineEmits<{ close: [] }>();

const { t } = useI18n();
const { toast } = useNotify();

const format = ref<PlaygroundExportFormat>('png');
const selected = ref('resolution:original');
const busy = ref(false);

interface SizeOption {
	key: string;
	label: string;
	detail: string;
	target: ExportTarget;
	/** social frames re-lay the scene out; resolution presets keep the on-screen box */
	frame: SceneBox | null;
}

const native = computed(() => Capacitor.isNativePlatform());

const saveLabel = computed(() =>
	native.value ? t('playground.export.share') : t('playground.export.save')
);

const sizes = computed<SizeOption[]>(() => {
	const out: SizeOption[] = [];

	// a vector file has no resolution to pick, so only the frame shape is offered
	const resolutions = format.value === 'svg' ? RESOLUTION_PRESETS.slice(0, 1) : RESOLUTION_PRESETS;
	for (const preset of resolutions) {
		const target = resolutionTarget(props.box, preset.edge);
		out.push({
			key: `resolution:${preset.id}`,
			label: t(`playground.export.res.${preset.id}`),
			detail:
				format.value === 'svg'
					? t('playground.export.vector', { width: target.width, height: target.height })
					: `${target.width} x ${target.height}`,
			target,
			frame: null
		});
	}

	for (const preset of SOCIAL_PRESETS) {
		const target = socialTarget(preset);
		out.push({
			key: `social:${preset.id}`,
			label: t(`playground.export.social.${preset.id}`),
			detail: `${target.width} x ${target.height}`,
			target,
			frame: { width: target.sceneWidth, height: target.sceneHeight }
		});
	}

	return out;
});

const active = computed(
	() => sizes.value.find((size) => size.key === selected.value) ?? sizes.value[0] ?? null
);

function onFormat(value: string) {
	if ((PLAYGROUND_EXPORT_FORMATS as readonly string[]).includes(value)) {
		format.value = value as PlaygroundExportFormat;
	}
}

function blobToBase64(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onerror = () => reject(new Error('Could not read the rendered image.'));
		reader.onload = () => {
			const result = String(reader.result ?? '');
			resolve(result.slice(result.indexOf(',') + 1));
		};
		reader.readAsDataURL(blob);
	});
}

async function shareNative(blob: Blob, name: string) {
	const { Directory, Filesystem } = await import('@capacitor/filesystem');
	const written = await Filesystem.writeFile({
		path: name,
		data: await blobToBase64(blob),
		directory: Directory.Cache
	});

	const { Share } = await import('@capacitor/share');
	await Share.share({ title: t('playground.export.shareTitle'), url: written.uri });
}

function downloadInBrowser(blob: Blob, name: string) {
	if (typeof document === 'undefined') return;

	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = name;
	link.style.display = 'none';
	document.body.append(link);
	link.click();
	link.remove();
	URL.revokeObjectURL(url);
}

async function onSave() {
	const size = active.value;
	if (!size || busy.value) return;

	busy.value = true;
	try {
		const blob = await props.render(format.value, size.target.scale, size.frame);
		const name = playgroundFileName(format.value, dayKey());
		if (native.value) await shareNative(blob, name);
		else {
			downloadInBrowser(blob, name);
			await toast(t('playground.export.saved'));
		}
		emit('close');
	} catch {
		await toast(t('playground.export.failed'));
	} finally {
		busy.value = false;
	}
}

// a format change can drop the selected option off the list
watch(sizes, (next) => {
	if (!next.some((size) => size.key === selected.value)) {
		selected.value = next[0]?.key ?? 'resolution:original';
	}
});
</script>
