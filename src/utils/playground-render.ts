import type { NudgeCategory } from '~/types/nudge';
import { resolveColor } from '~/utils/color';
import { hashString, seededRandom } from '~/utils/day';
import type {
	Biome,
	PlaygroundElement,
	PlaygroundScene,
	Point,
	SceneBox,
	ScenePalette,
	Species
} from '~/utils/playground';
import {
	blobPoints,
	dimHex,
	foliageFor,
	horizonFor,
	isWaning,
	mixHex,
	moonTerminatorPoints,
	NIGHT_TINT,
	rgbaCss,
	scenePalette,
	shadeHex
} from '~/utils/playground';

// One painter, two backends. Every shape in the scene is described once as data, then
// either stroked onto a 2D context or serialised as SVG. Two hand-written painters for
// 12 species x 3 skins x 4 seasons would drift, and a drifted export shows the user a
// different picture than the one on screen.

// #region shape ir

export interface GradientStop {
	at: number;
	color: string;
	alpha?: number;
}

export interface Gradient {
	kind: 'linear' | 'radial';
	x1: number;
	y1: number;
	x2: number;
	y2: number;
	/** radial only; the inner circle radius, which SVG folds into the stop offsets */
	r1?: number;
	r2?: number;
	stops: readonly GradientStop[];
}

export type Fill = string | Gradient;

interface Style {
	fill?: Fill;
	fillAlpha?: number;
	stroke?: string;
	strokeAlpha?: number;
	strokeWidth?: number;
	/** round caps and joins; strokes that end mid-air need it */
	round?: boolean;
}

export type Shape =
	| ({ kind: 'rect'; x: number; y: number; w: number; h: number } & Style)
	| ({ kind: 'circle'; cx: number; cy: number; r: number } & Style)
	| ({
			kind: 'ellipse';
			cx: number;
			cy: number;
			rx: number;
			ry: number;
			/** degrees */
			rotate?: number;
	  } & Style)
	| ({ kind: 'path'; d: string } & Style)
	| {
			kind: 'group';
			x?: number;
			y?: number;
			/** degrees */
			rotate?: number;
			alpha?: number;
			/** a path `d`; children are clipped to it */
			clip?: string;
			children: Shape[];
	  };

/** two decimals is under a display pixel at 6x and keeps the svg byte-stable */
function f(n: number): string {
	const rounded = Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
	return String(rounded === 0 ? 0 : rounded);
}

export function polylinePath(points: readonly Point[], closed = true): string {
	const first = points[0];
	if (!first) return '';
	let d = `M${f(first.x)} ${f(first.y)}`;
	for (let i = 1; i < points.length; i++) {
		const p = points[i] as Point;
		d += `L${f(p.x)} ${f(p.y)}`;
	}
	return closed ? `${d}Z` : d;
}

/** closed curve through the midpoints, so a seeded polygon reads as an organic lump */
export function blobPath(points: readonly Point[]): string {
	const n = points.length;
	if (n < 3) return polylinePath(points, true);
	const at = (i: number) => points[((i % n) + n) % n] as Point;
	const mid = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

	const start = mid(at(-1), at(0));
	let d = `M${f(start.x)} ${f(start.y)}`;
	for (let i = 0; i < n; i++) {
		const cur = at(i);
		const next = mid(at(i), at(i + 1));
		d += `Q${f(cur.x)} ${f(cur.y)} ${f(next.x)} ${f(next.y)}`;
	}
	return `${d}Z`;
}

function quadPath(from: Point, control: Point, to: Point): string {
	return `M${f(from.x)} ${f(from.y)}Q${f(control.x)} ${f(control.y)} ${f(to.x)} ${f(to.y)}`;
}

function linePath(x1: number, y1: number, x2: number, y2: number): string {
	return `M${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}`;
}

// #endregion

// #region ink

export interface SceneInk {
	bark: string;
	stem: string;
	pollen: string;
	snow: string;
	rope: string;
	wood: string;
	flame: string;
	moon: string;
	moonDark: string;
	silhouette: string;
}

export function sceneInk(palette: ScenePalette): SceneInk {
	const night = palette.night;
	return {
		bark: dimHex('#6b4423', night),
		stem: dimHex('#4a7c3f', night),
		pollen: dimHex('#faf089', night),
		snow: dimHex('#f0f7fc', night),
		rope: dimHex('#c8a06a', night),
		wood: dimHex('#8b5e34', night),
		flame: '#ffd79a',
		moon: '#f5f3ea',
		moonDark: mixHex(NIGHT_TINT, palette.skyTop, 0.45),
		silhouette: dimHex('#2f3b4a', night * 0.4)
	};
}

// #endregion

// #region layout

export interface PlacedElement {
	el: PlaygroundElement;
	/** stable across a relayout, so a tap's transient state survives a resize */
	key: string;
	x: number;
	y: number;
	/** drawn unit size in px */
	size: number;
	color: string;
	phase: number;
	dir: 1 | -1;
	surprise: boolean;
}

interface Star {
	x: number;
	y: number;
	r: number;
	phase: number;
}

interface Cloud {
	x: number;
	y: number;
	s: number;
	speed: number;
}

interface Mote {
	x: number;
	y: number;
	r: number;
	phase: number;
	speed: number;
}

export interface SceneLayout {
	width: number;
	height: number;
	groundY: number;
	unit: number;
	/** -1 lights from the left, +1 from the right */
	lightX: number;
	palette: ScenePalette;
	ink: SceneInk;
	elements: PlacedElement[];
	stars: Star[];
	clouds: Cloud[];
	motes: Mote[];
	hillPhase: number;
	celestial: { x: number; y: number; r: number };
}

const TAU = Math.PI * 2;

const SKY_SPECIES: ReadonlySet<Species> = new Set<Species>(['bird', 'kite']);

export function isSkySpecies(species: Species): boolean {
	return SKY_SPECIES.has(species);
}

const SWAY: Record<Species, number> = {
	tree: 0.5,
	shrub: 0.35,
	flower: 1,
	grass: 1.3,
	rock: 0,
	water: 0,
	bird: 0,
	lantern: 0.6,
	kite: 0,
	swing: 0,
	tent: 0,
	sprout: 0.9
};

// a plant leaning is charm; a tent or a swing frame leaning is a mistake
const TILT: Record<Species, number> = {
	tree: 0.6,
	shrub: 1,
	flower: 1,
	grass: 1,
	rock: 1,
	water: 1,
	bird: 0,
	lantern: 0,
	kite: 0,
	swing: 0,
	tent: 0,
	sprout: 1
};

function placeOne(
	el: PlaygroundElement,
	box: SceneBox,
	groundY: number,
	unit: number,
	palette: ScenePalette
): PlacedElement {
	const sky = isSkySpecies(el.species);
	const band = box.height - groundY;
	// depth 0 is the horizon and depth 1 the front edge, so perspective leads and the
	// element's own scale only jitters the size
	const perspective = 0.45 + el.depth * 0.85;
	const haze = (1 - el.depth) * (sky ? 0.25 : 0.4);

	return {
		el,
		key: `e${el.index}`,
		x: el.x * box.width,
		// a near bird sits low and large, a far one high and small; the other way round
		// reads as a kite the size of a house pinned to the top of the frame
		y: sky ? groundY * (0.16 + el.depth * 0.6) : groundY + band * (0.05 + el.depth * 0.9),
		size: Math.max(6, unit * perspective * el.scale),
		color: mixHex(dimHex(resolveColor(el.colorToken), palette.night), palette.skyBottom, haze),
		phase: (el.seed % 628) / 100,
		dir: el.seed % 2 === 0 ? 1 : -1,
		surprise: false
	};
}

function celestialSpot(scene: PlaygroundScene, box: SceneBox, groundY: number) {
	const r = Math.max(13, Math.min(box.width * 0.05, box.height * 0.075));
	// the light angle decides which side of the sky the sun or moon sits in, so the
	// element shadows below agree with it
	const lean = scene.traits.lightAngle / 35;
	switch (scene.timeOfDay) {
		case 'dawn':
			return { x: box.width * (0.5 + lean * 0.3), y: groundY * 0.62, r };
		case 'dusk':
			return { x: box.width * (0.5 + lean * 0.32), y: groundY * 0.6, r };
		case 'night':
			return { x: box.width * (0.5 + lean * 0.26), y: groundY * 0.3, r };
		default:
			return { x: box.width * (0.5 + lean * 0.3), y: groundY * 0.26, r };
	}
}

