import { AFFORDANCES, type Affordance } from '~/types/places';
import { dayKey } from '~/utils/day';
import { snapToGrid } from '~/utils/geo';
import { Base45Error, BitReader, BitWriter, decodeBase45, encodeBase45 } from '~/utils/qr';

export const TRAILMARK_PREFIX = 'RT1:';
export const TRAILMARK_VERSION = 1;
export const TRAILMARK_MAX_AGE_DAYS = 1;

// 21 and 22 bits put a cell well under the 100 m grid everything is snapped to anyway
const LAT_BITS = 21;
const LON_BITS = 22;
const DAY_BITS = 16;
const VERSION_BITS = 4;
const ID_LENGTH_BITS = 7;

const LAT_SCALE = (1 << LAT_BITS) - 1;
const LON_SCALE = (1 << LON_BITS) - 1;

/** days since the unix epoch, from a local day key, so the bound matches the rest of the app */
function dayNumber(day: string): number {
	const [year, month, date] = day.split('-').map(Number);
	return Math.floor(Date.UTC(year ?? 1970, (month ?? 1) - 1, date ?? 1) / 86_400_000);
}

export interface Trailmark {
	/** composed nudge id, e.g. `nature.notice.first_bird` */
	nudgeId: string;
	latitude: number;
	longitude: number;
	affordances: Affordance[];
	/** local day key the code was made on */
	day: string;
}

export class TrailmarkError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'TrailmarkError';
	}
}

export function isTrailmark(text: string): boolean {
	return text.startsWith(TRAILMARK_PREFIX);
}

export function encodeTrailmark(mark: Trailmark): string {
	const id = new TextEncoder().encode(mark.nudgeId);
	if (id.length === 0 || id.length > (1 << ID_LENGTH_BITS) - 1) {
		throw new TrailmarkError(`nudge id does not fit: ${mark.nudgeId}`);
	}

	// snapped before packing, so a trailmark can never carry a finer position than the app uses
	const cell = snapToGrid(mark.latitude, mark.longitude);

	const writer = new BitWriter();
	writer.write(TRAILMARK_VERSION, VERSION_BITS);
	writer.write(dayNumber(mark.day) & ((1 << DAY_BITS) - 1), DAY_BITS);
	writer.write(Math.round(((cell.latitude + 90) / 180) * LAT_SCALE), LAT_BITS);
	writer.write(Math.round(((cell.longitude + 180) / 360) * LON_SCALE), LON_BITS);

	let mask = 0;
	for (const affordance of mark.affordances) {
		const index = AFFORDANCES.indexOf(affordance);
		if (index >= 0) mask |= 1 << index;
	}
	writer.write(mask, AFFORDANCES.length);

	writer.write(id.length, ID_LENGTH_BITS);
	for (const byte of id) writer.write(byte, 8);

	return TRAILMARK_PREFIX + encodeBase45(writer.finish());
}

export interface DecodedTrailmark extends Trailmark {
	/** false once the day has rolled over; the caller decides what to say about it */
	fresh: boolean;
}

export function decodeTrailmark(text: string, today: string = dayKey()): DecodedTrailmark {
	if (!isTrailmark(text)) throw new TrailmarkError('not a Recess trailmark');

	let bytes: Uint8Array;
	try {
		bytes = decodeBase45(text.slice(TRAILMARK_PREFIX.length));
	} catch (error) {
		throw new TrailmarkError(error instanceof Base45Error ? error.message : 'unreadable');
	}

	const reader = new BitReader(bytes);

	let version: number;
	try {
		version = reader.read(VERSION_BITS);
	} catch {
		throw new TrailmarkError('payload ended early');
	}
	if (version !== TRAILMARK_VERSION) {
		throw new TrailmarkError(`unsupported trailmark version ${version}`);
	}

	try {
		const day = reader.read(DAY_BITS);
		const latitude = (reader.read(LAT_BITS) / LAT_SCALE) * 180 - 90;
		const longitude = (reader.read(LON_BITS) / LON_SCALE) * 360 - 180;
		const mask = reader.read(AFFORDANCES.length);

		const length = reader.read(ID_LENGTH_BITS);
		if (length === 0) throw new TrailmarkError('trailmark carries no nudge');
		const id = new Uint8Array(length);
		for (let index = 0; index < length; index++) id[index] = reader.read(8);

		const nudgeId = new TextDecoder().decode(id);
		const cell = snapToGrid(latitude, longitude);

		// the day is packed modulo 2^16, so compare in the same space
		const mine = dayNumber(today) & ((1 << DAY_BITS) - 1);
		const age = (mine - day + (1 << DAY_BITS)) % (1 << DAY_BITS);

		return {
			nudgeId,
			latitude: cell.latitude,
			longitude: cell.longitude,
			affordances: AFFORDANCES.filter((_, index) => (mask & (1 << index)) !== 0),
			day: today,
			fresh: age <= TRAILMARK_MAX_AGE_DAYS
		};
	} catch (error) {
		if (error instanceof TrailmarkError) throw error;
		throw new TrailmarkError('payload ended early');
	}
}

/** payload size in bytes, for checking a code stays inside a scannable QR version */
export function trailmarkBytes(nudgeIdLength: number): number {
	const bits =
		VERSION_BITS +
		DAY_BITS +
		LAT_BITS +
		LON_BITS +
		AFFORDANCES.length +
		ID_LENGTH_BITS +
		nudgeIdLength * 8;
	return Math.ceil(bits / 8);
}
