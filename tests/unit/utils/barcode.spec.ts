import { describe, expect, it } from 'vitest';
import {
	VIN_REGEX,
	checkBarcode,
	formatLabel,
	formatMatchesKind,
	gs1CheckDigitValid,
	looksLikeIsbn,
	parseBoardingPass,
	retailChecksumValid,
	upcEToUpcA,
	vinChecksumValid
} from '~/utils/barcode';

describe('gs1CheckDigitValid', () => {
	it('accepts a real EAN-13', () => {
		expect(gs1CheckDigitValid('9780262033848')).toBe(true);
	});

	it('accepts a real UPC-A', () => {
		expect(gs1CheckDigitValid('036000291452')).toBe(true);
	});

	it('accepts a real EAN-8', () => {
		expect(gs1CheckDigitValid('96385074')).toBe(true);
	});

	it('rejects a flipped final digit', () => {
		expect(gs1CheckDigitValid('9780262033847')).toBe(false);
	});

	it('rejects a transposition that changes the checksum', () => {
		expect(gs1CheckDigitValid('9780262033884')).toBe(false);
	});

	it('rejects wrong lengths and non-digits', () => {
		for (const bad of ['', '1', '123456', '12345678901', 'abcdefghijklm', '978026203384X']) {
			expect(gs1CheckDigitValid(bad)).toBe(false);
		}
	});
});

describe('upcEToUpcA', () => {
	it('expands each last-digit case to a valid UPC-A', () => {
		for (const upce of ['04252614', '02345673', '04963406', '01234565']) {
			const expanded = upcEToUpcA(upce);
			expect(expanded, upce).not.toBeNull();
			expect(expanded).toHaveLength(12);
		}
	});

	it('returns null for anything that is not 8 digits', () => {
		expect(upcEToUpcA('123')).toBeNull();
		expect(upcEToUpcA('abcdefgh')).toBeNull();
	});
});

describe('retailChecksumValid', () => {
	it('accepts EAN-13 and UPC-A', () => {
		expect(retailChecksumValid('9780262033848')).toBe(true);
		expect(retailChecksumValid('036000291452')).toBe(true);
	});

	it('accepts an EAN-8', () => {
		expect(retailChecksumValid('96385074')).toBe(true);
	});

	it('tolerates surrounding whitespace', () => {
		expect(retailChecksumValid('  9780262033848 ')).toBe(true);
	});

	it('rejects a bad check digit', () => {
		expect(retailChecksumValid('9780262033847')).toBe(false);
	});
});

describe('looksLikeIsbn', () => {
	it('accepts 978 and 979 prefixes with a valid checksum', () => {
		expect(looksLikeIsbn('9780262033848')).toBe(true);
	});

	it('rejects a non-book retail code', () => {
		expect(looksLikeIsbn('036000291452')).toBe(false);
	});

	it('rejects a 978 prefix with a bad checksum', () => {
		expect(looksLikeIsbn('9780262033847')).toBe(false);
	});
});

describe('VIN', () => {
	it('rejects I, O and Q', () => {
		expect(VIN_REGEX.test('1HGCM82633A004I52')).toBe(false);
		expect(VIN_REGEX.test('1HGCM82633A004O52')).toBe(false);
		expect(VIN_REGEX.test('1HGCM82633A004Q52')).toBe(false);
	});

	it('requires exactly 17 characters', () => {
		expect(VIN_REGEX.test('1HGCM82633A00435')).toBe(false);
		expect(VIN_REGEX.test('1HGCM82633A0043521')).toBe(false);
	});

	it('validates a real check digit', () => {
		expect(vinChecksumValid('1HGCM82633A004352')).toBe(true);
	});

	it('rejects a corrupted VIN', () => {
		expect(vinChecksumValid('1HGCM82633A004353')).toBe(false);
	});

	it('is case-insensitive and trims', () => {
		expect(vinChecksumValid(' 1hgcm82633a004352 ')).toBe(true);
	});

	it('rejects a malformed VIN outright', () => {
		expect(vinChecksumValid('nope')).toBe(false);
	});
});

// BCBP mandatory section, exactly 60 chars: M + legs + name(20) + E + pnr(7) +
// from(3) + to(3) + carrier(3) + flight(5) + julian(3) + cabin + seat(4) +
// sequence(5) + status + variable-size(2)
const pass = 'M1DOE/JOHN            EABC1234ORDLHRUA 0123 208Y001A0001 100';