function buildSky(scene: PlaygroundScene, box: SceneBox, groundY: number, night: number) {
	const rng = seededRandom(
		hashString(`sky:${scene.seed}:${scene.points}:${scene.elements.length}`)
	);

	const stars: Star[] = [];
	if (night > 0.3) {
		const count = Math.round(16 + night * 26);
		for (let i = 0; i < count; i++) {
			stars.push({
				x: rng() * box.width,
				y: rng() * groundY * 0.82,
				r: 0.6 + rng() * 1.1,
				phase: rng() * TAU
			});
		}
	}

	const clouds: Cloud[] = [];
	if (night < 0.72) {
		for (let i = 0; i < 3; i++) {
			clouds.push({
				x: rng() * box.width,
				y: groundY * (0.12 + rng() * 0.3),
				s: box.width * (0.08 + rng() * 0.07),
				speed: 0.0014 + rng() * 0.002
			});
		}
	}

	const motes: Mote[] = [];
	const motif = scene.traits.motif;
	if (motif !== 'none') {
		const count = motif === 'flock' ? 7 : motif === 'low_mist' ? 3 : 18;
		for (let i = 0; i < count; i++) {
			motes.push({
				x: rng() * box.width,
				y:
					motif === 'flock'
						? groundY * (0.12 + rng() * 0.24)
						: motif === 'low_mist'
							? groundY - box.height * (0.01 + rng() * 0.05)
							: groundY * 0.45 + rng() * (box.height - groundY * 0.45),
				r: motif === 'fireflies' ? 1.2 + rng() * 1.4 : 1 + rng() * 1.8,
				phase: rng() * TAU,
				speed: 0.0008 + rng() * 0.0016
			});
		}
	}

	return { stars, clouds, motes, hillPhase: rng() * TAU };
}

export function layoutScene(scene: PlaygroundScene, box: SceneBox): SceneLayout {
	const width = Math.max(1, box.width);
	const height = Math.max(1, box.height);
	const palette = scenePalette(scene);
	const groundY = Math.round(height * horizonFor(scene.traits.horizon, { width, height }));
	const unit = Math.max(12, Math.min(height * 0.135, width * 0.105));

	const elements = scene.elements.map((el) =>
		placeOne(el, { width, height }, groundY, unit, palette)
	);
	if (scene.surprise) {
		elements.push({
			...placeOne(scene.surprise, { width, height }, groundY, unit, palette),
			surprise: true
		});
	}

	const sky = buildSky(scene, { width, height }, groundY, palette.night);

	return {
		width,
		height,
		groundY,
		unit,
		lightX: Math.sin((scene.traits.lightAngle * Math.PI) / 180),
		palette,
		ink: sceneInk(palette),
		elements,
		stars: sky.stars,
		clouds: sky.clouds,
		motes: sky.motes,
		hillPhase: sky.hillPhase,
		celestial: celestialSpot(scene, { width, height }, groundY)
	};
}

// #endregion

// #region motion

export interface SceneMotion {
	/** ms since the scene started */
	time: number;
	/** 0..1 grow-in; 1 is settled */
	bloom: number;
	/** false pins every oscillator to its settled value */
	animate: boolean;
	startled?: ReadonlyMap<string, number>;
	opened?: ReadonlyMap<string, number>;
	ripples?: readonly { x: number; y: number; start: number }[];
}

export const SETTLED_MOTION: SceneMotion = { time: 0, bloom: 1, animate: false };

export const STARTLE_MS = 2400;
export const OPEN_MS = 1600;
export const RIPPLE_MS = 640;

function opennessFor(key: string, motion: SceneMotion): number {
	const at = motion.opened?.get(key);
	if (at === undefined) return 0;
	if (!motion.animate) return 1;
	const k = (motion.time - at) / OPEN_MS;
	return k <= 0 || k >= 1 ? 0 : Math.sin(k * Math.PI);
}

// #endregion

// #region sky and terrain

function skyShapes(layout: SceneLayout, motion: SceneMotion): Shape[] {
	const { palette, groundY, width } = layout;
	const out: Shape[] = [
		{
			kind: 'rect',
			x: 0,
			y: 0,
			w: width,
			h: groundY + 1,
			fill: {
				kind: 'linear',
				x1: 0,
				y1: 0,
				x2: 0,
				y2: groundY,
				stops: [
					{ at: 0, color: palette.skyTop },
					{ at: 1, color: palette.skyBottom }
				]
			}
		}
	];

	for (const star of layout.stars) {
		const twinkle = motion.animate
			? 0.55 + Math.sin(motion.time * 0.0016 + star.phase) * 0.45
			: 0.75;
		out.push({
			kind: 'circle',
			cx: star.x,
			cy: star.y,
			r: star.r,
			fill: '#ffffff',
			fillAlpha: twinkle * palette.night * 0.9
		});
	}

	const tint = mixHex('#ffffff', palette.skyBottom, 0.24 + palette.night * 0.5);
	for (const cloud of layout.clouds) {
		const span = width + cloud.s * 4;
		const drift = motion.animate ? motion.time * cloud.speed : 0;
		const x = ((cloud.x + drift) % span) - cloud.s * 2;
		const alpha = 0.32 * (1 - palette.night * 0.7);
		out.push(
			{
				kind: 'ellipse',
				cx: x,
				cy: cloud.y,
				rx: cloud.s,
				ry: cloud.s * 0.34,
				fill: tint,
				fillAlpha: alpha
			},
			{
				kind: 'ellipse',
				cx: x + cloud.s * 0.58,
				cy: cloud.y + cloud.s * 0.1,
				rx: cloud.s * 0.58,
				ry: cloud.s * 0.24,
				fill: tint,
				fillAlpha: alpha
			},
			{
				kind: 'ellipse',
				cx: x - cloud.s * 0.54,
				cy: cloud.y + cloud.s * 0.12,
				rx: cloud.s * 0.5,
				ry: cloud.s * 0.22,
				fill: tint,
				fillAlpha: alpha
			}
		);
	}

	return out;
}

function sunShapes(scene: PlaygroundScene, layout: SceneLayout): Shape[] {
	const { x, y, r } = layout.celestial;
	const low = scene.timeOfDay !== 'day';
	const core = low
		? mixHex(layout.palette.light, '#ffb066', 0.35)
		: shadeHex(layout.palette.light, 0.12);

	return [
		{
			kind: 'circle',
			cx: x,
			cy: y,
			r: r * 3.4,
			fill: {
				kind: 'radial',
				x1: x,
				y1: y,
				r1: r * 0.4,
				x2: x,
				y2: y,
				r2: r * 3.4,
				stops: [
					{ at: 0, color: core, alpha: 0.6 },
					{ at: 1, color: core, alpha: 0 }
				]
			}
		},
		{ kind: 'circle', cx: x, cy: y, r, fill: core }
	];
}

function moonShapes(scene: PlaygroundScene, layout: SceneLayout): Shape[] {
	const { x, y, r } = layout.celestial;
	const { ink } = layout;
	const lit = Math.min(1, Math.max(0, scene.moonIllumination));
	const terminator = moonTerminatorPoints(r, lit, isWaning(scene.moonPhase));

	return [
		{
			kind: 'circle',
			cx: x,
			cy: y,
			r: r * 3.2,
			fill: {
				kind: 'radial',
				x1: x,
				y1: y,
				r1: r * 0.4,
				x2: x,
				y2: y,
				r2: r * 3.2,
				stops: [
					{ at: 0, color: ink.moon, alpha: 0.16 + lit * 0.4 },
					{ at: 1, color: ink.moon, alpha: 0 }
				]
			}
		},
		{
			kind: 'group',
			x,
			y,
			children: [
				{
					kind: 'circle',
					cx: 0,
					cy: 0,
					r,
					fill: ink.moonDark,
					stroke: ink.moon,
					strokeAlpha: 0.22,
					strokeWidth: 1
				},
				{ kind: 'path', d: polylinePath(terminator, true), fill: ink.moon },
				{
					kind: 'circle',
					cx: -r * 0.3,
					cy: -r * 0.22,
					r: r * 0.26,
					fill: '#000000',
					fillAlpha: 0.1
				},
				{
					kind: 'circle',
					cx: r * 0.24,
					cy: r * 0.3,
					r: r * 0.17,
					fill: '#000000',
					fillAlpha: 0.1
				}
			]
		}
	];
}

function ridgeShapes(layout: SceneLayout): Shape[] {
	const { palette, groundY, width, height, hillPhase } = layout;
	const bands = [
		{ amp: height * 0.11, lift: height * 0.09, freq: 0.011, haze: 0.6 },
		{ amp: height * 0.08, lift: height * 0.03, freq: 0.017, haze: 0.38 }
	];

	return bands.map((band, index) => {
		const points: Point[] = [{ x: -8, y: groundY + 4 }];
		for (let x = -8; x <= width + 8; x += 10) {
			const wave = Math.sin(x * band.freq + hillPhase + index) * 0.5 + 0.5;
			const ripple = Math.sin(x * band.freq * 2.7 + hillPhase) * 0.16;
			points.push({ x, y: groundY - band.lift - (wave + ripple) * band.amp });
		}
		points.push({ x: width + 8, y: groundY + 4 });
		return {
			kind: 'path' as const,
			d: polylinePath(points, true),
			fill: mixHex(palette.hill, palette.skyBottom, band.haze)
		};
	});
}

