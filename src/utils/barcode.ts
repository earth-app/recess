import type { BarcodeKind } from '~/types/nudge';

// #region symbology

/** @capacitor/barcode-scanner format ordinals */
export const BARCODE_FORMATS: Record<number, string> = {
	0: 'QR',
	1: 'AZTEC',
	2: 'CODABAR',
	3: 'CODE-39',
	4: 'CODE-93',
	5: 'CODE-128',
	6: 'DATA MATRIX',
	7: 'ITF',
	8: 'MAXICODE',
	9: 'EAN-13',
	10: 'EAN-8',
	11: 'PDF417',
	12: 'RSS-14',
	13: 'RSS EXPANDED',
	14: 'UPC-A',
	15: 'UPC-E'
};

export const RETAIL_FORMATS = [9, 10, 14, 15] as const;
export const VIN_FORMATS = [3, 6, 11] as const;
export const BOARDING_PASS_FORMATS = [0, 1, 6, 11] as const;

const KIND_FORMATS: Record<BarcodeKind, readonly number[]> = {
	retail: RETAIL_FORMATS,
	book: RETAIL_FORMATS,
	vehicle: VIN_FORMATS,
	boarding_pass: BOARDING_PASS_FORMATS
};

export function formatLabel(format: number): string {
	return BARCODE_FORMATS[format] ?? 'UNKNOWN';
}

/**
 * web scanning engines disagree on format ordinals and some report -1. an
 * unknown format is not treated as a mismatch; the payload itself still has to
 * pass its structural check.
 */
export function formatMatchesKind(format: number, kind: BarcodeKind): boolean {
	if (!Number.isFinite(format) || format < 0) return true;
	return KIND_FORMATS[kind].includes(format);
}

// #endregion

// #region checksums

/**
 * GS1 mod-10 check digit, right-to-left weighting 3,1,3,1... Covers EAN-13,
 * EAN-8, UPC-A and ISBN-13.
 */
export function gs1CheckDigitValid(digits: string): boolean {
	if (!/^\d{8}$|^\d{12,14}$/.test(digits)) return false;

	const body = digits.slice(0, -1);
	const expected = Number(digits.slice(-1));

	let sum = 0;
	for (let i = body.length - 1, weight = 3; i >= 0; i--, weight = weight === 3 ? 1 : 3) {
		sum += Number(body[i]) * weight;
	}

	return (10 - (sum % 10)) % 10 === expected;
}

/** UPC-E expands to UPC-A before its check digit means anything */
export function upcEToUpcA(upce: string): string | null {
	if (!/^\d{8}$/.test(upce)) return null;

	const digits = upce.slice(1, 7);
	const check = upce.slice(7);
	const last = digits[5] as string;
	const lead = upce[0] as string;

	let middle: string;
	switch (last) {
		case '0':
		case '1':
		case '2':
			middle = `${digits.slice(0, 2)}${last}0000${digits.slice(2, 5)}`;
			break;
		case '3':
			middle = `${digits.slice(0, 3)}00000${digits.slice(3, 5)}`;
			break;
		case '4':
			middle = `${digits.slice(0, 4)}00000${digits[4]}`;
			break;
		default:
			middle = `${digits.slice(0, 5)}0000${last}`;
			break;
	}

	return `${lead}${middle}${check}`;
}

export function retailChecksumValid(value: string): boolean {
	const digits = value.trim();
	if (/^\d{8}$/.test(digits)) {
		// could be EAN-8 or UPC-E; accept either reading
		if (gs1CheckDigitValid(digits)) return true;
		const expanded = upcEToUpcA(digits);
		return expanded ? gs1CheckDigitValid(expanded) : false;
	}
	return gs1CheckDigitValid(digits);
}

// #endregion

// #region kinds

/** ISBN-13 prefixes; ISBN-10 is not a scannable retail symbology */
export function looksLikeIsbn(value: string): boolean {
	const digits = value.trim();
	return /^97[89]\d{10}$/.test(digits) && gs1CheckDigitValid(digits);
}

/** no I, O or Q, exactly 17 characters */
export const VIN_REGEX = /^[A-HJ-NPR-Z0-9]{17}$/;

const VIN_TRANSLITERATION: Record<string, number> = {
	A: 1,
	B: 2,
	C: 3,
	D: 4,
	E: 5,
	F: 6,
	G: 7,
	H: 8,
	J: 1,
	K: 2,
	L: 3,
	M: 4,
	N: 5,
	P: 7,
	R: 9,
	S: 2,
	T: 3,
	U: 4,
	V: 5,
	W: 6,
	X: 7,
	Y: 8,
	Z: 9
};
const VIN_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

/**
 * ISO 3779 check digit at position 9. Mandatory in North America and widely
 * populated elsewhere, so a failure is a strong signal the scan is wrong.
 */
