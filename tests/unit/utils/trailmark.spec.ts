import { describe, expect, it } from 'vitest';
import { GRID_METRES, distanceMetres, snapToGrid } from '~/utils/geo';
import { SHARE_PREFIX } from '~/utils/qr';
import {
	TRAILMARK_PREFIX,
	TrailmarkError,
	decodeTrailmark,
	encodeTrailmark,
	isTrailmark,
	trailmarkBytes,
	type Trailmark
} from '~/utils/trailmark';

const TODAY = '2026-08-01';
const YESTERDAY = '2026-07-31';

function mark(overrides: Partial<Trailmark> = {}): Trailmark {
	return {
		nudgeId: 'nature.notice.first_bird',
		latitude: 41.8819,
		longitude: -87.6278,
		affordances: ['sit', 'green'],
		day: TODAY,
		...overrides
	};
}

describe('encode and decode', () => {
	it('round-trips every field', () => {
		const decoded = decodeTrailmark(encodeTrailmark(mark()), TODAY);

		expect(decoded.nudgeId).toBe('nature.notice.first_bird');
		expect(decoded.affordances).toEqual(['sit', 'green']);
		expect(decoded.fresh).toBe(true);
	});

	it('carries a position back within one grid cell', () => {
		const original = mark();
		const decoded = decodeTrailmark(encodeTrailmark(original), TODAY);

		expect(
			distanceMetres(decoded, { latitude: original.latitude, longitude: original.longitude })
		).toBeLessThan(GRID_METRES);
	});

	// the code must not be a finer pointer than anything else in the app
	it('snaps the position, so it cannot leak more than the grid', () => {
		const decoded = decodeTrailmark(encodeTrailmark(mark()), TODAY);
		expect(decoded).toEqual(expect.objectContaining(snapToGrid(41.8819, -87.6278)));
	});

	it('collapses two positions in the same cell to the same code', () => {
		const a = encodeTrailmark(mark({ latitude: 41.8819, longitude: -87.6278 }));
		const b = encodeTrailmark(mark({ latitude: 41.88192, longitude: -87.62783 }));
		expect(a).toBe(b);
	});

	it.each([
		['the equator', 0, 0],
		['far south', -33.8688, 151.2093],
		['far north', 64.1466, -21.9426],
		['across the antimeridian', -16.5, 179.9],
		['negative longitude', 51.5074, -0.1278]
	])('round-trips %s', (_label, latitude, longitude) => {
		const decoded = decodeTrailmark(encodeTrailmark(mark({ latitude, longitude })), TODAY);
		expect(distanceMetres(decoded, { latitude, longitude })).toBeLessThan(GRID_METRES);
	});

	it('handles a mark with no affordances at all', () => {
		const decoded = decodeTrailmark(encodeTrailmark(mark({ affordances: [] })), TODAY);
		expect(decoded.affordances).toEqual([]);
	});

	it('keeps affordances in vocabulary order however they were listed', () => {
		const decoded = decodeTrailmark(
			encodeTrailmark(mark({ affordances: ['old', 'sit', 'green'] })),
			TODAY
		);
		expect(decoded.affordances).toEqual(['sit', 'green', 'old']);
	});
});

describe('the envelope', () => {
	it('uses its own prefix, not the scene code one', () => {
		expect(encodeTrailmark(mark()).startsWith(TRAILMARK_PREFIX)).toBe(true);
		expect(TRAILMARK_PREFIX).not.toBe(SHARE_PREFIX);
	});

	/**
	 * The reason for a separate prefix rather than a kind tag inside `RC1:`. A scene code the
	 * user already exported has to keep decoding to the picture they saw, and it cannot if the
	 * first field's meaning changed underneath it.
	 */
	it('does not claim a scene code, and a scene code does not claim it', () => {
		expect(isTrailmark(`${SHARE_PREFIX}ABCDEF`)).toBe(false);
		expect(isTrailmark(encodeTrailmark(mark()))).toBe(true);
	});

	it.each([
		['a scene code', 'RC1:ABCDEF'],
		['plain text', 'hello'],
		['an empty string', ''],
		['a url', 'https://example.com']
	])('refuses %s', (_label, text) => {
		expect(() => decodeTrailmark(text, TODAY)).toThrow(TrailmarkError);
	});

	it('refuses a truncated payload rather than returning nonsense', () => {
		const code = encodeTrailmark(mark());
		expect(() => decodeTrailmark(code.slice(0, code.length - 9), TODAY)).toThrow(TrailmarkError);
	});

	it('refuses characters outside the base45 alphabet', () => {
		expect(() => decodeTrailmark(`${TRAILMARK_PREFIX}!!!!!!`, TODAY)).toThrow(TrailmarkError);
	});
});

describe('the one-day bound', () => {
	it('is fresh on the day it was made', () => {
		expect(decodeTrailmark(encodeTrailmark(mark()), TODAY).fresh).toBe(true);
	});

	it('is still fresh the next morning, so an overnight handoff survives', () => {
		expect(decodeTrailmark(encodeTrailmark(mark({ day: YESTERDAY })), TODAY).fresh).toBe(true);
	});

	// a code that works forever is a durable pointer to somewhere a real person goes
	it('goes stale after that', () => {
		expect(decodeTrailmark(encodeTrailmark(mark({ day: '2026-07-20' })), TODAY).fresh).toBe(false);
	});

	it('reports staleness rather than throwing, so the UI can explain it', () => {
		const decoded = decodeTrailmark(encodeTrailmark(mark({ day: '2026-01-01' })), TODAY);
		expect(decoded.fresh).toBe(false);
		expect(decoded.nudgeId).toBe('nature.notice.first_bird');
	});
});

describe('size', () => {
	it('stays far inside a scannable QR', () => {
		const code = encodeTrailmark(mark());
		// a v7 QR in alphanumeric mode holds well over 100 characters
		expect(code.length).toBeLessThan(80);
	});

	it('reports its own byte size', () => {
		expect(trailmarkBytes('nature.notice.first_bird'.length)).toBeGreaterThan(0);
		expect(trailmarkBytes(24)).toBeLessThan(40);
	});

	it('refuses an id too long to pack rather than truncating it', () => {
		expect(() => encodeTrailmark(mark({ nudgeId: 'x'.repeat(200) }))).toThrow(TrailmarkError);
	});

	it('refuses an empty id', () => {
		expect(() => encodeTrailmark(mark({ nudgeId: '' }))).toThrow(TrailmarkError);
	});
});