function groveShapes(scene: PlaygroundScene, layout: SceneLayout): Shape[] {
	const rng = seededRandom(hashString(`grove:${scene.seed}:${scene.points}`));
	const count = Math.max(8, Math.round(layout.width / 26));
	const fill = mixHex(layout.palette.hill, layout.palette.skyBottom, 0.42);
	const out: Shape[] = [];

	for (let i = 0; i < count; i++) {
		const x = ((i + rng() * 0.7) / count) * (layout.width + 20) - 10;
		const h = layout.height * (0.055 + rng() * 0.045);
		const w = h * (0.38 + rng() * 0.22);
		const conifer = rng() > 0.45;
		if (conifer) {
			out.push({
				kind: 'path',
				d: polylinePath(
					[
						{ x, y: layout.groundY + 3 - h },
						{ x: x + w, y: layout.groundY + 3 },
						{ x: x - w, y: layout.groundY + 3 }
					],
					true
				),
				fill
			});
		} else {
			out.push(
				{
					kind: 'rect',
					x: x - w * 0.12,
					y: layout.groundY + 3 - h * 0.62,
					w: w * 0.24,
					h: h * 0.62,
					fill
				},
				{
					kind: 'ellipse',
					cx: x,
					cy: layout.groundY + 3 - h * 0.68,
					rx: w,
					ry: h * 0.44,
					fill
				}
			);
		}
	}

	return out;
}

function groundShapes(layout: SceneLayout): Shape[] {
	const { palette, groundY, width, height } = layout;
	return [
		{
			kind: 'rect',
			x: 0,
			y: groundY,
			w: width,
			h: height - groundY,
			fill: {
				kind: 'linear',
				x1: 0,
				y1: groundY,
				x2: 0,
				y2: height,
				stops: [
					{ at: 0, color: shadeHex(palette.ground, 0.06) },
					{ at: 1, color: mixHex(palette.ground, palette.groundShadow, 0.85) }
				]
			}
		},
		{
			kind: 'rect',
			x: 0,
			y: groundY - 1,
			w: width,
			h: 2,
			fill: palette.light,
			fillAlpha: 0.2 * (1 - palette.night * 0.5)
		}
	];
}

function pondShapes(scene: PlaygroundScene, layout: SceneLayout, motion: SceneMotion): Shape[] {
	const { palette, ink, groundY, width, height } = layout;
	const band = height - groundY;
	const x = width * 0.31;
	const y = groundY + band * 0.44;
	const rx = width * 0.29;
	const ry = band * 0.17;

	const out: Shape[] = [
		{
			kind: 'ellipse',
			cx: x,
			cy: y,
			rx,
			ry,
			fill: {
				kind: 'linear',
				x1: 0,
				y1: y - ry,
				x2: 0,
				y2: y + ry,
				stops: [
					{ at: 0, color: palette.waterTop },
					{ at: 1, color: palette.waterBottom }
				]
			}
		}
	];

	if (scene.season === 'winter') {
		out.push({
			kind: 'ellipse',
			cx: x,
			cy: y,
			rx: rx * 0.93,
			ry: ry * 0.88,
			fill: ink.snow,
			fillAlpha: 0.6
		});
	} else {
		for (let i = 0; i < 3; i++) {
			const drift = motion.animate ? Math.sin(motion.time * 0.0009 + i) * rx * 0.12 : 0;
			const ly = y - ry * 0.4 + i * ry * 0.42;
			out.push({
				kind: 'path',
				d: quadPath(
					{ x: x - rx * 0.5 + drift, y: ly },
					{ x: x + drift, y: ly - ry * 0.12 },
					{ x: x + rx * 0.45 + drift, y: ly }
				),
				stroke: palette.light,
				strokeAlpha: 0.38,
				strokeWidth: 1.2,
				round: true
			});
		}
	}

	out.push({
		kind: 'ellipse',
		cx: x,
		cy: y,
		rx,
		ry,
		stroke: mixHex(palette.groundShadow, palette.waterBottom, 0.4),
		strokeAlpha: 0.55,
		strokeWidth: 1.4
	});

	return out;
}

function motifShapes(scene: PlaygroundScene, layout: SceneLayout, motion: SceneMotion): Shape[] {
	const motif = scene.traits.motif;
	if (motif === 'none' || layout.motes.length === 0) return [];

	const { palette, ink, width, height, groundY } = layout;
	const out: Shape[] = [];

	if (motif === 'low_mist') {
		for (const [i, mote] of layout.motes.entries()) {
			const drift = motion.animate ? Math.sin(motion.time * mote.speed + mote.phase) * 12 : 0;
			out.push({
				kind: 'ellipse',
				cx: width * 0.5 + drift,
				cy: mote.y,
				rx: width * (0.42 + i * 0.12),
				ry: Math.max(3, height * 0.018),
				fill: mixHex(palette.light, palette.skyBottom, 0.4),
				fillAlpha: 0.16
			});
		}
		return out;
	}

	if (motif === 'flock') {
		for (const mote of layout.motes) {
			const span = width + 80;
			const drift = motion.animate ? motion.time * 0.012 : 0;
			const x = ((mote.x + drift) % span) - 40;
			const wing = Math.max(3, layout.unit * 0.22);
			out.push({
				kind: 'path',
				d: `M${f(x - wing)} ${f(mote.y)}Q${f(x - wing * 0.32)} ${f(mote.y - wing * 0.6)} ${f(x)} ${f(mote.y - wing * 0.1)}Q${f(x + wing * 0.32)} ${f(mote.y - wing * 0.6)} ${f(x + wing)} ${f(mote.y)}`,
				stroke: ink.silhouette,
				strokeAlpha: 0.6,
				strokeWidth: Math.max(1, wing * 0.16),
				round: true
			});
		}
		return out;
	}

	const glow = motif === 'fireflies';
	for (const mote of layout.motes) {
		const rise = motion.animate ? (motion.time * mote.speed * 30) % (height + 20) : 0;
		const y = glow ? mote.y : ((mote.y - rise + height + 20) % (height + 20)) - 10;
		const x = mote.x + (motion.animate ? Math.sin(motion.time * 0.001 + mote.phase) * 10 : 0);
		const strength = motion.animate
			? 0.4 + (Math.sin(motion.time * 0.004 + mote.phase) * 0.5 + 0.5) * 0.5
			: 0.6;

		if (glow) {
			// fireflies only read against a dim sky, so the night factor gates them
			const visible = Math.min(1, palette.night * 1.3);
			if (visible <= 0.02) continue;
			out.push(
				{
					kind: 'circle',
					cx: x,
					cy: y,
					r: mote.r * 4,
					fill: {
						kind: 'radial',
						x1: x,
						y1: y,
						r1: 0,
						x2: x,
						y2: y,
						r2: mote.r * 4,
						stops: [
							{ at: 0, color: '#faf078', alpha: strength * 0.7 * visible },
							{ at: 1, color: '#faf078', alpha: 0 }
						]
					}
				},
				{
					kind: 'circle',
					cx: x,
					cy: y,
					r: mote.r,
					fill: '#fffac8',
					fillAlpha: (0.6 + strength * 0.4) * visible
				}
			);
		} else {
			out.push({
				kind: 'ellipse',
				cx: x,
				cy: y > groundY * 0.2 ? y : groundY,
				rx: mote.r,
				ry: mote.r * 0.55,
				fill: mixHex(palette.light, '#ffffff', 0.3),
				fillAlpha: strength * 0.55
			});
		}
	}

	return out;
}

function vignetteShape(layout: SceneLayout): Shape {
	const { width, height, palette } = layout;
	const inner = Math.min(width, height) * 0.34;
	const outer = Math.max(width, height) * 0.8;
	return {
		kind: 'rect',
		x: 0,
		y: 0,
		w: width,
		h: height,
		fill: {
			kind: 'radial',
			x1: width * 0.5,
			y1: height * 0.45,
			r1: inner,
			x2: width * 0.5,
			y2: height * 0.5,
			r2: outer,
			stops: [
				{ at: 0, color: '#000000', alpha: 0 },
				{ at: 1, color: '#000000', alpha: 0.1 + palette.night * 0.2 }
			]
		}
	};
}

// #endregion

// #region species

interface Brush {
	scene: PlaygroundScene;
	layout: SceneLayout;
	motion: SceneMotion;
	p: PlacedElement;
	s: number;
}

