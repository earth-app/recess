<template>
	<div
		ref="root"
		class="relative w-full touch-manipulation overflow-hidden"
		:class="{ 'cursor-pointer': interactive }"
		:style="{ height: `${height}px`, background: backdrop }"
		@pointerdown="onPointerDown"
	>
		<canvas
			ref="surface"
			class="block h-full w-full"
			role="img"
			:aria-label="ariaLabel"
		/>
	</div>
</template>

<script setup lang="ts">
import type { PlaygroundExportFormat, PlaygroundScene, SceneBox } from '~/utils/playground';
import { clampExportScale, EXPORT_MIME, JPG_QUALITY, scenePalette } from '~/utils/playground';
import type { SceneLayout, SceneMotion } from '~/utils/playground-render';
import {
	hitTest,
	layoutScene,
	OPEN_MS,
	paintShapes,
	RIPPLE_MS,
	sceneShapes,
	sceneToSvg,
	SETTLED_MOTION,
	STARTLE_MS
} from '~/utils/playground-render';

const props = withDefaults(
	defineProps<{
		scene: PlaygroundScene;
		height?: number;
		interactive?: boolean;
	}>(),
	{ height: 320, interactive: true }
);

const { t } = useI18n();

const root = ref<HTMLElement | null>(null);
const surface = ref<HTMLCanvasElement | null>(null);
const reduced = ref(true);

const backdrop = computed(() => {
	const palette = scenePalette(props.scene);
	const stop = Math.round(props.scene.traits.horizon * 100);
	return `linear-gradient(180deg, ${palette.skyTop} 0%, ${palette.skyBottom} ${stop}%, ${palette.ground} ${stop}%)`;
});

const ariaLabel = computed(() => {
	const count = props.scene.elements.length;
	const time = t(`playground.atTime.${props.scene.timeOfDay}`);
	const season = t(`playground.inSeason.${props.scene.season}`);
	return count === 0
		? t('playground.sceneLabelEmpty', { time, season })
		: t('playground.sceneLabel', { count, time, season }, count);
});

// #region render state

let ctx: CanvasRenderingContext2D | null = null;
let dpr = 1;
let cssW = 0;
let cssH = 0;
let layout: SceneLayout | null = null;
let raf = 0;
let startTime = 0;
let lastFrame = 0;

let ripples: { x: number; y: number; start: number }[] = [];
const startled = new Map<string, number>();
const opened = new Map<string, number>();

function easeOut(k: number): number {
	return 1 - (1 - k) ** 3;
}

function motionFor(time: number): SceneMotion {
	// reduced motion still carries `opened`, so a tapped flower latches open instead of
	// the tap doing nothing at all
	if (reduced.value) return { ...SETTLED_MOTION, opened };
	return {
		time,
		bloom: easeOut(Math.min(1, time / 900)),
		animate: true,
		startled,
		opened,
		ripples
	};
}

function relayout() {
	const host = root.value;
	const canvas = surface.value;
	if (!host || !canvas) return;

	cssW = host.clientWidth || 320;
	cssH = host.clientHeight || props.height;
	dpr = Math.min(2, window.devicePixelRatio || 1);
	canvas.width = Math.round(cssW * dpr);
	canvas.height = Math.round(cssH * dpr);
	ctx = canvas.getContext('2d');
	if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

	layout = layoutScene(props.scene, { width: cssW, height: cssH });
}

function draw(now: number) {
	const c = ctx;
	if (!c || !layout) return;
	if (!startTime) startTime = now;
	const time = now - startTime;

	c.clearRect(0, 0, cssW, cssH);
	paintShapes(c, sceneShapes(props.scene, layout, motionFor(time)));

	if (!reduced.value) {
		ripples = ripples.filter((ripple) => time - ripple.start < RIPPLE_MS);
		for (const [key, at] of startled) if (time - at > STARTLE_MS) startled.delete(key);
		for (const [key, at] of opened) if (time - at > OPEN_MS) opened.delete(key);
	}
}

