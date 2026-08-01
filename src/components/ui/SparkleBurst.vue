<template>
	<ClientOnly>
		<canvas
			v-if="active"
			ref="canvasRef"
			class="pointer-events-none absolute inset-0 h-full w-full"
			aria-hidden="true"
		/>
	</ClientOnly>
</template>

<script setup lang="ts">
type Palette = 'recess' | 'green' | 'blue' | 'yellow' | 'purple' | 'coral';

const props = withDefaults(
	defineProps<{
		trigger: number;
		color?: Palette;
		count?: number;
		duration?: number;
	}>(),
	{ color: 'recess', count: 28, duration: 900 }
);

// every hex is a --color-recess-* value from main.css; keep the two in step
const PALETTES: Record<Palette, readonly [string, ...string[]]> = {
	recess: ['#2d9973', '#3498db', '#f1c40f', '#9b59b6', '#ff7f6b'],
	green: ['#2d9973', '#8bc34a', '#17a2a2'],
	blue: ['#3498db', '#5b6ee1', '#17a2a2'],
	yellow: ['#f1c40f', '#ffb300', '#ffd700'],
	purple: ['#9b59b6', '#5b6ee1', '#e91e63'],
	coral: ['#ff7f6b', '#e74c3c', '#ffb300']
};

interface Particle {
	x: number;
	y: number;
	vx: number;
	vy: number;
	size: number;
	color: string;
	life: number;
}

const canvasRef = ref<HTMLCanvasElement | null>(null);
const active = ref(false);

const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
const settings = useAppSettingsState();
const motionOk = computed(() => !prefersReducedMotion.value && settings.value.animations);

let raf = 0;

function stop() {
	if (raf) cancelAnimationFrame(raf);
	raf = 0;
}

watch(
	() => props.trigger,
	async (value, prev) => {
		if (value === prev) return;
		if (!import.meta.client || !motionOk.value) return;
		active.value = true;
		await nextTick();
		runBurst();
	}
);

function runBurst() {
	const canvas = canvasRef.value;
	const parent = canvas?.parentElement;
	if (!canvas || !parent) return;

	const w = parent.clientWidth;
	const h = parent.clientHeight;
	// a zero-size host means the burst would be invisible anyway
	if (w <= 0 || h <= 0) {
		active.value = false;
		return;
	}

	const dpr = Math.min(2, window.devicePixelRatio || 1);
	canvas.width = Math.round(w * dpr);
	canvas.height = Math.round(h * dpr);
	canvas.style.width = `${w}px`;
	canvas.style.height = `${h}px`;
	const ctx = canvas.getContext('2d');
	if (!ctx) return;
	ctx.scale(dpr, dpr);

	const palette = PALETTES[props.color] ?? PALETTES.recess;
	const cx = w / 2;
	const cy = h / 2;
	const cap = Math.min(60, Math.max(8, Math.round(props.count)));
	const span = Math.max(1, props.duration);
	const particles: Particle[] = [];
	for (let i = 0; i < cap; i++) {
		const angle = Math.random() * Math.PI * 2;
		const speed = 1.2 + Math.random() * 3.2;
		particles.push({
			x: cx,
			y: cy,
			vx: Math.cos(angle) * speed,
			vy: Math.sin(angle) * speed,
			size: 2 + Math.random() * 3,
			color: palette[Math.floor(Math.random() * palette.length)] ?? palette[0],
			life: 1
		});
	}

	stop();
	const start = performance.now();
	const draw = (now: number) => {
		ctx.clearRect(0, 0, w, h);
		const elapsed = now - start;
		const t = Math.min(1, elapsed / span);
		for (const p of particles) {
			p.x += p.vx;
			p.y += p.vy;
			p.vy += 0.05;
			p.life = 1 - t;
			if (p.life <= 0) continue;
			ctx.save();
			ctx.globalAlpha = p.life;
			ctx.fillStyle = p.color;
			ctx.beginPath();
			ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
			ctx.fill();
			ctx.restore();
		}
		if (elapsed < span) {
			raf = requestAnimationFrame(draw);
		} else {
			ctx.clearRect(0, 0, w, h);
			stop();
			active.value = false;
		}
	};
	raf = requestAnimationFrame(draw);
}

onBeforeUnmount(stop);
</script>