function treeShapes(b: Brush): Shape[] {
	const { p, s, scene, layout } = b;
	const skin = p.el.skin;
	const trunkH = s * (skin === 2 ? 2 : 1.55);
	const trunkW = Math.max(1.6, s * (skin === 2 ? 0.13 : 0.17));
	const bark = mixHex(p.color, layout.ink.bark, 0.72);
	const crownY = -trunkH - s * 0.1;
	const r = s * (skin === 2 ? 0.6 : 0.72);
	const leaves = foliageFor(p.color, scene.season, p.el.seed);

	const out: Shape[] = [
		{
			kind: 'path',
			d: polylinePath(
				[
					{ x: -trunkW / 2, y: 0 },
					{ x: trunkW / 2, y: 0 },
					{ x: trunkW * 0.3, y: -trunkH },
					{ x: -trunkW * 0.3, y: -trunkH }
				],
				true
			),
			fill: bark
		}
	];

	if (!leaves) {
		for (let i = 0; i < 5; i++) {
			const angle = -Math.PI / 2 + (i - 2) * 0.46;
			out.push({
				kind: 'path',
				d: linePath(
					0,
					crownY + r * 0.5,
					Math.cos(angle) * r * 0.9,
					crownY + r * 0.5 + Math.sin(angle) * r * 0.9
				),
				stroke: shadeHex(bark, 0.12),
				strokeWidth: Math.max(1, trunkW * 0.34),
				round: true
			});
		}
		out.push({
			kind: 'ellipse',
			cx: 0,
			cy: crownY + r * 0.4,
			rx: r * 0.5,
			ry: r * 0.14,
			fill: layout.ink.snow,
			fillAlpha: 0.8
		});
		return out;
	}

	if (skin === 1) {
		for (let i = 0; i < 3; i++) {
			const ty = crownY + i * r * 0.52;
			const tw = r * (1 - i * 0.2);
			out.push({
				kind: 'path',
				d: polylinePath(
					[
						{ x: 0, y: ty - r * 0.95 },
						{ x: tw, y: ty + r * 0.22 },
						{ x: -tw, y: ty + r * 0.22 }
					],
					true
				),
				fill: shadeHex(leaves, 0.08 - i * 0.06)
			});
		}
		return out;
	}

	for (let i = 0; i < 2; i++) {
		const by = -trunkH * (0.62 + 0.18 * i);
		const dir = i % 2 === 0 ? 1 : -1;
		out.push({
			kind: 'path',
			d: linePath(0, by, dir * s * 0.34, by - s * 0.18),
			stroke: bark,
			strokeWidth: Math.max(1, trunkW * 0.4),
			round: true
		});
	}

	if (skin === 2) {
		// columnar: a tight vertical crown rather than a spread one
		out.push(
			{ kind: 'ellipse', cx: 0, cy: crownY, rx: r * 0.62, ry: r * 1.15, fill: leaves },
			{
				kind: 'ellipse',
				cx: -r * 0.2,
				cy: crownY - r * 0.35,
				rx: r * 0.34,
				ry: r * 0.62,
				fill: shadeHex(leaves, 0.16)
			}
		);
		return out;
	}

	out.push(
		{
			kind: 'circle',
			cx: -r * 0.52,
			cy: crownY + r * 0.18,
			r: r * 0.72,
			fill: shadeHex(leaves, -0.16)
		},
		{
			kind: 'circle',
			cx: r * 0.5,
			cy: crownY + r * 0.14,
			r: r * 0.76,
			fill: shadeHex(leaves, 0.1)
		},
		{ kind: 'circle', cx: 0, cy: crownY - r * 0.44, r: r * 0.66, fill: shadeHex(leaves, 0.2) },
		{ kind: 'circle', cx: 0, cy: crownY, r: r * 0.9, fill: leaves }
	);
	return out;
}

function shrubShapes(b: Brush): Shape[] {
	const { p, s, scene, layout } = b;
	const skin = p.el.skin;
	const r = s * (skin === 2 ? 0.44 : 0.52);
	const leaves = foliageFor(p.color, scene.season, p.el.seed);

	if (!leaves) {
		const out: Shape[] = [];
		for (let i = 0; i < 4; i++) {
			const angle = -Math.PI / 2 + (i - 1.5) * 0.42;
			out.push({
				kind: 'path',
				d: linePath(0, 0, Math.cos(angle) * r * 1.1, Math.sin(angle) * r * 1.5),
				stroke: mixHex(p.color, layout.ink.bark, 0.8),
				strokeWidth: Math.max(1, s * 0.07),
				round: true
			});
		}
		return out;
	}

	if (skin === 2) {
		// a wide low mound; five overlapping lumps instead of three
		const out: Shape[] = [];
		for (let i = 0; i < 5; i++) {
			const t = (i - 2) / 2;
			out.push({
				kind: 'circle',
				cx: t * r * 1.15,
				cy: -r * (0.42 + (1 - Math.abs(t)) * 0.4),
				r: r * (0.5 + (1 - Math.abs(t)) * 0.18),
				fill: shadeHex(leaves, -0.18 + (1 - Math.abs(t)) * 0.3)
			});
		}
		return out;
	}

	const out: Shape[] = [
		{ kind: 'circle', cx: -r * 0.62, cy: -r * 0.5, r: r * 0.66, fill: shadeHex(leaves, -0.18) },
		{ kind: 'circle', cx: r * 0.6, cy: -r * 0.44, r: r * 0.62, fill: shadeHex(leaves, -0.05) },
		{ kind: 'circle', cx: 0, cy: -r * 0.8, r: r * 0.78, fill: shadeHex(leaves, 0.12) }
	];

	if (skin === 1) {
		for (let i = 0; i < 3; i++) {
			out.push({
				kind: 'circle',
				cx: -r * 0.42 + i * r * 0.42,
				cy: -r * (0.6 + (i % 2) * 0.32),
				r: Math.max(1, s * 0.06),
				fill: shadeHex(p.color, 0.42)
			});
		}
	}

	return out;
}

function grassShapes(b: Brush): Shape[] {
	const { p, s, scene, layout } = b;
	const skin = p.el.skin;
	const h = s * 0.95;
	const winter = scene.season === 'winter';
	const autumn = scene.season === 'autumn';
	const color =
		winter || autumn
			? mixHex(p.color, dimHex(winter ? '#cbd5e0' : '#b7791f', layout.palette.night), 0.65)
			: shadeHex(p.color, 0.2);

	const blades = skin === 1 ? 7 : skin === 2 ? 3 : 5;
	const weight = skin === 1 ? 0.05 : skin === 2 ? 0.11 : 0.07;
	const out: Shape[] = [];

	for (let i = 0; i < blades; i++) {
		const off = (i - (blades - 1) / 2) * s * 0.16;
		const lean = off * 0.5 + (i % 2 === 0 ? s * 0.1 : -s * 0.08);
		out.push({
			kind: 'path',
			d: quadPath({ x: off, y: 0 }, { x: off + lean, y: -h * 0.6 }, { x: off + lean * 1.7, y: -h }),
			stroke: color,
			strokeWidth: Math.max(1, s * weight),
			round: true
		});
	}

	return out;
}

function flowerShapes(b: Brush): Shape[] {
	const { p, s, scene, layout, motion } = b;
	if (scene.season === 'winter') return grassShapes({ ...b, s: s * 0.82 });

	const skin = p.el.skin;
	const open = opennessFor(p.key, motion);
	const h = s;
	const out: Shape[] = [
		{
			kind: 'path',
			d: quadPath({ x: 0, y: 0 }, { x: s * 0.14, y: -h * 0.5 }, { x: 0, y: -h }),
			stroke: layout.ink.stem,
			strokeWidth: Math.max(1.1, s * 0.075),
			round: true
		},
		{
			kind: 'ellipse',
			cx: s * 0.2,
			cy: -h * 0.46,
			rx: s * 0.2,
			ry: s * 0.09,
			rotate: -28.6,
			fill: layout.ink.stem
		}
	];

	const petals = skin === 1 ? 8 : skin === 2 ? 4 : 5 + (p.el.seed % 2);
	const pr = s * 0.34 * (1 + open * 0.3);
	const petalColor =
		scene.season === 'autumn'
			? mixHex(p.color, dimHex('#dd6b20', layout.palette.night), 0.3)
			: p.color;
	const narrow = skin === 1 ? 0.32 : skin === 2 ? 0.78 : 0.5;

	const head: Shape[] = [];
	for (let i = 0; i < petals; i++) {
		head.push({
			kind: 'group',
			rotate: ((i / petals) * TAU + open * 0.3) * (180 / Math.PI),
			children: [
				{
					kind: 'ellipse',
					cx: 0,
					cy: -pr * 0.85,
					rx: pr * narrow,
					ry: pr * 0.9,
					fill: petalColor
				}
			]
		});
	}
	head.push({
		kind: 'circle',
		cx: 0,
		cy: 0,
		r: pr * (skin === 2 ? 0.5 : 0.42),
		fill: skin === 2 ? shadeHex(petalColor, -0.4) : layout.ink.pollen
	});

	out.push({ kind: 'group', y: -h, children: head });
	return out;
}