function frame(now: number) {
	raf = requestAnimationFrame(frame);
	// 30fps is plenty for an idle scene and halves the work on a phone
	if (now - lastFrame < 30) return;
	lastFrame = now;
	draw(now);
}

function prefersStill(): boolean {
	if (!import.meta.client) return true;
	const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
	return (
		(query?.matches ?? false) || document.documentElement.classList.contains('animations-disabled')
	);
}

function restart() {
	reduced.value = prefersStill();
	relayout();
	if (!ctx) return;
	cancelAnimationFrame(raf);
	startTime = 0;
	lastFrame = 0;
	if (reduced.value) draw(performance.now());
	else raf = requestAnimationFrame(frame);
}

/** new size, same scene; the running loop picks the geometry up on its own */
function refresh() {
	relayout();
	if (ctx && reduced.value) draw(performance.now());
}

// #endregion

// #region export

function sceneBox(): SceneBox {
	return { width: cssW || props.height, height: cssH || props.height };
}

/**
 * One settled frame, rendered offscreen at the target size.
 *
 * A fresh canvas rather than an upscale of the on-screen one: upscaling a
 * device-pixel bitmap is what made the old static exports blurry. `frame` re-lays the
 * scene out in a different box (a social aspect), `scale` multiplies the on-screen box.
 */
async function exportBlob(
	format: PlaygroundExportFormat,
	scale = 1,
	frame: SceneBox | null = null
): Promise<Blob> {
	if (!import.meta.client) throw new Error('The playground can only be exported in a browser.');

	const box = frame ?? sceneBox();
	const width = Math.max(1, Math.round(box.width));
	const height = Math.max(1, Math.round(box.height));

	if (format === 'svg') {
		const svg = sceneToSvg(props.scene, { width, height, title: ariaLabel.value });
		return new Blob([svg], { type: EXPORT_MIME.svg });
	}

	const s = clampExportScale(scale);
	const off = document.createElement('canvas');
	off.width = Math.max(1, Math.round(width * s));
	off.height = Math.max(1, Math.round(height * s));
	const octx = off.getContext('2d');
	if (!octx) throw new Error('Could not create an export canvas.');

	octx.setTransform(s, 0, 0, s, 0, 0);
	paintShapes(
		octx,
		sceneShapes(props.scene, layoutScene(props.scene, { width, height }), SETTLED_MOTION)
	);

	return await new Promise<Blob>((resolve, reject) => {
		off.toBlob(
			(blob) => (blob ? resolve(blob) : reject(new Error('Export encoding failed.'))),
			EXPORT_MIME[format],
			format === 'jpg' ? JPG_QUALITY : undefined
		);
	});
}

defineExpose({ exportBlob, sceneBox });

// #endregion

// #region interaction

function onPointerDown(event: PointerEvent) {
	if (!props.interactive || !root.value || !ctx || !layout) return;

	const rect = root.value.getBoundingClientRect();
	const x = event.clientX - rect.left;
	const y = event.clientY - rect.top;
	const time = startTime ? performance.now() - startTime : 0;

	const hit = hitTest(layout, x, y);
	// a startle only resolves over time, so it needs the loop; nothing expires it under
	// reduced motion and the bird would hang mid-air
	if (hit && hit.species === 'bird' && !reduced.value) startled.set(hit.key, time);
	else if (hit && (hit.species === 'flower' || hit.species === 'sprout')) opened.set(hit.key, time);
	else if (!reduced.value) ripples.push({ x, y, start: time });
	if (ripples.length > 5) ripples.shift();

	// nothing redraws under reduced motion, so the tap paints its own single frame
	if (reduced.value) draw(performance.now());
}

// #endregion

onMounted(() => restart());

useResizeObserver(root, () => refresh());

watch(
	() => props.scene,
	() => {
		startled.clear();
		opened.clear();
		ripples = [];
		restart();
	}
);

watch(
	() => props.height,
	() => refresh()
);

onBeforeUnmount(() => cancelAnimationFrame(raf));
</script>
