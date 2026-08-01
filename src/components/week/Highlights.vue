<template>
	<section class="flex flex-col gap-3">
		<h2 class="px-1 text-lg font-semibold">{{ t('week.highlightsTitle') }}</h2>

		<p
			v-if="cards.length === 0"
			class="px-1 text-sm text-(--ion-text-color-step-400)"
		>
			{{ t('week.noHighlights') }}
		</p>

		<article
			v-for="card in cards"
			:key="card.key"
			class="flex flex-col gap-2 rounded-2xl border border-(--ion-background-color-step-150) bg-(--ion-background-color-step-50) p-4"
		>
			<div
				class="flex items-center justify-between gap-2 text-[0.6875rem] font-semibold tracking-wide text-(--ion-text-color-step-400) uppercase"
			>
				<span>{{ card.category }}</span>
				<span>{{ card.day }}</span>
			</div>

			<p
				v-if="card.text"
				class="text-sm leading-relaxed text-pretty"
			>
				{{ card.text }}
			</p>

			<span
				v-if="card.count !== undefined"
				class="text-sm font-semibold tabular-nums"
			>
				{{ t('week.counted', { count: card.count }) }}
			</span>

			<img
				v-if="card.media?.kind === 'image'"
				:src="card.media.url"
				:alt="t('week.mediaLabel')"
				class="max-h-64 w-full rounded-xl border border-(--ion-background-color-step-150) object-cover"
			/>

			<audio
				v-else-if="card.media?.kind === 'audio'"
				:src="card.media.url"
				controls
				class="w-full!"
			/>
		</article>
	</section>
</template>

<script setup lang="ts">
import { playbackType } from '~/composables/useCapture';
import type { LedgerEntry } from '~/types/context';

const props = defineProps<{ entries: readonly LedgerEntry[] }>();

const { t, locale } = useI18n();

type MediaKind = 'image' | 'audio';

/**
 * `readMedia` hands back a generic octet-stream data url, so retyping it is what makes an `<img>` or
 * `<audio>` decode it at all. `playbackType` lives beside the table the surfaces write from, so a
 * format cannot be saved that this cannot play - two hand-kept lists drifted apart once already.
 */
function shapeOf(path: string): { kind: MediaKind; mime: string } | null {
	return playbackType(path.split('.').pop() ?? '');
}

const previews = ref<Record<string, { kind: MediaKind; url: string }>>({});

async function loadPreviews() {
	for (const entry of props.entries) {
		const path = entry.media;
		if (!path || previews.value[path]) continue;

		const shape = shapeOf(path);
		if (!shape) continue;

		const raw = await readMedia(path);
		if (!raw) continue;

		previews.value = {
			...previews.value,
			[path]: { kind: shape.kind, url: raw.replace('application/octet-stream', shape.mime) }
		};
	}
}

const dayFormat = computed(() => new Intl.DateTimeFormat(locale.value, { weekday: 'short' }));

const cards = computed(() =>
	props.entries.map((entry) => ({
		key: `${entry.id}:${entry.at}`,
		category: t(`nudge.category.${entry.category}`),
		day: dayFormat.value.format(new Date(entry.at)),
		text: entry.text,
		count: entry.count,
		media: (entry.media ? previews.value[entry.media] : undefined) ?? null
	}))
);

onMounted(loadPreviews);
watch(() => props.entries, loadPreviews);
</script>