function rockShapes(b: Brush): Shape[] {
	const { p, s, scene, layout } = b;
	const skin = p.el.skin;
	const steps = skin === 1 ? 7 : skin === 2 ? 12 : 9;
	const points = blobPoints(p.el.seed, s, steps);
	const d = skin === 1 ? polylinePath(points, true) : blobPath(points);

	const body: Shape[] = [
		{
			kind: 'path',
			d,
			fill: {
				kind: 'linear',
				x1: 0,
				y1: -s * 0.8,
				x2: 0,
				y2: s * 0.1,
				stops: [
					{ at: 0, color: shadeHex(p.color, 0.28) },
					{ at: 1, color: shadeHex(p.color, -0.22) }
				]
			}
		},
		{
			kind: 'group',
			clip: d,
			children: [
				{
					kind: 'ellipse',
					cx: -s * 0.14 * (layout.lightX >= 0 ? 1 : -1),
					cy: -s * 0.5,
					rx: s * 0.4,
					ry: s * 0.16,
					rotate: -17.2,
					fill: shadeHex(p.color, 0.4),
					fillAlpha: 0.4
				}
			]
		}
	];

	const cracks = skin === 1 ? 2 : 1;
	for (let i = 0; i < cracks; i++) {
		body.push({
			kind: 'path',
			d: quadPath(
				{ x: -s * 0.2 + i * s * 0.16, y: -s * 0.34 + i * s * 0.12 },
				{ x: 0, y: -s * 0.24 },
				{ x: s * 0.16, y: -s * 0.1 + i * s * 0.1 }
			),
			stroke: shadeHex(p.color, -0.42),
			strokeAlpha: 0.7,
			strokeWidth: Math.max(0.8, s * 0.04),
			round: true
		});
	}

	if (skin === 2) {
		body.push({
			kind: 'ellipse',
			cx: 0,
			cy: -s * 0.5,
			rx: s * 0.3,
			ry: s * 0.1,
			fill: mixHex(layout.ink.stem, p.color, 0.3),
			fillAlpha: 0.7
		});
	}

	if (scene.season === 'winter') {
		body.push({
			kind: 'ellipse',
			cx: 0,
			cy: -s * 0.52,
			rx: s * 0.36,
			ry: s * 0.11,
			fill: layout.ink.snow,
			fillAlpha: 0.82
		});
	}

	return body;
}

function waterShapes(b: Brush): Shape[] {
	const { p, s, scene, layout, motion } = b;
	const skin = p.el.skin;
	const rx = s * 0.95;
	const ry = s * 0.34;

	const out: Shape[] = [
		{
			kind: 'ellipse',
			cx: 0,
			cy: 0,
			rx,
			ry,
			fill: {
				kind: 'linear',
				x1: 0,
				y1: -ry,
				x2: 0,
				y2: ry,
				stops: [
					{ at: 0, color: mixHex(layout.palette.waterTop, p.color, 0.22) },
					{ at: 1, color: layout.palette.waterBottom }
				]
			}
		}
	];

	if (scene.season === 'winter') {
		out.push({
			kind: 'ellipse',
			cx: 0,
			cy: 0,
			rx: rx * 0.9,
			ry: ry * 0.86,
			fill: layout.ink.snow,
			fillAlpha: 0.58
		});
	} else {
		for (let i = 0; i < 2; i++) {
			const drift = motion.animate ? Math.sin(motion.time * 0.0022 + p.phase + i) * rx * 0.16 : 0;
			const y = -ry * 0.3 + i * ry * 0.7;
			out.push({
				kind: 'path',
				d: linePath(-rx * 0.42 + drift, y, rx * 0.28 + drift, y),
				stroke: layout.palette.light,
				strokeAlpha: 0.45,
				strokeWidth: Math.max(0.8, s * 0.05),
				round: true
			});
		}
	}

	if (skin === 1) {
		for (const side of [-1, 1]) {
			out.push({
				kind: 'path',
				d: quadPath(
					{ x: side * rx * 0.62, y: -ry * 0.2 },
					{ x: side * rx * 0.78, y: -s * 0.5 },
					{ x: side * rx * 0.66, y: -s * 0.86 }
				),
				stroke: layout.ink.stem,
				strokeWidth: Math.max(1, s * 0.06),
				round: true
			});
		}
	} else if (skin === 2) {
		out.push({
			kind: 'path',
			d: `M0 ${f(-ry * 0.1)}A${f(rx * 0.42)} ${f(ry * 0.72)} 0 1 1 ${f(rx * 0.3)} ${f(ry * 0.4)}Z`,
			fill: mixHex(layout.ink.stem, p.color, 0.35)
		});
	}

	return out;
}

function lanternShapes(b: Brush): Shape[] {
	const { p, s, layout, motion } = b;
	const skin = p.el.skin;
	const postH = s * 1.5;
	const lx = skin === 2 ? 0 : s * 0.4;
	const ly = -postH + s * 0.55;
	const lw = s * 0.28;
	const lh = s * 0.34;
	const pulse = motion.animate ? 0.72 + Math.sin(motion.time * 0.0015 + p.phase) * 0.28 : 0.8;
	const strength = (0.2 + layout.palette.night * 0.72) * pulse;
	const body = mixHex(p.color, layout.ink.flame, 0.34 + layout.palette.night * 0.34);

	const out: Shape[] = [
		{
			kind: 'path',
			d:
				skin === 2
					? linePath(0, 0, 0, -postH)
					: `M0 0L0 ${f(-postH)}Q0 ${f(-postH - s * 0.22)} ${f(s * 0.4)} ${f(-postH - s * 0.16)}`,
			stroke: layout.ink.wood,
			strokeWidth: Math.max(1.4, s * 0.1),
			round: true
		},
		{
			kind: 'circle',
			cx: lx,
			cy: ly,
			r: s * 2.4,
			fill: {
				kind: 'radial',
				x1: lx,
				y1: ly,
				r1: s * 0.1,
				x2: lx,
				y2: ly,
				r2: s * 2.4,
				stops: [
					{ at: 0, color: layout.ink.flame, alpha: strength * 0.85 },
					{ at: 1, color: layout.ink.flame, alpha: 0 }
				]
			}
		},
		{
			kind: 'path',
			d: linePath(lx, -postH - s * 0.14, lx, ly - lh),
			stroke: layout.ink.wood,
			strokeAlpha: 0.85,
			strokeWidth: 1
		}
	];

	if (skin === 1) {
		out.push({
			kind: 'rect',
			x: lx - lw,
			y: ly - lh,
			w: lw * 2,
			h: lh * 2,
			fill: body
		});
	} else {
		out.push({ kind: 'ellipse', cx: lx, cy: ly, rx: lw, ry: lh, fill: body });
	}

	for (const k of [-0.5, 0, 0.5]) {
		out.push({
			kind: 'path',
			d: quadPath(
				{ x: lx + lw * k * 0.9, y: ly - lh * 0.9 },
				{ x: lx + lw * k * 1.4, y: ly },
				{ x: lx + lw * k * 0.9, y: ly + lh * 0.9 }
			),
			stroke: shadeHex(body, -0.32),
			strokeAlpha: 0.5,
			strokeWidth: Math.max(0.7, s * 0.035)
		});
	}

	out.push(
		{
			kind: 'rect',
			x: lx - lw * 0.5,
			y: ly - lh - s * 0.03,
			w: lw,
			h: Math.max(1.5, s * 0.06),
			fill: layout.ink.wood
		},
		{
			kind: 'rect',
			x: lx - lw * 0.4,
			y: ly + lh - s * 0.02,
			w: lw * 0.8,
			h: Math.max(1.5, s * 0.06),
			fill: layout.ink.wood
		}
	);

	return out;
}

function swingShapes(b: Brush): Shape[] {
	const { p, s, layout, motion } = b;
	const skin = p.el.skin;
	const frameH = s * 1.4;
	const legSpan = s * 0.72;
	const barHalf = s * 0.34;
	const angle = motion.animate ? Math.sin(motion.time * 0.0016 + p.phase) * 0.26 : 0.05;
	const ropeL = frameH * 0.62;

	const seat: Shape[] = [
		{
			kind: 'path',
			d: `${linePath(-s * 0.2, 0, -s * 0.2, ropeL)}${linePath(s * 0.2, 0, s * 0.2, ropeL)}`,
			stroke: layout.ink.rope,
			strokeWidth: Math.max(1, s * 0.055),
			round: true
		}
	];

	if (skin === 1) {
		seat.push(
			{
				kind: 'circle',
				cx: 0,
				cy: ropeL + s * 0.24,
				r: s * 0.26,
				stroke: p.color,
				strokeWidth: Math.max(2, s * 0.1)
			},
			{ kind: 'path', d: linePath(0, ropeL, 0, ropeL - s * 0.02), stroke: layout.ink.rope }
		);
	} else if (skin === 2) {
		seat.push(
			{ kind: 'rect', x: -s * 0.32, y: ropeL, w: s * 0.64, h: Math.max(2, s * 0.1), fill: p.color },
			{
				kind: 'rect',
				x: -s * 0.32,
				y: ropeL - s * 0.24,
				w: Math.max(2, s * 0.08),
				h: s * 0.26,
				fill: shadeHex(p.color, -0.2)
			}
		);
	} else {
		seat.push({
			kind: 'rect',
			x: -s * 0.3,
			y: ropeL,
			w: s * 0.6,
			h: Math.max(2, s * 0.11),
			fill: p.color
		});
	}

	return [
		{
			kind: 'path',
			d: `${linePath(-legSpan, 0, -barHalf, -frameH)}${linePath(legSpan, 0, barHalf, -frameH)}${linePath(-barHalf - s * 0.1, -frameH, barHalf + s * 0.1, -frameH)}`,
			stroke: layout.ink.wood,
			strokeWidth: Math.max(1.6, s * 0.11),
			round: true
		},
		{ kind: 'group', y: -frameH, rotate: (angle * 180) / Math.PI, children: seat }
	];
}

