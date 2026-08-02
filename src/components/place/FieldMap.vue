<template>
	<div class="relative w-full">
		<canvas
			ref="canvas"
			role="img"
			:aria-label="label"
			class="block w-full rounded-3xl"
			:style="{ aspectRatio: '1 / 1' }"
			@click="onTap"
		/>

		<ul class="sr-only">
			<li
				v-for="entry in places"
				:key="entry.place.id"
			>
				{{ describe(entry) }}
			</li>
		</ul>
	</div>
</template>

<script setup lang="ts">
import type { Season, TimeOfDay } from '~/types/nudge';
import { AFFORDANCE_COLORS } from '~/types/places';
import { resolveColor } from '~/utils/color';
import type { NearbyPlace } from '~/utils/places';
import { cellKey } from '~/utils/places';
import { deriveTraits, scenePalette } from '~/utils/playground';

/**
 * A map with no basemap.
 *
 * Bearing and range around you, drawn in the same palette family your Playground uses, rather
 * than a tile map with pins. Two reasons it is built this way: a stock pin map makes recess read
 * as a directory, which is the register the whole app is built against; and a real basemap would
 * mean hosting 20-60 MB of tiles per city, where this needs none at all and works the moment a
 * pack is on disk.
 *
 * It deliberately cannot route you. It answers "what is around me and which way", and the walk is
 * yours to work out.
 */
const props = withDefaults(
	defineProps<{
		places: readonly NearbyPlace[];
		radius: number;
		selectedId?: string | null;
		/** grid cells the user has already resolved a nudge in */
		visited?: ReadonlySet<string>;
		installSeed?: string;
		timeOfDay?: TimeOfDay;
		season?: Season;
	}>(),
	{
		selectedId: null,
		visited: () => new Set<string>(),
		installSeed: '',
		timeOfDay: 'day',
		season: 'summer'
	}
);

const emit = defineEmits<{ select: [id: string] }>();

const { t } = useI18n();
const canvas = ref<HTMLCanvasElement | null>(null);

const palette = computed(() =>
	scenePalette({
		traits: deriveTraits(props.installSeed || 'recess'),
		timeOfDay: props.timeOfDay,
		season: props.season
	})
);

/** walk-time rings, in minutes; the outermost is whatever radius is showing */
const RING_MINUTES = [5, 10, 20];

function describe(entry: NearbyPlace): string {
	const name = entry.place.n ?? t('outThere.unnamed');
	const direction = t(`outThere.compass.${entry.compass}`);
	const walk = t('outThere.walkMinutes', { count: Math.max(1, Math.round(entry.minutes)) });
	const seen = props.visited.has(cellKey(entry.place.lat, entry.place.lon))
		? ` ${t('outThere.resolvedHere')}`
		: '';
	return `${name}, ${Math.round(entry.metres)} m ${direction}, ${walk}${seen}`;
}

const label = computed(() =>
	props.places.length === 0
		? t('outThere.nothingNearby', { minutes: Math.round(props.radius / 84) })
		: `${t('outThere.placeCount', { count: props.places.length }, props.places.length)}. ${props.places
				.slice(0, 8)
				.map(describe)
				.join('. ')}`
);

/** screen position for a place, with distance scaled linearly to the drawn radius */
function project(entry: NearbyPlace, centre: number, drawRadius: number) {
	const scaled = Math.min(1, entry.metres / props.radius) * drawRadius;
	const radians = ((entry.bearing - 90) * Math.PI) / 180;
	return { x: centre + Math.cos(radians) * scaled, y: centre + Math.sin(radians) * scaled };
}

function draw() {
	const element = canvas.value;
	if (!element) return;

	const ratio = Math.min(3, globalThis.devicePixelRatio || 1);
	const size = element.clientWidth;
	if (size === 0) return;

	element.width = Math.round(size * ratio);
	element.height = Math.round(size * ratio);

	const context = element.getContext('2d');
	if (!context) return;

	context.setTransform(ratio, 0, 0, ratio, 0, 0);
	context.clearRect(0, 0, size, size);

	const centre = size / 2;
	const drawRadius = size / 2 - 14;
	const ink = palette.value;

	const wash = context.createRadialGradient(centre, centre, 0, centre, centre, drawRadius);
	wash.addColorStop(0, ink.skyBottom);
	wash.addColorStop(1, ink.skyTop);
	context.fillStyle = wash;
	context.beginPath();
	context.arc(centre, centre, drawRadius, 0, Math.PI * 2);
	context.fill();

	// walk-time rings, only the ones that fit inside the current radius
	context.strokeStyle = ink.groundShadow;
	context.globalAlpha = 0.35;
	context.lineWidth = 1;
	for (const minutes of RING_MINUTES) {
		const metres = minutes * 84;
		if (metres > props.radius) continue;
		context.beginPath();
		context.arc(centre, centre, (metres / props.radius) * drawRadius, 0, Math.PI * 2);
		context.stroke();
	}
	context.globalAlpha = 1;

	for (const entry of props.places) {
		const { x, y } = project(entry, centre, drawRadius);
		const primary = entry.place.a[0];
		const colour = resolveColor(primary ? AFFORDANCE_COLORS[primary] : '@gray');
		const selected = entry.place.id === props.selectedId;

		/**
		 * Warm Ground. A cell you have resolved something in is drawn hollow; one you have not is
		 * filled. It says "you have not done anything here", which the ledger really knows - NOT
		 * "you have never been here", which recess cannot know and must not imply.
		 */
		const seen = props.visited.has(cellKey(entry.place.lat, entry.place.lon));

		context.beginPath();
		context.arc(x, y, selected ? 7 : 4.5, 0, Math.PI * 2);
		if (seen) {
			context.strokeStyle = colour;
			context.lineWidth = 1.5;
			context.stroke();
		} else {
			context.fillStyle = colour;
			context.fill();
		}

		if (selected) {
			context.beginPath();
			context.arc(x, y, 11, 0, Math.PI * 2);
			context.strokeStyle = colour;
			context.lineWidth = 2;
			context.stroke();
		}
	}

	// you, last, so nothing is drawn over it
	context.beginPath();
	context.arc(centre, centre, 5, 0, Math.PI * 2);
	context.fillStyle = ink.light;
	context.fill();
	context.strokeStyle = ink.groundShadow;
	context.lineWidth = 2;
	context.stroke();
}

function onTap(event: MouseEvent) {
	const element = canvas.value;
	if (!element) return;

	const box = element.getBoundingClientRect();
	const size = box.width;
	const centre = size / 2;
	const drawRadius = size / 2 - 14;
	const x = event.clientX - box.left;
	const y = event.clientY - box.top;

	let bestId: string | null = null;
	let bestDistance = 24;
	for (const entry of props.places) {
		const point = project(entry, centre, drawRadius);
		const distance = Math.hypot(point.x - x, point.y - y);
		if (distance < bestDistance) {
			bestDistance = distance;
			bestId = entry.place.id;
		}
	}

	if (bestId) emit('select', bestId);
}

let observer: ResizeObserver | null = null;

onMounted(() => {
	draw();
	if (typeof ResizeObserver !== 'undefined' && canvas.value) {
		observer = new ResizeObserver(() => draw());
		observer.observe(canvas.value);
	}
});

onBeforeUnmount(() => {
	observer?.disconnect();
	observer = null;
});

watch(() => [props.places, props.radius, props.selectedId, palette.value], draw, { deep: true });
</script>
