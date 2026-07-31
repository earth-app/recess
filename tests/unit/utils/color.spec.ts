import { describe, expect, it } from 'vitest';
import {
	luminance,
	mix,
	nudgeColorVars,
	parseColor,
	readableOn,
	resolveColor,
	toCss,
	toHex,
	withAlpha
} from '~/utils/color';

describe('parseColor', () => {
	it('resolves an alias from colors.json', () => {
		expect(parseColor('@green')).toEqual({ r: 0x2d, g: 0x99, b: 0x73, a: 1 });
	});

	it('resolves an alias that carries alpha', () => {
		const parsed = parseColor('@black_50');
		expect(parsed?.r).toBe(0);
		expect(parsed?.a).toBeCloseTo(0x50 / 255, 3);
	});

	it('parses 6-digit hex', () => {
		expect(parseColor('#3498db')).toEqual({ r: 0x34, g: 0x98, b: 0xdb, a: 1 });
	});

	it('parses 8-digit hex with alpha', () => {
		const parsed = parseColor('#3498db80');
		expect(parsed?.a).toBeCloseTo(128 / 255, 2);
	});

	it('expands 3-digit hex', () => {
		expect(parseColor('#0f8')).toEqual({ r: 0x00, g: 0xff, b: 0x88, a: 1 });
	});

	it('expands 4-digit hex with alpha', () => {
		const parsed = parseColor('#0f8f');
		expect(parsed).toMatchObject({ r: 0, g: 255, b: 136 });
		expect(parsed?.a).toBe(1);
	});

	it('parses rgb()', () => {
		expect(parseColor('rgb(52, 152, 219)')).toEqual({ r: 52, g: 152, b: 219, a: 1 });
	});

	it('parses rgba() including a fractional alpha', () => {
		expect(parseColor('rgba(52, 152, 219, 0.5)')).toEqual({ r: 52, g: 152, b: 219, a: 0.5 });
	});

	it('tolerates loose whitespace', () => {
		expect(parseColor('  rgb(1,2,3)  ')).toEqual({ r: 1, g: 2, b: 3, a: 1 });
	});

	it('clamps out-of-range channels', () => {
		expect(parseColor('rgb(300, -20, 999)')).toEqual({ r: 255, g: 0, b: 255, a: 1 });
	});

	it('clamps an out-of-range alpha', () => {
		expect(parseColor('rgba(0,0,0,5)')?.a).toBe(1);
	});

	it('is case-insensitive on hex', () => {
		expect(parseColor('#ABCDEF')).toEqual(parseColor('#abcdef'));
	});

	it('returns null for an unknown alias', () => {
		expect(parseColor('@chartreuse')).toBeNull();
	});

	it('returns null for malformed input', () => {
		for (const bad of ['', '   ', 'green', '#12345', 'rgb(1,2)', 'hsl(1,2,3)', '#gggggg']) {
			expect(parseColor(bad)).toBeNull();
		}
	});

	it('returns null for non-strings', () => {
		expect(parseColor(null)).toBeNull();
		expect(parseColor(undefined)).toBeNull();
	});
});

describe('serialization', () => {
	it('omits the alpha channel when opaque', () => {
		expect(toCss({ r: 1, g: 2, b: 3, a: 1 })).toBe('rgb(1 2 3)');
	});

	it('includes a rounded alpha when translucent', () => {
		expect(toCss({ r: 1, g: 2, b: 3, a: 0.5 })).toBe('rgb(1 2 3 / 0.5)');
	});

	it('round-trips hex', () => {
		expect(toHex(parseColor('#3498db')!)).toBe('#3498db');
	});

	it('round-trips hex with alpha', () => {
		const hex = toHex(parseColor('rgba(52,152,219,0.5)')!);
		expect(hex).toHaveLength(9);
		expect(parseColor(hex)?.a).toBeCloseTo(0.5, 2);
	});
});

describe('resolveColor', () => {
	it('resolves a valid token', () => {
		expect(resolveColor('@blue')).toBe('rgb(52 152 219)');
	});

	it('falls back rather than rendering nothing', () => {
		expect(resolveColor('@nope')).toBe('#2d9973');
		expect(resolveColor('@nope', '#ff0000')).toBe('#ff0000');
	});
});

describe('withAlpha', () => {
	it('replaces the alpha channel', () => {
		expect(withAlpha('#3498db', 0.2)).toBe('rgb(52 152 219 / 0.2)');
	});

	it('clamps the requested alpha', () => {
		expect(withAlpha('#3498db', 9)).toBe('rgb(52 152 219)');
	});

	it('is transparent for an unusable token', () => {
		expect(withAlpha('nope', 0.5)).toBe('transparent');
	});
});

describe('mix', () => {
	it('returns the endpoints at 0 and 1', () => {
		expect(mix('#000000', '#ffffff', 0)).toBe('rgb(0 0 0)');
		expect(mix('#000000', '#ffffff', 1)).toBe('rgb(255 255 255)');
	});

	it('lands halfway at 0.5', () => {
		expect(mix('#000000', '#ffffff', 0.5)).toBe('rgb(128 128 128)');
	});

	it('clamps the amount', () => {
		expect(mix('#000000', '#ffffff', -3)).toBe('rgb(0 0 0)');
		expect(mix('#000000', '#ffffff', 3)).toBe('rgb(255 255 255)');
	});

	it('falls back to the first colour when the second is unusable', () => {
		expect(mix('#3498db', 'nope', 0.5)).toBe('rgb(52 152 219)');
	});
});

describe('readableOn', () => {
	it('picks black on light backgrounds', () => {
		expect(readableOn('#ffffff')).toBe('#000000');
		expect(readableOn('@gold')).toBe('#000000');
	});

	it('picks white on dark backgrounds', () => {
		expect(readableOn('#000000')).toBe('#ffffff');
		expect(readableOn('@brown')).toBe('#ffffff');
	});

	it('defaults to white when the token is unusable', () => {
		expect(readableOn('nope')).toBe('#ffffff');
	});

	it('orders luminance as expected', () => {
		expect(luminance(parseColor('#ffffff')!)).toBeGreaterThan(luminance(parseColor('#808080')!));
		expect(luminance(parseColor('#808080')!)).toBeGreaterThan(luminance(parseColor('#000000')!));
	});
});

describe('nudgeColorVars', () => {
	it('emits every custom property the sheet paints from', () => {
		const vars = nudgeColorVars('@green');
		expect(Object.keys(vars).sort()).toEqual([
			'--nudge-accent',
			'--nudge-accent-soft',
			'--nudge-accent-strong',
			'--nudge-on-accent'
		]);
	});

	it('makes the soft variant translucent', () => {
		expect(nudgeColorVars('@green')['--nudge-accent-soft']).toContain('/');
	});

	it('still emits usable values for a bad token', () => {
		const vars = nudgeColorVars('nope');
		expect(vars['--nudge-accent']).toBe('#2d9973');
		expect(vars['--nudge-on-accent']).toBe('#ffffff');
	});
});