function tentShapes(b: Brush): Shape[] {
	const { p, s, layout } = b;
	const skin = p.el.skin;
	const w = s * 0.85;
	const h = s * (skin === 2 ? 1.25 : 1.05);
	const shell: Fill = {
		kind: 'linear',
		x1: -w,
		y1: 0,
		x2: w,
		y2: 0,
		stops: [
			{ at: 0, color: shadeHex(p.color, 0.16) },
			{ at: 1, color: shadeHex(p.color, -0.26) }
		]
	};

	if (skin === 1) {
		// dome: a half ellipse with a low arched door
		return [
			{
				kind: 'path',
				d: `M${f(-w)} 0A${f(w)} ${f(h)} 0 0 1 ${f(w)} 0Z`,
				fill: shell
			},
			{
				kind: 'path',
				d: `M${f(-w * 0.3)} 0A${f(w * 0.3)} ${f(h * 0.6)} 0 0 1 ${f(w * 0.3)} 0Z`,
				fill: shadeHex(p.color, -0.55)
			},
			{
				kind: 'path',
				d: `M${f(-w)} 0A${f(w)} ${f(h)} 0 0 1 ${f(w)} 0`,
				stroke: shadeHex(p.color, -0.35),
				strokeAlpha: 0.6,
				strokeWidth: Math.max(0.8, s * 0.04)
			}
		];
	}

	const out: Shape[] = [
		{
			kind: 'path',
			d: polylinePath(
				[
					{ x: 0, y: -h },
					{ x: w, y: 0 },
					{ x: -w, y: 0 }
				],
				true
			),
			fill: shell
		},
		{
			kind: 'path',
			d: polylinePath(
				[
					{ x: 0, y: -h * 0.76 },
					{ x: w * 0.32, y: 0 },
					{ x: -w * 0.32, y: 0 }
				],
				true
			),
			fill: shadeHex(p.color, -0.55)
		},
		{
			kind: 'path',
			d: polylinePath(
				[
					{ x: 0, y: -h * 0.76 },
					{ x: w * 0.32, y: 0 },
					{ x: w * 0.1, y: 0 }
				],
				true
			),
			fill: shadeHex(p.color, 0.08)
		}
	];

	if (skin === 2) {
		// tipi: crossed poles poking out of the peak
		out.push({
			kind: 'path',
			d: `${linePath(0, -h, -w * 0.22, -h - s * 0.26)}${linePath(0, -h, w * 0.22, -h - s * 0.26)}`,
			stroke: layout.ink.wood,
			strokeWidth: Math.max(0.9, s * 0.05),
			round: true
		});
	} else {
		out.push({
			kind: 'path',
			d: `${linePath(0, -h, -w * 1.34, 0)}${linePath(0, -h, w * 1.34, 0)}${linePath(0, -h, 0, -h - s * 0.14)}`,
			stroke: layout.ink.rope,
			strokeAlpha: 0.7,
			strokeWidth: Math.max(0.8, s * 0.045),
			round: true
		});
	}

	return out;
}

function sproutShapes(b: Brush): Shape[] {
	const { p, s, scene, layout, motion } = b;
	const skin = p.el.skin;
	const open = opennessFor(p.key, motion);
	const h = s * 0.52;
	const leaf = scene.season === 'winter' ? mixHex(p.color, layout.ink.snow, 0.35) : p.color;
	const spread = 0.55 + open * 0.3;

	const out: Shape[] = [
		{
			kind: 'path',
			d: quadPath({ x: 0, y: 0 }, { x: s * 0.06, y: -h * 0.6 }, { x: 0, y: -h }),
			stroke: layout.ink.stem,
			strokeWidth: Math.max(1, s * 0.075),
			round: true
		}
	];

	if (skin === 2) {
		// a single curled shoot rather than a symmetric pair
		out.push({
			kind: 'path',
			d: `M0 ${f(-h)}Q${f(s * 0.42)} ${f(-h - s * 0.2)} ${f(s * 0.2)} ${f(-h - s * 0.34)}Q${f(s * 0.02)} ${f(-h - s * 0.42)} ${f(s * 0.12)} ${f(-h - s * 0.18)}Z`,
			fill: leaf
		});
		return out;
	}

	const leaves = skin === 1 ? 3 : 2;
	for (let i = 0; i < leaves; i++) {
		const side = leaves === 3 ? i - 1 : i === 0 ? -1 : 1;
		out.push({
			kind: 'ellipse',
			cx: side * s * 0.22,
			cy: -h - s * (side === 0 ? 0.16 : 0.04),
			rx: s * 0.24,
			ry: s * 0.11,
			rotate: side * -spread * (180 / Math.PI),
			fill: leaf
		});
	}
	for (const side of [-1, 1]) {
		out.push({
			kind: 'path',
			d: linePath(0, -h, side * s * 0.4, -h - s * 0.12),
			stroke: shadeHex(leaf, 0.35),
			strokeAlpha: 0.7,
			strokeWidth: Math.max(0.6, s * 0.03)
		});
	}

	return out;
}

function birdShapes(b: Brush): { shapes: Shape[]; at: Point } {
	const { p, s, layout, motion } = b;
	const skin = p.el.skin;
	const span = layout.width + s * 8;
	const drift = motion.animate ? motion.time * 0.014 * p.dir : 0;
	let x = ((((p.x + drift) % span) + span) % span) - s * 4;
	let y = p.y + (motion.animate ? Math.sin(motion.time * 0.0018 + p.phase) * s * 0.3 : 0);

	const takeoff = motion.startled?.get(p.key);
	if (takeoff !== undefined) {
		// up quickly, back down slowly, so the entry can expire without a snap
		const e = Math.min(1, (motion.time - takeoff) / STARTLE_MS);
		const k = motion.animate ? Math.sin(e * Math.PI) ** 0.7 : 1;
		y -= k * layout.height * 0.2;
		x += k * s * 3 * p.dir;
	}

	const flap = motion.animate ? Math.sin(motion.time * 0.012 + p.phase) * 0.5 + 0.5 : 0.62;
	const wing = s * 0.8;
	const rise = wing * (0.26 + flap * 0.5);
	const stroke = mixHex(layout.ink.silhouette, p.color, 0.35);
	const weight = Math.max(1.3, s * 0.14);

	const arc = (cx: number, cy: number, scale: number) =>
		`M${f(cx - wing * scale)} ${f(cy)}Q${f(cx - wing * 0.32 * scale)} ${f(cy - rise * scale)} ${f(cx)} ${f(cy - rise * 0.18 * scale)}Q${f(cx + wing * 0.32 * scale)} ${f(cy - rise * scale)} ${f(cx + wing * scale)} ${f(cy)}`;

	const shapes: Shape[] = [
		{ kind: 'path', d: arc(0, 0, 1), stroke, strokeWidth: weight, round: true }
	];
	if (skin === 1) {
		shapes.push({
			kind: 'path',
			d: linePath(0, -rise * 0.18, -p.dir * wing * 0.3, rise * 0.2),
			stroke,
			strokeWidth: weight * 0.7,
			round: true
		});
	} else if (skin === 2) {
		shapes.push({
			kind: 'path',
			d: arc(wing * 1.5, s * 0.5, 0.6),
			stroke,
			strokeAlpha: 0.8,
			strokeWidth: weight * 0.8,
			round: true
		});
	}

	return { shapes: [{ kind: 'group', x, y, children: shapes }], at: { x, y } };
}

