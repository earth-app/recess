import { describe, expect, it } from 'vitest';
import {
	DIGITIZED_DRIFT_MS,
	FRESHNESS_WINDOW_MS,
	checkFreshCapture,
	detectNonCameraSoftware,
	factsFromTags,
	parseExifDate,
	parseExifOffset
} from '~/utils/exif';

const NOW = Date.UTC(2026, 6, 27, 15, 0, 0);

/** an exif timestamp `minutes` before NOW */
function exifDate(minutesAgo: number): string {
	const d = new Date(NOW - minutesAgo * 60_000);
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${d.getUTCFullYear()}:${pad(d.getUTCMonth() + 1)}:${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

describe('parseExifDate', () => {
	it('parses the colon-separated exif format', () => {
		expect(parseExifDate('2026:07:27 15:00:00')).toBe(NOW);
	});

	it('accepts a T separator', () => {
		expect(parseExifDate('2026:07:27T15:00:00')).toBe(NOW);
	});

	it('is null for missing or malformed values', () => {
		for (const bad of [undefined, '', 'yesterday', '2026-07-27', '2026:07:27']) {
			expect(parseExifDate(bad as string | undefined)).toBeNull();
		}
	});
});

describe('parseExifOffset', () => {
	it('parses positive and negative offsets', () => {
		expect(parseExifOffset('+02:00')).toBe(2 * 3_600_000);
		expect(parseExifOffset('-05:30')).toBe(-(5 * 3_600_000 + 30 * 60_000));
	});

	it('is zero for missing or malformed values', () => {
		for (const bad of [undefined, '', 'Z', '02:00', '+2:00']) {
			expect(parseExifOffset(bad as string | undefined)).toBe(0);
		}
	});
});

describe('detectNonCameraSoftware', () => {
	it('flags editors, generators, screen recorders and 3D tools', () => {
		expect(detectNonCameraSoftware('Adobe Photoshop 26.0')).toContain('editor');
		expect(detectNonCameraSoftware('Stable Diffusion')).toContain('generator');
		expect(detectNonCameraSoftware('OBS 30.0')).toContain('recorder');
		expect(detectNonCameraSoftware('Blender 4.2')).toContain('3D');
	});

	it('is case-insensitive', () => {
		expect(detectNonCameraSoftware('MIDJOURNEY')).toBeTruthy();
	});

	it('does not flag a normal camera firmware string', () => {
		expect(detectNonCameraSoftware('18.5.1')).toBeNull();
		expect(detectNonCameraSoftware('iPhone 15 Pro 17.4')).toBeNull();
	});

	it('is null for a missing value', () => {
		expect(detectNonCameraSoftware(undefined)).toBeNull();
	});
});

describe('checkFreshCapture', () => {
	it('passes when there is no exif at all, since stripped captures are normal', () => {
		const result = checkFreshCapture(null, NOW);
		expect(result.ok).toBe(true);
		expect(result.missing).toBe(true);
	});

	it('passes a photo taken moments ago', () => {
		const result = checkFreshCapture({ dateTimeOriginal: exifDate(1), hasLensEvidence: true }, NOW);
		expect(result.ok).toBe(true);
		expect(result.missing).toBe(false);
	});

	it('rejects a photo from the library', () => {
		const result = checkFreshCapture(
			{ dateTimeOriginal: exifDate(60 * 24), hasLensEvidence: true },
			NOW
		);
		expect(result.ok).toBe(false);
		expect(result.reason).toContain('library');
	});

	it('accepts a photo right at the freshness boundary', () => {
		const atEdge = FRESHNESS_WINDOW_MS / 60_000;
		expect(
			checkFreshCapture({ dateTimeOriginal: exifDate(atEdge), hasLensEvidence: true }, NOW).ok
		).toBe(true);
	});

	it('rejects one minute past the boundary', () => {
		const past = FRESHNESS_WINDOW_MS / 60_000 + 1;
		expect(
			checkFreshCapture({ dateTimeOriginal: exifDate(past), hasLensEvidence: true }, NOW).ok
		).toBe(false);
	});

	it('applies the timezone offset before comparing', () => {
		// same instant, expressed in a +02:00 zone
		const shifted = new Date(NOW + 2 * 3_600_000);
		const pad = (n: number) => String(n).padStart(2, '0');
		const stamp = `${shifted.getUTCFullYear()}:${pad(shifted.getUTCMonth() + 1)}:${pad(shifted.getUTCDate())} ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:00`;

		expect(
			checkFreshCapture(
				{ dateTimeOriginal: stamp, offsetTimeOriginal: '+02:00', hasLensEvidence: true },
				NOW
			).ok
		).toBe(true);
	});

	it('rejects an edited photo before looking at the clock', () => {
		const result = checkFreshCapture(
			{ dateTimeOriginal: exifDate(1), software: 'Adobe Photoshop', hasLensEvidence: true },
			NOW
		);
		expect(result.ok).toBe(false);
		expect(result.reason).toContain('photo editor');
	});

	it('rejects a physically impossible zero focal length', () => {
		const result = checkFreshCapture(
			{ dateTimeOriginal: exifDate(1), focalLength: 0, hasLensEvidence: true },
			NOW
		);
		expect(result.ok).toBe(false);
		expect(result.reason).toContain('no lens');
	});

	it('rejects timestamps that disagree with each other', () => {
		const drift = DIGITIZED_DRIFT_MS / 60_000 + 5;
		const result = checkFreshCapture(
			{
				dateTimeOriginal: exifDate(1),
				dateTimeDigitized: exifDate(1 + drift),
				hasLensEvidence: true
			},
			NOW
		);
		expect(result.ok).toBe(false);
		expect(result.reason).toContain('disagree');
	});

	it('accepts a small digitized drift', () => {
		expect(
			checkFreshCapture(
				{ dateTimeOriginal: exifDate(1), dateTimeDigitized: exifDate(2), hasLensEvidence: true },
				NOW
			).ok
		).toBe(true);
	});

	it('treats an unparseable timestamp as simply absent', () => {
		const result = checkFreshCapture({ dateTimeOriginal: 'nonsense', hasLensEvidence: true }, NOW);
		expect(result.ok).toBe(true);
		expect(result.missing).toBe(true);
	});
});

describe('factsFromTags', () => {
	it('reads string tags from either description or value', () => {
		const facts = factsFromTags({
			DateTimeOriginal: { description: '2026:07:27 15:00:00' },
			Software: { value: 'Photoshop' },
			Make: { description: 'Apple' }
		});
		expect(facts.dateTimeOriginal).toBe('2026:07:27 15:00:00');
		expect(facts.software).toBe('Photoshop');
		expect(facts.make).toBe('Apple');
	});

	it('reads a rational focal length', () => {
		expect(factsFromTags({ FocalLength: { value: [50, 10] } }).focalLength).toBe(5);
	});

	it('reads a plain numeric focal length', () => {
		expect(factsFromTags({ FocalLength: { value: 24 } }).focalLength).toBe(24);
	});

	it('detects lens evidence from any of the optical tags', () => {
		expect(factsFromTags({ LensModel: { description: 'x' } }).hasLensEvidence).toBe(true);
		expect(factsFromTags({ ExposureTime: { value: 1 } }).hasLensEvidence).toBe(true);
		expect(factsFromTags({}).hasLensEvidence).toBe(false);
	});

	it('falls back to CreateDate for the digitized stamp', () => {
		expect(
			factsFromTags({ CreateDate: { description: '2026:07:27 15:00:00' } }).dateTimeDigitized
		).toBe('2026:07:27 15:00:00');
	});

	it('ignores empty strings', () => {
		expect(factsFromTags({ Software: { description: '   ' } }).software).toBeUndefined();
	});
});
