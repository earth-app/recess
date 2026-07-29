export const FRESHNESS_WINDOW_MS = 30 * 60 * 1000;
export const DIGITIZED_DRIFT_MS = 5 * 60 * 1000;

const SOFTWARE_FAMILIES: { label: string; pattern: RegExp }[] = [
	{
		label: 'a screen recorder',
		pattern: /obs|screenflow|camtasia|sharex|bandicam|snagit|quicktime/i
	},
	{
		label: 'a photo editor',
		pattern:
			/photoshop|lightroom|gimp|snapseed|pixlr|photopea|krita|affinity|capture one|darktable|rawtherapee|luminar/i
	},
	{ label: '3D software', pattern: /blender|cinema 4d|3ds max|maya|houdini|unreal|unity|godot/i },
	{ label: 'an online editor', pattern: /imgur|canva|procreate|befunky|fotor|picsart/i },
	{
		label: 'an image generator',
		pattern: /dall-?e|stable diffusion|midjourney|diffusion|texttoimage|txt2img|firefly|imagen/i
	}
];

export function detectNonCameraSoftware(software: string | undefined): string | null {
	if (!software) return null;
	for (const family of SOFTWARE_FAMILIES) {
		if (family.pattern.test(software)) return family.label;
	}
	return null;
}

/** `2026:07:27 15:04:22` */
export function parseExifDate(value: string | undefined): number | null {
	if (!value) return null;
	const match = /(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(value);
	if (!match) return null;

	const [, year, month, day, hour, minute, second] = match.map(Number) as [
		number,
		number,
		number,
		number,
		number,
		number,
		number
	];
	const time = Date.UTC(year, month - 1, day, hour, minute, second);
	return Number.isFinite(time) ? time : null;
}

/** `+02:00` / `-05:00` -> ms offset */
export function parseExifOffset(value: string | undefined): number {
	if (!value) return 0;
	const match = /^([+-])(\d{2}):(\d{2})$/.exec(value.trim());
	if (!match) return 0;
	const [, sign, hours, minutes] = match as unknown as [string, string, string, string];
	const magnitude = (Number(hours) * 60 + Number(minutes)) * 60_000;
	return sign === '-' ? -magnitude : magnitude;
}

export interface ExifFacts {
	dateTimeOriginal?: string;
	dateTimeDigitized?: string;
	offsetTimeOriginal?: string;
	software?: string;
	make?: string;
	model?: string;
	focalLength?: number;
	hasLensEvidence: boolean;
}

export interface ExifCheck {
	ok: boolean;
	/** true when there was no EXIF at all, which is common on web captures */
	missing: boolean;
	reason?: string;
}

/**
 * a fresh-photo check. absent EXIF is NOT a failure - plenty of legitimate
 * captures arrive stripped, and refusing them would block honest users.
 */
export function checkFreshCapture(facts: ExifFacts | null, now: number): ExifCheck {
	if (!facts) return { ok: true, missing: true };

	const editor = detectNonCameraSoftware(facts.software);
	if (editor) {
		return { ok: false, missing: false, reason: `That photo came out of ${editor}.` };
	}

	if (facts.focalLength === 0) {
		return { ok: false, missing: false, reason: "That photo's metadata says it had no lens." };
	}

	const taken = parseExifDate(facts.dateTimeOriginal);
	if (taken === null) return { ok: true, missing: true };

	const offset = parseExifOffset(facts.offsetTimeOriginal);
	const actual = taken - offset;

	if (Math.abs(now - actual) > FRESHNESS_WINDOW_MS) {
		const minutes = Math.round(Math.abs(now - actual) / 60_000);
		return {
			ok: false,
			missing: false,
			reason:
				minutes > 90
					? 'This one wants a photo taken just now, not one from the library.'
					: `That photo is about ${minutes} minutes old.`
		};
	}

	const digitized = parseExifDate(facts.dateTimeDigitized);
	if (digitized !== null && Math.abs(digitized - taken) > DIGITIZED_DRIFT_MS) {
		return {
			ok: false,
			missing: false,
			reason: "That photo's timestamps disagree with each other."
		};
	}

	return { ok: true, missing: false };
}

// #region reading

type ExifTagBag = Record<string, { description?: unknown; value?: unknown } | undefined>;

function tagText(tags: ExifTagBag, name: string): string | undefined {
	const tag = tags[name];
	if (!tag) return undefined;
	const raw = tag.description ?? tag.value;
	if (typeof raw === 'string') return raw.trim() || undefined;
	if (Array.isArray(raw) && typeof raw[0] === 'string') return String(raw[0]).trim() || undefined;
	return undefined;
}

function tagNumber(tags: ExifTagBag, name: string): number | undefined {
	const tag = tags[name];
	if (!tag) return undefined;
	const raw = tag.value ?? tag.description;
	if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
	if (Array.isArray(raw) && raw.length === 2) {
		const [n, d] = raw as [number, number];
		if (Number.isFinite(n) && Number.isFinite(d) && d !== 0) return n / d;
	}
	const parsed = Number.parseFloat(String(raw));
	return Number.isFinite(parsed) ? parsed : undefined;
}

export function factsFromTags(tags: ExifTagBag): ExifFacts {
	return {
		dateTimeOriginal: tagText(tags, 'DateTimeOriginal'),
		dateTimeDigitized: tagText(tags, 'DateTimeDigitized') ?? tagText(tags, 'CreateDate'),
		offsetTimeOriginal: tagText(tags, 'OffsetTimeOriginal'),
		software: tagText(tags, 'Software'),
		make: tagText(tags, 'Make'),
		model: tagText(tags, 'Model'),
		focalLength: tagNumber(tags, 'FocalLength'),
		hasLensEvidence: Boolean(
			tags.LensModel || tags.FNumber || tags.ApertureValue || tags.ExposureTime
		)
	};
}

/** exifreader is dynamically imported so it stays out of the entry chunk */
export async function readExif(blob: Blob): Promise<ExifFacts | null> {
	try {
		const { default: ExifReader } = await import('exifreader');
		const buffer = await blob.arrayBuffer();
		const tags = ExifReader.load(buffer, { expanded: false }) as ExifTagBag;
		return factsFromTags(tags);
	} catch {
		// no EXIF, or an unsupported container; treated as simply absent
		return null;
	}
}

// #endregion