function kiteShapes(b: Brush): { shapes: Shape[]; at: Point } {
	const { p, s, layout, motion } = b;
	const skin = p.el.skin;
	const bob = motion.animate ? Math.sin(motion.time * 0.0011 + p.phase) * s * 0.35 : 0;
	const tilt = motion.animate ? Math.sin(motion.time * 0.0009 + p.phase) * 0.16 : 0;
	const x = p.x;
	const y = p.y + bob;
	// a kite is a diamond, so its drawn height is 2h; half the unit keeps it from
	// dwarfing everything on the ground
	const w = s * 0.34;
	const h = s * 0.5;

	const sail: Shape[] = [];
	if (skin === 1) {
		// delta: a swept triangle
		sail.push(
			{
				kind: 'path',
				d: polylinePath(
					[
						{ x: 0, y: -h },
						{ x: w * 1.2, y: h * 0.5 },
						{ x: -w * 1.2, y: h * 0.5 }
					],
					true
				),
				fill: p.color
			},
			{
				kind: 'path',
				d: linePath(0, -h, 0, h * 0.5),
				stroke: shadeHex(p.color, -0.42),
				strokeAlpha: 0.7,
				strokeWidth: Math.max(0.8, s * 0.05)
			}
		);
	} else if (skin === 2) {
		// box: two braced cells with an open gap between them
		const cell = h * 0.66;
		const gap = h * 0.28;
		sail.push(
			{ kind: 'rect', x: -w * 0.8, y: -h, w: w * 1.6, h: cell, fill: p.color },
			{
				kind: 'rect',
				x: -w * 0.8,
				y: -h + cell + gap,
				w: w * 1.6,
				h: cell,
				fill: shadeHex(p.color, -0.24)
			},
			{
				kind: 'path',
				d:
					`${linePath(-w * 0.8, -h, -w * 0.8, -h + cell * 2 + gap)}` +
					`${linePath(w * 0.8, -h, w * 0.8, -h + cell * 2 + gap)}` +
					`${linePath(-w * 0.8, -h, w * 0.8, -h + cell)}` +
					`${linePath(-w * 0.8, -h + cell + gap, w * 0.8, -h + cell * 2 + gap)}`,
				stroke: shadeHex(p.color, -0.5),
				strokeAlpha: 0.75,
				strokeWidth: Math.max(0.8, s * 0.045)
			}
		);
	} else {
		sail.push(
			{
				kind: 'path',
				d: polylinePath(
					[
						{ x: 0, y: -h },
						{ x: w, y: 0 },
						{ x: 0, y: h },
						{ x: -w, y: 0 }
					],
					true
				),
				fill: p.color
			},
			{
				kind: 'path',
				d: polylinePath(
					[
						{ x: 0, y: -h },
						{ x: w, y: 0 },
						{ x: 0, y: h }
					],
					true
				),
				fill: shadeHex(p.color, -0.24)
			},
			{
				kind: 'path',
				d: `${linePath(0, -h, 0, h)}${linePath(-w, 0, w, 0)}`,
				stroke: shadeHex(p.color, -0.42),
				strokeAlpha: 0.7,
				strokeWidth: Math.max(0.8, s * 0.05)
			}
		);
	}

	for (let i = 1; i <= 3; i++) {
		const wag = motion.animate ? motion.time * 0.003 : 0;
		const tx = Math.sin(i * 1.2 + wag) * s * 0.22;
		sail.push({
			kind: 'ellipse',
			cx: tx,
			cy: h + i * s * 0.3,
			rx: s * 0.1,
			ry: s * 0.05,
			fill: shadeHex(p.color, 0.32)
		});
	}

	return {
		shapes: [
			{
				kind: 'path',
				d: quadPath(
					{ x, y: y + h },
					{ x: x - s * 1.4, y: (y + layout.groundY) / 2 },
					{ x: x - s * 0.5, y: layout.groundY + (layout.height - layout.groundY) * 0.12 }
				),
				stroke: layout.ink.rope,
				strokeAlpha: 0.35,
				strokeWidth: 1
			},
			{
				kind: 'group',
				x,
				y,
				rotate: ((tilt + (p.el.rotation * Math.PI) / 180) * 180) / Math.PI,
				children: sail
			}
		],
		at: { x, y }
	};
}

function sparkleShapes(at: Point, s: number, layout: SceneLayout, motion: SceneMotion): Shape[] {
	const spin = motion.animate ? motion.time * 0.0012 : 0.4;
	const out: Shape[] = [];
	for (let i = 0; i < 4; i++) {
		const angle = (i / 4) * TAU + spin;
		const d = s * (1.1 + Math.sin(spin * 2 + i) * 0.12);
		out.push({
			kind: 'circle',
			cx: at.x + Math.cos(angle) * d,
			cy: at.y + Math.sin(angle) * d * 0.6,
			r: Math.max(1, s * 0.08),
			fill: layout.palette.light,
			fillAlpha: 0.5
		});
	}
	return out;
}

const SPECIES_BRUSHES: Record<Species, (b: Brush) => Shape[]> = {
	tree: treeShapes,
	shrub: shrubShapes,
	flower: flowerShapes,
	grass: grassShapes,
	rock: rockShapes,
	water: waterShapes,
	lantern: lanternShapes,
	swing: swingShapes,
	tent: tentShapes,
	sprout: sproutShapes,
	bird: () => [],
	kite: () => []
};

function elementShapes(
	scene: PlaygroundScene,
	layout: SceneLayout,
	motion: SceneMotion,
	p: PlacedElement
): { shapes: Shape[]; at: Point } {
	const s = Math.max(2, p.size * motion.bloom);
	const brush: Brush = { scene, layout, motion, p, s };

	if (p.el.species === 'bird') return birdShapes(brush);
	if (p.el.species === 'kite') return kiteShapes(brush);

	const sway = motion.animate
		? Math.sin(motion.time * 0.0009 + p.phase) * 0.04 * SWAY[p.el.species]
		: 0;
	const children: Shape[] = [];

	if (p.el.species !== 'water') {
		children.push({
			kind: 'ellipse',
			// the shadow leans away from the light, so lightAngle reads on the ground
			cx: -layout.lightX * s * 0.14,
			cy: 0,
			rx: s * 0.48,
			ry: s * 0.12,
			fill: layout.palette.groundShadow,
			fillAlpha: 0.26
		});
	}

	const rotate = (((p.el.rotation * Math.PI) / 180) * TILT[p.el.species] + sway) * (180 / Math.PI);
	children.push({
		kind: 'group',
		rotate,
		children: (SPECIES_BRUSHES[p.el.species] ?? treeShapes)(brush)
	});

	return {
		shapes: [{ kind: 'group', x: p.x, y: p.y, children }],
		at: { x: p.x, y: p.y - s * 0.7 }
	};
}

// #endregion

// #region frame

function has(scene: PlaygroundScene, biome: Biome): boolean {
	return scene.biomes.includes(biome);
}

function rippleShapes(layout: SceneLayout, motion: SceneMotion): Shape[] {
	if (!motion.ripples?.length) return [];
	return motion.ripples.flatMap((ripple) => {
		const k = (motion.time - ripple.start) / RIPPLE_MS;
		if (k < 0 || k >= 1) return [];
		const r = 8 + k * 34;
		return [
			{
				kind: 'ellipse' as const,
				cx: ripple.x,
				cy: ripple.y,
				rx: r,
				ry: r * 0.42,
				stroke: layout.palette.light,
				strokeAlpha: (1 - k) * 0.5,
				strokeWidth: 1.4
			}
		];
	});
}

/** the whole frame as data; both backends consume exactly this */
export function sceneShapes(
	scene: PlaygroundScene,
	layout: SceneLayout,
	motion: SceneMotion = SETTLED_MOTION
): Shape[] {
	const out: Shape[] = [...skyShapes(layout, motion)];

	out.push(...(scene.timeOfDay === 'night' ? moonShapes(scene, layout) : sunShapes(scene, layout)));
	if (scene.traits.motif === 'flock') out.push(...motifShapes(scene, layout, motion));
	if (has(scene, 'ridge')) out.push(...ridgeShapes(layout));
	if (has(scene, 'grove')) out.push(...groveShapes(scene, layout));
	out.push(...groundShapes(layout));
	// the pond sits on the ground rather than behind it, so it lands after the fill
	if (has(scene, 'pond')) out.push(...pondShapes(scene, layout, motion));
	if (scene.traits.motif === 'low_mist') out.push(...motifShapes(scene, layout, motion));

	for (const p of layout.elements) {
		const drawn = elementShapes(scene, layout, motion, p);
		out.push(...drawn.shapes);
		if (p.surprise) out.push(...sparkleShapes(drawn.at, p.size * motion.bloom, layout, motion));
	}

	if (scene.traits.motif === 'fireflies' || scene.traits.motif === 'drifting_seeds') {
		out.push(...motifShapes(scene, layout, motion));
	}
	out.push(...rippleShapes(layout, motion));
	out.push(vignetteShape(layout));

	return out;
}

// #endregion

// #region canvas backend

function canvasGradient(c: CanvasRenderingContext2D, g: Gradient): CanvasGradient {
	const grad =
		g.kind === 'linear'
			? c.createLinearGradient(g.x1, g.y1, g.x2, g.y2)
			: c.createRadialGradient(g.x1, g.y1, g.r1 ?? 0, g.x2, g.y2, g.r2 ?? 1);
	for (const stop of g.stops) {
		grad.addColorStop(
			Math.min(1, Math.max(0, stop.at)),
			stop.alpha === undefined ? stop.color : rgbaCss(stop.color, stop.alpha)
		);
	}
	return grad;
}

function tracePath(c: CanvasRenderingContext2D, shape: Shape) {
	switch (shape.kind) {
		case 'rect':
			c.beginPath();
			c.rect(shape.x, shape.y, shape.w, shape.h);
			break;
		case 'circle':
			c.beginPath();
			c.arc(shape.cx, shape.cy, Math.max(0, shape.r), 0, TAU);
			break;
		case 'ellipse':
			c.beginPath();
			c.ellipse(
				shape.cx,
				shape.cy,
				Math.max(0, shape.rx),
				Math.max(0, shape.ry),
				((shape.rotate ?? 0) * Math.PI) / 180,
				0,
				TAU
			);
			break;
		case 'path':
			c.beginPath();
			break;
		default:
			break;
	}
}

