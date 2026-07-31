import { describe, expect, it } from 'vitest';
import {
	Base45Error,
	BitReader,
	BitWriter,
	decodeBase45,
	encodeBase45,
	isShareCode,
	SHARE_PREFIX,
	unwrapShareCode,
	wrapShareCode
} from '~/utils/qr';

function ascii(text: string): Uint8Array {
	return new Uint8Array([...text].map((character) => character.charCodeAt(0)));
}

describe('base45', () => {
	// RFC 9285 section 4.4, verbatim
	it.each([
		['AB', 'BB8'],
		['Hello!!', '%69 VD92EX0'],
		['base-45', 'UJCLQE7W581'],
		['ietf!', 'QED8WEX0']
	])('encodes the RFC 9285 vector %s', (input, expected) => {
		expect(encodeBase45(ascii(input))).toBe(expected);
	});

	it.each([
		['QED8WEX0', 'ietf!'],
		['BB8', 'AB'],
		['%69 VD92EX0', 'Hello!!']
	])('decodes the RFC 9285 vector %s', (input, expected) => {
		expect(new TextDecoder().decode(decodeBase45(input))).toBe(expected);
	});

	it('round-trips every byte value', () => {
		const bytes = new Uint8Array(256);
		for (let index = 0; index < 256; index++) bytes[index] = index;
		expect([...decodeBase45(encodeBase45(bytes))]).toEqual([...bytes]);
	});

	it('round-trips an odd length, which takes the two-character tail', () => {
		const bytes = new Uint8Array([1, 2, 3]);
		const encoded = encodeBase45(bytes);
		expect(encoded).toHaveLength(5);
		expect([...decodeBase45(encoded)]).toEqual([1, 2, 3]);
	});

	it('encodes an empty payload as an empty string', () => {
		expect(encodeBase45(new Uint8Array())).toBe('');
		expect([...decodeBase45('')]).toEqual([]);
	});

	it('stays inside the QR alphanumeric alphabet, which is what makes the round trip safe', () => {
		const bytes = new Uint8Array(512);
		for (let index = 0; index < bytes.length; index++) bytes[index] = (index * 37) % 256;
		expect(encodeBase45(bytes)).toMatch(/^[0-9A-Z $%*+\-./:]*$/);
	});

	it('rejects a length the encoder could never produce', () => {
		expect(() => decodeBase45('BB8B')).toThrow(Base45Error);
	});

	it('rejects a character outside the alphabet', () => {
		expect(() => decodeBase45('bb8')).toThrow(Base45Error);
	});

	it('rejects a triple that overflows two bytes', () => {
		// 44 + 44*45 + 44*2025 = 91124, past 0xffff
		expect(() => decodeBase45(':::')).toThrow(Base45Error);
	});

	it('rejects a pair that overflows one byte', () => {
		expect(() => decodeBase45('::')).toThrow(Base45Error);
	});
});

describe('share code envelope', () => {
	it('round-trips through the prefix', () => {
		const bytes = new Uint8Array([9, 8, 7, 6, 5]);
		const code = wrapShareCode(bytes);
		expect(code.startsWith(SHARE_PREFIX)).toBe(true);
		expect([...unwrapShareCode(code)]).toEqual([...bytes]);
	});

	it('rejects an unrelated QR payload rather than decoding garbage', () => {
		expect(isShareCode('https://example.com')).toBe(false);
		expect(() => unwrapShareCode('https://example.com')).toThrow(Base45Error);
	});
});

describe('bit packing', () => {
	it('round-trips fields that do not land on byte boundaries', () => {
		const writer = new BitWriter();
		writer.write(5, 4);
		writer.write(300, 9);
		writer.write(1, 1);
		writer.write(63, 6);

		const reader = new BitReader(writer.finish());
		expect(reader.read(4)).toBe(5);
		expect(reader.read(9)).toBe(300);
		expect(reader.read(1)).toBe(1);
		expect(reader.read(6)).toBe(63);
	});

	it('packs 4-bit elements at two per byte', () => {
		const writer = new BitWriter();
		for (let index = 0; index < 128; index++) writer.write(index % 9, 4);
		expect(writer.finish()).toHaveLength(64);
	});

	it('pads the final partial byte with zeros', () => {
		const writer = new BitWriter();
		writer.write(1, 1);
		const bytes = writer.finish();
		expect(bytes).toHaveLength(1);
		expect(bytes[0]).toBe(0b1000_0000);
	});

	it('rejects a value too large for its field, rather than silently truncating', () => {
		const writer = new BitWriter();
		expect(() => writer.write(16, 4)).toThrow(RangeError);
		expect(() => writer.write(-1, 4)).toThrow(RangeError);
	});

	it('rejects a field width outside 1..32', () => {
		const writer = new BitWriter();
		expect(() => writer.write(0, 0)).toThrow(RangeError);
		expect(() => writer.write(0, 33)).toThrow(RangeError);
	});

	it('throws rather than returning zeros when the payload ends early', () => {
		const reader = new BitReader(new Uint8Array([0xff]));
		expect(reader.read(8)).toBe(255);
		expect(() => reader.read(1)).toThrow(Base45Error);
	});

	it('reports the bits it has left, so a reader can size its own loop', () => {
		const reader = new BitReader(new Uint8Array([0, 0, 0]));
		expect(reader.remainingBits).toBe(24);
		reader.read(10);
		expect(reader.remainingBits).toBe(14);
	});
});