describe('parseBoardingPass', () => {
	it('extracts the routing fields', () => {
		const parsed = parseBoardingPass(pass);
		expect(parsed).toMatchObject({ from: 'ORD', to: 'LHR', carrier: 'UA' });
	});

	it('does not capture the passenger name', () => {
		const parsed = parseBoardingPass(pass);
		expect(JSON.stringify(parsed)).not.toContain('DOE');
	});

	it('rejects a payload that is not a boarding pass', () => {
		expect(parseBoardingPass('9780262033848')).toBeNull();
		expect(parseBoardingPass('X1DOE/JOHN')).toBeNull();
	});

	it('rejects a too-short payload', () => {
		expect(parseBoardingPass('M1DOE/JOHN EABC1234 ORDLHR')).toBeNull();
	});

	it('rejects a non-numeric leg count', () => {
		expect(parseBoardingPass(`MXDOE/JOHN${' '.repeat(60)}`)).toBeNull();
	});

	it('rejects non-IATA airport codes', () => {
		const broken = pass.slice(0, 30) + '123456' + pass.slice(36);
		expect(parseBoardingPass(broken)).toBeNull();
	});
});

describe('formatMatchesKind', () => {
	it('accepts retail formats for retail and book', () => {
		for (const format of [9, 10, 14, 15]) {
			expect(formatMatchesKind(format, 'retail')).toBe(true);
			expect(formatMatchesKind(format, 'book')).toBe(true);
		}
	});

	it('rejects a QR code for a retail kind', () => {
		expect(formatMatchesKind(0, 'retail')).toBe(false);
	});

	it('accepts an unknown format so web engines are not punished for disagreeing', () => {
		expect(formatMatchesKind(-1, 'retail')).toBe(true);
	});

	it('labels known formats and falls back for the rest', () => {
		expect(formatLabel(9)).toBe('EAN-13');
		expect(formatLabel(999)).toBe('UNKNOWN');
	});
});

describe('checkBarcode', () => {
	it('accepts a book ISBN', () => {
		const result = checkBarcode({ data: '9780262033848', format: 9 }, 'book');
		expect(result.ok).toBe(true);
		expect(result.describes).toContain('book');
	});

	it('rejects a product barcode for a book nudge, and says why', () => {
		const result = checkBarcode({ data: '036000291452', format: 14 }, 'book');
		expect(result.ok).toBe(false);
		expect(result.reason).toContain('not a book');
	});

	it('rejects a wrong symbology before looking at the payload', () => {
		const result = checkBarcode({ data: '9780262033848', format: 0 }, 'book');
		expect(result.ok).toBe(false);
		expect(result.reason).toContain('QR');
	});

	it('accepts a retail product and names it generically', () => {
		const result = checkBarcode({ data: '036000291452', format: 14 }, 'retail');
		expect(result.ok).toBe(true);
		expect(result.describes).toContain('product');
	});

	it('recognises an ISBN scanned against the retail kind', () => {
		const result = checkBarcode({ data: '9780262033848', format: 9 }, 'retail');
		expect(result.describes).toContain('book');
	});

	it('can skip the checksum when the nudge allows it', () => {
		const scan = { data: '9780262033847', format: 9 };
		expect(checkBarcode(scan, 'book').ok).toBe(false);
		expect(checkBarcode(scan, 'book', false).ok).toBe(true);
	});

	it('accepts a valid VIN', () => {
		expect(checkBarcode({ data: '1HGCM82633A004352', format: 3 }, 'vehicle').ok).toBe(true);
	});

	it('rejects a VIN containing a forbidden letter', () => {
		const result = checkBarcode({ data: '1HGCM82633A004I52', format: 3 }, 'vehicle');
		expect(result.ok).toBe(false);
		expect(result.reason).toContain('no I, O or Q');
	});

	it('accepts a boarding pass and describes the route', () => {
		const result = checkBarcode({ data: pass, format: 11 }, 'boarding_pass');
		expect(result.ok).toBe(true);
		expect(result.describes).toContain('ORD to LHR');
	});

	it('rejects an empty scan', () => {
		expect(checkBarcode({ data: '   ', format: 9 }, 'retail').ok).toBe(false);
	});
});