export function paintShapes(c: CanvasRenderingContext2D, shapes: readonly Shape[]) {
	for (const shape of shapes) {
		if (shape.kind === 'group') {
			c.save();
			if (shape.x || shape.y) c.translate(shape.x ?? 0, shape.y ?? 0);
			if (shape.rotate) c.rotate((shape.rotate * Math.PI) / 180);
			if (shape.alpha !== undefined) c.globalAlpha *= shape.alpha;
			if (shape.clip) c.clip(new Path2D(shape.clip));
			paintShapes(c, shape.children);
			c.restore();
			continue;
		}

		const geometry = shape.kind === 'path' ? new Path2D(shape.d) : null;
		if (!geometry) tracePath(c, shape);

		if (shape.fill !== undefined) {
			// a flat fill folds its alpha into the colour; only a gradient has to reach for
			// globalAlpha, and then it multiplies whatever the enclosing group set
			const gradient = typeof shape.fill !== 'string';
			const prior = c.globalAlpha;
			if (gradient && shape.fillAlpha !== undefined) c.globalAlpha = prior * shape.fillAlpha;
			c.fillStyle = gradient
				? canvasGradient(c, shape.fill as Gradient)
				: shape.fillAlpha === undefined
					? (shape.fill as string)
					: rgbaCss(shape.fill as string, shape.fillAlpha);
			if (geometry) c.fill(geometry);
			else c.fill();
			c.globalAlpha = prior;
		}

		if (shape.stroke !== undefined) {
			c.strokeStyle =
				shape.strokeAlpha === undefined ? shape.stroke : rgbaCss(shape.stroke, shape.strokeAlpha);
			c.lineWidth = shape.strokeWidth ?? 1;
			c.lineCap = shape.round ? 'round' : 'butt';
			c.lineJoin = shape.round ? 'round' : 'miter';
			if (geometry) c.stroke(geometry);
			else c.stroke();
		}
	}
}

// #endregion

// #region svg backend

function escapeXml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

class GradientRegistry {
	private readonly ids = new Map<string, string>();
	readonly defs: string[] = [];

	ref(g: Gradient): string {
		const key = JSON.stringify(g);
		const existing = this.ids.get(key);
		if (existing) return existing;

		const id = `pg${this.ids.size}`;
		this.ids.set(key, id);

		// SVG radial gradients have no inner radius, so an inner circle folds into the
		// stop offsets instead; the focal point carries the offset centre
		const inner = g.kind === 'radial' ? (g.r1 ?? 0) / Math.max(1e-6, g.r2 ?? 1) : 0;
		const stops = g.stops
			.map((stop) => {
				const at = g.kind === 'radial' ? inner + stop.at * (1 - inner) : stop.at;
				const alpha = stop.alpha === undefined ? '' : ` stop-opacity="${f(stop.alpha)}"`;
				return `<stop offset="${f(Math.min(1, Math.max(0, at)))}" stop-color="${stop.color}"${alpha}/>`;
			})
			.join('');

		this.defs.push(
			g.kind === 'linear'
				? `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${f(g.x1)}" y1="${f(g.y1)}" x2="${f(g.x2)}" y2="${f(g.y2)}">${stops}</linearGradient>`
				: `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${f(g.x2)}" cy="${f(g.y2)}" r="${f(g.r2 ?? 1)}" fx="${f(g.x1)}" fy="${f(g.y1)}">${stops}</radialGradient>`
		);
		return id;
	}

	clip(d: string): string {
		const key = `clip:${d}`;
		const existing = this.ids.get(key);
		if (existing) return existing;
		const id = `pg${this.ids.size}`;
		this.ids.set(key, id);
		this.defs.push(`<clipPath id="${id}"><path d="${d}"/></clipPath>`);
		return id;
	}
}

function styleAttrs(
	shape: Shape & { kind: 'rect' | 'circle' | 'ellipse' | 'path' },
	defs: GradientRegistry
): string {
	let out = '';
	if (shape.fill === undefined) out += ' fill="none"';
	else if (typeof shape.fill === 'string') out += ` fill="${shape.fill}"`;
	else out += ` fill="url(#${defs.ref(shape.fill)})"`;
	if (shape.fillAlpha !== undefined) out += ` fill-opacity="${f(shape.fillAlpha)}"`;
	if (shape.stroke !== undefined) {
		out += ` stroke="${shape.stroke}" stroke-width="${f(shape.strokeWidth ?? 1)}"`;
		if (shape.strokeAlpha !== undefined) out += ` stroke-opacity="${f(shape.strokeAlpha)}"`;
		if (shape.round) out += ' stroke-linecap="round" stroke-linejoin="round"';
	}
	return out;
}

function shapeToSvg(shape: Shape, defs: GradientRegistry): string {
	if (shape.kind === 'group') {
		const transform: string[] = [];
		if (shape.x || shape.y) transform.push(`translate(${f(shape.x ?? 0)} ${f(shape.y ?? 0)})`);
		if (shape.rotate) transform.push(`rotate(${f(shape.rotate)})`);
		let attrs = transform.length ? ` transform="${transform.join(' ')}"` : '';
		if (shape.alpha !== undefined) attrs += ` opacity="${f(shape.alpha)}"`;
		if (shape.clip) attrs += ` clip-path="url(#${defs.clip(shape.clip)})"`;
		return `<g${attrs}>${shape.children.map((child) => shapeToSvg(child, defs)).join('')}</g>`;
	}

	const style = styleAttrs(shape, defs);
	switch (shape.kind) {
		case 'rect':
			return `<rect x="${f(shape.x)}" y="${f(shape.y)}" width="${f(Math.max(0, shape.w))}" height="${f(Math.max(0, shape.h))}"${style}/>`;
		case 'circle':
			return `<circle cx="${f(shape.cx)}" cy="${f(shape.cy)}" r="${f(Math.max(0, shape.r))}"${style}/>`;
		case 'ellipse': {
			const spin = shape.rotate
				? ` transform="rotate(${f(shape.rotate)} ${f(shape.cx)} ${f(shape.cy)})"`
				: '';
			return `<ellipse cx="${f(shape.cx)}" cy="${f(shape.cy)}" rx="${f(Math.max(0, shape.rx))}" ry="${f(Math.max(0, shape.ry))}"${spin}${style}/>`;
		}
		default:
			return `<path d="${shape.d}"${style}/>`;
	}
}

export interface SceneSvgOptions {
	/** viewBox size; the scene lays itself out in these units */
	width?: number;
	height?: number;
	/** an SVG <title>, for assistive tech; omitted when blank */
	title?: string;
	/** corner radius on the frame clip */
	radius?: number;
}

/**
 * The scene as real vector output.
 *
 * Self-contained by construction: no external fonts, no raster `<image>` fallback, no
 * script. The same shape data the canvas paints is serialised here, so an export is the
 * picture on screen rather than a second drawing of it.
 */
export function sceneToSvg(scene: PlaygroundScene, options: SceneSvgOptions = {}): string {
	const width = Math.max(1, Math.round(options.width ?? 640));
	const height = Math.max(1, Math.round(options.height ?? 360));
	const radius = Math.max(0, options.radius ?? 0);

	const layout = layoutScene(scene, { width, height });
	const shapes = sceneShapes(scene, layout, SETTLED_MOTION);

	const defs = new GradientRegistry();
	// serialise the body first so every gradient and clip is registered before <defs>
	const body = shapes.map((shape) => shapeToSvg(shape, defs)).join('');
	const frameId = 'pgframe';
	const frame = `<clipPath id="${frameId}"><rect x="0" y="0" width="${width}" height="${height}" rx="${f(radius)}" ry="${f(radius)}"/></clipPath>`;
	const title = options.title ? `<title>${escapeXml(options.title)}</title>` : '';

	return (
		`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
		`viewBox="0 0 ${width} ${height}" role="img">` +
		title +
		`<defs>${frame}${defs.defs.join('')}</defs>` +
		`<g clip-path="url(#${frameId})">${body}</g>` +
		`</svg>`
	);
}

// #endregion

// #region hit testing

export interface SceneHit {
	key: string;
	species: Species;
	category: NudgeCategory;
}

/** the nearest element to a tap, or null when the tap landed on open ground */
export function hitTest(layout: SceneLayout, x: number, y: number): SceneHit | null {
	let best: PlacedElement | null = null;
	let bestDistance = Number.POSITIVE_INFINITY;

	for (const p of layout.elements) {
		const cy = isSkySpecies(p.el.species) ? p.y : p.y - p.size * 0.7;
		const distance = Math.hypot(p.x - x, cy - y);
		if (distance < Math.max(22, p.size * 1.1) && distance < bestDistance) {
			bestDistance = distance;
			best = p;
		}
	}

	return best ? { key: best.key, species: best.el.species, category: best.el.category } : null;
}

// #endregion
