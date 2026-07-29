import colors from '~/data/colors.json';

export interface Rgba {
	r: number;
	g: number;
	b: number;
	a: number;
}

const ALIASES = colors;

export function colorAliases(): Record<string, string> {
	return ALIASES;
}

const clampByte = (n: number) => Math.min(255, Math.max(0, Math.round(n)));
const clampAlpha = (n: number) => Math.min(1, Math.max(0, n));

function parseHex(hex: string): Rgba | null {
	const body = hex.slice(1);
	// parseInt happily returns NaN for non-hex characters, so gate on the charset
	if (!/^[0-9a-fA-F]+$/.test(body)) return null;

	const expand = (chars: string) => Number.parseInt(chars.repeat(2 / chars.length), 16);

	if (body.length === 3 || body.length === 4) {
		const [r, g, b, a] = body.split('') as [string, string, string, string?];
		return {
			r: expand(r),
			g: expand(g),
			b: expand(b),
			a: a === undefined ? 1 : expand(a) / 255
		};
	}

	if (body.length === 6 || body.length === 8) {
		return {
			r: Number.parseInt(body.slice(0, 2), 16),
			g: Number.parseInt(body.slice(2, 4), 16),
			b: Number.parseInt(body.slice(4, 6), 16),
			a: body.length === 8 ? Number.parseInt(body.slice(6, 8), 16) / 255 : 1
		};
	}

	return null;
}

// deliberately looser than colorTokenSchema: the schema is the authoring gate,
// this is the runtime resolver, and clamping beats returning null at paint time.
// accepts both the legacy comma form and the modern space form, because toCss
// emits the space form and mix() would otherwise not be composable with itself.
function parseFunctional(value: string): Rgba | null {
	const match =
		/^rgba?\(\s*(-?[\d.]+)(?:\s*,\s*|\s+)(-?[\d.]+)(?:\s*,\s*|\s+)(-?[\d.]+)\s*(?:(?:,|\/)\s*(-?[\d.]+)\s*)?\)$/.exec(
			value
		);
	if (!match) return null;

	const [, r, g, b, a] = match;
	const channels = [Number(r), Number(g), Number(b)];
	if (channels.some((channel) => !Number.isFinite(channel))) return null;

	const alpha = a === undefined ? 1 : Number(a);
	if (!Number.isFinite(alpha)) return null;

	return {
		r: clampByte(channels[0] as number),
		g: clampByte(channels[1] as number),
		b: clampByte(channels[2] as number),
		a: clampAlpha(alpha)
	};
}

/**
 * resolve an authored color token into rgba. accepts `@alias`, `#rgb`, `#rgba`,
 * `#rrggbb`, `#rrggbbaa`, `rgb(...)` and `rgba(...)`. returns null on anything
 * unparseable so callers can fall back rather than render a broken swatch.
 */
export function parseColor(token: string | null | undefined): Rgba | null {
	if (typeof token !== 'string') return null;
	const raw = token.trim();
	if (raw.length === 0) return null;

	if (raw.startsWith('@')) {
		// through the accessor, because ALIASES itself is literal-keyed rather than indexed
		const alias = colorAliases()[raw.slice(1)];
		// one level of indirection only; aliases resolve to literals, never to other aliases
		return alias ? parseColor(alias) : null;
	}

	if (raw.startsWith('#')) return parseHex(raw);
	if (raw.startsWith('rgb')) return parseFunctional(raw);
	return null;
}

export function toCss(color: Rgba): string {
	return color.a >= 1
		? `rgb(${color.r} ${color.g} ${color.b})`
		: `rgb(${color.r} ${color.g} ${color.b} / ${Number(color.a.toFixed(3))})`;
}

export function toHex(color: Rgba): string {
	const hex = (n: number) => clampByte(n).toString(16).padStart(2, '0');
	const base = `#${hex(color.r)}${hex(color.g)}${hex(color.b)}`;
	return color.a >= 1 ? base : `${base}${hex(color.a * 255)}`;
}

/** resolve straight to a css string, falling back when the token is unusable */
export function resolveColor(token: string | null | undefined, fallback = '#2d9973'): string {
	const parsed = parseColor(token);
	return parsed ? toCss(parsed) : fallback;
}

export function withAlpha(token: string | null | undefined, alpha: number): string {
	const parsed = parseColor(token);
	if (!parsed) return 'transparent';
	return toCss({ ...parsed, a: clampAlpha(alpha) });
}

/** linear mix in srgb; `amount` 0 keeps `a`, 1 becomes `b` */
export function mix(a: string, b: string, amount: number): string {
	const from = parseColor(a);
	const to = parseColor(b);
	if (!from || !to) return resolveColor(a);

	const t = clampAlpha(amount);
	return toCss({
		r: clampByte(from.r + (to.r - from.r) * t),
		g: clampByte(from.g + (to.g - from.g) * t),
		b: clampByte(from.b + (to.b - from.b) * t),
		a: from.a + (to.a - from.a) * t
	});
}

/** WCAG relative luminance */
export function luminance(color: Rgba): number {
	const channel = (v: number) => {
		const s = v / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

/** black or white, whichever reads better on the token */
export function readableOn(token: string | null | undefined): '#000000' | '#ffffff' {
	const parsed = parseColor(token);
	if (!parsed) return '#ffffff';
	return luminance(parsed) > 0.45 ? '#000000' : '#ffffff';
}

/** the css custom properties a nudge surface paints itself from */
export function nudgeColorVars(token: string | null | undefined): Record<string, string> {
	return {
		'--nudge-accent': resolveColor(token),
		'--nudge-accent-soft': withAlpha(token, 0.15),
		'--nudge-accent-strong': mix(resolveColor(token), '#000000', 0.25),
		'--nudge-on-accent': readableOn(token)
	};
}