export function vinChecksumValid(vin: string): boolean {
	const value = vin.trim().toUpperCase();
	if (!VIN_REGEX.test(value)) return false;

	let sum = 0;
	for (let i = 0; i < 17; i++) {
		const char = value[i] as string;
		const digit = /\d/.test(char) ? Number(char) : VIN_TRANSLITERATION[char];
		if (digit === undefined) return false;
		sum += digit * (VIN_WEIGHTS[i] as number);
	}

	const remainder = sum % 11;
	const expected = remainder === 10 ? 'X' : String(remainder);
	return value[8] === expected;
}

export interface BoardingPass {
	pnr: string;
	from: string;
	to: string;
	carrier: string;
	flight: string;
	julianDate: number;
	cabin: string;
	seat: string;
}

/**
 * IATA BCBP (Resolution 792) fixed-width parse, fully offline. The passenger
 * name field is deliberately not captured - it is PII we have no use for.
 */
export function parseBoardingPass(value: string): BoardingPass | null {
	const raw = value.trim();
	if (raw[0] !== 'M') return null;
	if (!/^[1-9]$/.test(raw[1] ?? '')) return null;
	if (raw.length < 60) return null;

	const from = raw.slice(30, 33).toUpperCase();
	const to = raw.slice(33, 36).toUpperCase();
	if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) return null;

	const julian = Number(raw.slice(44, 47));
	if (!Number.isFinite(julian) || julian < 1 || julian > 366) return null;

	return {
		pnr: raw.slice(23, 30).trim(),
		from,
		to,
		carrier: raw.slice(36, 39).trim().toUpperCase(),
		flight: raw.slice(39, 44).trim(),
		julianDate: julian,
		cabin: (raw[47] ?? '').trim(),
		seat: raw.slice(48, 52).trim()
	};
}

// #endregion

// #region verdict

export interface BarcodeScan {
	data: string;
	format: number;
}

export interface BarcodeCheck {
	ok: boolean;
	/** what we could establish about the code, for the success copy */
	describes?: string;
	reason?: string;
}

/**
 * structural validation only. answers "you scanned a real book barcode",
 * never "you scanned Dune" - that needs a network lookup we do not make.
 */
export function checkBarcode(
	scan: BarcodeScan,
	kind: BarcodeKind,
	requireChecksum = true
): BarcodeCheck {
	const value = (scan.data ?? '').trim();
	if (value.length === 0) return { ok: false, reason: 'Nothing was scanned.' };

	if (!formatMatchesKind(scan.format, kind)) {
		return {
			ok: false,
			reason: `That's a ${formatLabel(scan.format)} code, which isn't what this one is looking for.`
		};
	}

	switch (kind) {
		case 'book': {
			// a valid-but-wrong retail code deserves a more useful message than a
			// generic length complaint
			if (/^\d{8}$|^\d{12}$/.test(value)) {
				return { ok: false, reason: "That's a product barcode, not a book's ISBN." };
			}
			if (!/^\d{13}$/.test(value)) {
				return { ok: false, reason: 'Book barcodes are 13 digits starting with 978 or 979.' };
			}
			if (!/^97[89]/.test(value)) {
				return { ok: false, reason: "That's a product barcode, not a book's ISBN." };
			}
			if (requireChecksum && !gs1CheckDigitValid(value)) {
				return { ok: false, reason: "The check digit doesn't add up. Try scanning again." };
			}
			return { ok: true, describes: "That's a book barcode." };
		}

		case 'retail': {
			if (!/^\d{8}$|^\d{12,13}$/.test(value)) {
				return { ok: false, reason: "That doesn't look like a retail barcode." };
			}
			if (requireChecksum && !retailChecksumValid(value)) {
				return { ok: false, reason: "The check digit doesn't add up. Try scanning again." };
			}
			return {
				ok: true,
				describes: looksLikeIsbn(value) ? "That's a book barcode." : "That's a product barcode."
			};
		}

		case 'vehicle': {
			const vin = value.toUpperCase();
			if (!VIN_REGEX.test(vin)) {
				return { ok: false, reason: 'A VIN is 17 characters, with no I, O or Q.' };
			}
			if (requireChecksum && !vinChecksumValid(vin)) {
				return { ok: false, reason: "The VIN's check digit doesn't add up." };
			}
			return { ok: true, describes: "That's a valid VIN." };
		}

		case 'boarding_pass': {
			const pass = parseBoardingPass(value);
			if (!pass) return { ok: false, reason: "That isn't a boarding pass barcode." };
			return {
				ok: true,
				describes: `${pass.from} to ${pass.to} on ${pass.carrier}${pass.flight}.`
			};
		}

		default: {
			const exhaustive: never = kind;
			return exhaustive;
		}
	}
}

// #endregion
