<template>
	<div class="flex flex-col gap-3">
		<UAlert
			color="neutral"
			variant="subtle"
			icon="mdi:barcode-scan"
			:title="t('validation.barcodeKind', { kind: kindLabel })"
			:description="t('validation.barcodeStructural')"
		/>

		<UAlert
			v-if="!native"
			color="warning"
			variant="subtle"
			icon="mdi:cellphone-off"
			:title="t('validation.unavailableTitle')"
			:description="t('validation.scannerUnavailable')"
		/>

		<UAlert
			v-if="denied"
			color="error"
			variant="subtle"
			icon="mdi:camera-off-outline"
			:title="t('permissions.cameraTitle')"
			:description="t('permissions.cameraBody')"
		/>

		<div
			v-if="scan"
			class="flex flex-col gap-1 rounded-2xl px-4 py-3"
			:style="wellStyle"
		>
			<span class="text-xs opacity-60">{{ t('validation.scanned') }}</span>
			<span class="font-mono text-lg font-semibold wrap-break-word">{{ scan.data }}</span>
		</div>

		<IonButton
			v-if="native"
			expand="block"
			:fill="scan ? 'outline' : undefined"
			:color="scan ? 'medium' : undefined"
			:disabled="busy"
			:style="scan ? undefined : accent"
			class="m-0! h-12! rounded-full! text-base! font-semibold! normal-case!"
			@click="capture"
		>
			{{ t('validation.barcodeScan') }}
		</IonButton>

		<IonButton
			v-if="scan"
			expand="block"
			:disabled="busy"
			:style="accent"
			class="m-0! h-12! rounded-full! text-base! font-semibold! normal-case!"
			@click="submit"
		>
			<IonSpinner
				v-if="busy"
				name="crescent"
				class="mr-2! h-4! w-4!"
			/>
			{{ t('validation.submit') }}
		</IonButton>

		<IonButton
			v-if="!native || denied"
			expand="block"
			fill="clear"
			color="medium"
			:disabled="busy"
			class="m-0! text-sm! font-semibold! normal-case!"
			@click="attest"
		>
			{{ t('validation.selfAttest') }}
		</IonButton>
	</div>
</template>

<script setup lang="ts">
import { Capacitor } from '@capacitor/core';
import { scanBarcode } from '~/composables/useCapture';
import type { ResolveInput, ResolveResult } from '~/composables/useResolve';
import type { BarcodeValidationData, Nudge } from '~/types/nudge';
import type { BarcodeScan } from '~/utils/barcode';
import type { Submission, Verdict } from '~/utils/validate';

const props = defineProps<{
	nudge: Nudge;
	data: BarcodeValidationData;
	run: (nudge: Nudge, submission: Submission) => Promise<Verdict>;
}>();

const emit = defineEmits<{
	verdict: [Verdict, Pick<ResolveInput, 'text' | 'count' | 'media'>];
	resolved: [ResolveResult];
}>();

const { t } = useI18n();
const { resolve } = useResolve();
const { require: requirePermission } = usePermissions();

const native = Capacitor.isNativePlatform();

const scan = ref<BarcodeScan | null>(null);
const denied = ref(false);
const busy = ref(false);

const accent: Record<string, string> = {
	'--background': 'var(--nudge-accent)',
	'--color': 'var(--nudge-on-accent)'
};
const wellStyle: Record<string, string> = { background: 'var(--nudge-accent-soft)' };

const kindLabel = computed(() => t(`validation.barcodeKinds.${props.data.kind}`));

async function capture() {
	if (busy.value) return;
	busy.value = true;

	try {
		if (!(await requirePermission('camera'))) {
			denied.value = true;
			return;
		}

		denied.value = false;
		const result = await scanBarcode();
		// a cancelled scanner is not a failure worth reporting
		if (!result) return;

		scan.value = result;
	} finally {
		busy.value = false;
	}
}

async function submit() {
	const scanned = scan.value;
	if (busy.value || !scanned) return;
	busy.value = true;

	try {
		const verdict = await props.run(props.nudge, { kind: 'barcode', scan: scanned });
		emit('verdict', verdict, {});
		if (verdict.status !== 'passed') return;

		emit('resolved', await resolve({ nudge: props.nudge, outcome: 'passed', verdict }));
	} finally {
		busy.value = false;
	}
}

async function attest() {
	if (busy.value) return;
	busy.value = true;

	try {
		emit('resolved', await resolve({ nudge: props.nudge, outcome: 'self_attested' }));
	} finally {
		busy.value = false;
	}
}
</script>
