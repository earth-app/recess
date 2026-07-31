/**
 * The share-code envelope: base45 codec plus the `RC1:` framing.
 *
 * Separate from `barcode.ts`, which owns *validating a barcode the user scanned for a
 * nudge* - a different domain from *generating a code that carries our own state*.
 *
 * ## Why base45 and not raw bytes
 *
 * Byte mode packs 8 bits per byte; base45 (RFC 9285) packs 2 bytes into 3 alphanumeric
 * characters, so 8.25 bits per byte - 97% of byte mode's density. Base45 still wins,
 * because raw byte mode is unreachable in this stack:
 *
 * - `html5-qrcode`'s ZXing wrapper builds its result as `{ text, format, debugData }`
 *   and discards `getRawBytes()` entirely; its type has no byte field.
 * - `@capacitor/barcode-scanner` returns `{ ScanResult: string; format }`.
 * - Byte mode with no ECI header is charset-*guessed*, not Latin-1: ZXing runs
 *   `StringUtils.guessEncoding`, a three-way ISO-8859-1 / UTF-8 / Shift_JIS heuristic,
 *   and html5-qrcode sets no charset hint. Arbitrary binary is therefore misdecoded
 *   non-deterministically, by content.
 *
 * Base45's alphabet is exactly the 45-character QR alphanumeric set, all ASCII, so it
 * decodes identically under every charset the heuristic might pick - which is what
 * makes the round trip safe rather than merely dense. Base64 would be worse than
 * useless: its lowercase forces byte mode, landing at 10.67 bits per byte.
 */

/** RFC 9285 section 4, in order; index is the value */
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

/** indexed lookups under noUncheckedIndexedAccess; every index here is already in range */
function at(index: number): string {
	return ALPHABET[index] as string;
}

const VALUES: Record<string, number> = {};
for (let index = 0; index < ALPHABET.length; index++) {
	VALUES[ALPHABET[index] as string] = index;
}

/** every share code carries this, so a scan of some unrelated QR fails fast */
export const SHARE_PREFIX = 'RC1:';

export function encodeBase45(bytes: Uint8Array): string {
	let out = '';

	// pairs encode to three characters, a trailing odd byte to two
	for (let index = 0; index < bytes.length - 1; index += 2) {
		const value = (bytes[index] as number) * 256 + (bytes[index + 1] as number);
		out += at(value % 45) + at(Math.floor(value / 45) % 45) + at(Math.floor(value / 2025) % 45);
	}

	if (bytes.length % 2 === 1) {
		const value = bytes[bytes.length - 1] as number;
		out += at(value % 45) + at(Math.floor(value / 45) % 45);
	}

	return out;
}

export class Base45Error extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'Base45Error';
	}
}

export function decodeBase45(text: string): Uint8Array {
	// a length of 1 mod 3 can never be produced by the encoder, so it is corrupt input
	if (text.length % 3 === 1) throw new Base45Error('truncated base45');

	const out: number[] = [];

	for (let index = 0; index < text.length; index += 3) {
		const chunk = [...text.slice(index, index + 3)].map((character) => {
			const value = VALUES[character];
			if (value === undefined)
				throw new Base45Error(`character outside the alphabet: ${character}`);
			return value;
		});

		if (chunk.length === 3) {
			const value = (chunk[0] as number) + (chunk[1] as number) * 45 + (chunk[2] as number) * 2025;
			// the encoder can only emit values a uint16 can hold; anything larger is corrupt
			if (value > 0xffff) throw new Base45Error('value overflows two bytes');
			out.push(value >> 8, value & 0xff);
		} else {
			const value = (chunk[0] as number) + (chunk[1] as number) * 45;
			if (value > 0xff) throw new Base45Error('value overflows one byte');
			out.push(value);
		}
	}

	return new Uint8Array(out);
}

/** wrap a payload for display; the receiver checks the prefix before decoding */
export function wrapShareCode(bytes: Uint8Array): string {
	return SHARE_PREFIX + encodeBase45(bytes);
}

export function isShareCode(text: string): boolean {
	return text.startsWith(SHARE_PREFIX);
}

export function unwrapShareCode(text: string): Uint8Array {
	if (!isShareCode(text)) throw new Base45Error('not a Recess share code');
	return decodeBase45(text.slice(SHARE_PREFIX.length));
}

// #region bit packing

/**
 * A forward-only bit writer.
 *
 * The scene is packed at a handful of bits per element rather than serialized as
 * JSON. That is not an optimisation: deflate can only remove statistical redundancy
 * from JSON text, never the structural tax, so a JSON scene lands past every
 * scannable QR version while a packed one fits comfortably.
 */
export class BitWriter {
	private bytes: number[] = [];
	private current = 0;
	private used = 0;

	write(value: number, bits: number) {
		if (bits < 1 || bits > 32) throw new RangeError(`bits out of range: ${bits}`);

		const max = bits === 32 ? 0xffffffff : (1 << bits) - 1;
		if (value < 0 || value > max) {
			throw new RangeError(`value ${value} does not fit in ${bits} bits`);
		}

		for (let index = bits - 1; index >= 0; index--) {
			this.current = (this.current << 1) | ((value >>> index) & 1);
			this.used++;
			if (this.used === 8) {
				this.bytes.push(this.current);
				this.current = 0;
				this.used = 0;
			}
		}
	}

	/** pads the final byte with zeros; the reader knows its own element count */
	finish(): Uint8Array {
		if (this.used > 0) {
			this.bytes.push(this.current << (8 - this.used));
			this.current = 0;
			this.used = 0;
		}
		return new Uint8Array(this.bytes);
	}
}

export class BitReader {
	private index = 0;

	constructor(private readonly bytes: Uint8Array) {}

	read(bits: number): number {
		if (bits < 1 || bits > 32) throw new RangeError(`bits out of range: ${bits}`);

		let value = 0;
		for (let step = 0; step < bits; step++) {
			const byte = this.bytes[this.index >> 3];
			if (byte === undefined) throw new Base45Error('payload ended early');
			value = (value << 1) | ((byte >> (7 - (this.index & 7))) & 1);
			this.index++;
		}
		return value >>> 0;
	}

	get remainingBits(): number {
		return this.bytes.length * 8 - this.index;
	}
}

// #endregion
