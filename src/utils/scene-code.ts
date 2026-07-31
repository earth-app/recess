import type { MoonPhase, NudgeCategory, Season, TimeOfDay } from '~/types/nudge';
import { MOON_PHASES, NUDGE_CATEGORIES, SEASONS, TIMES_OF_DAY } from '~/types/nudge';
import { dayKey, daysBetween, hashString } from '~/utils/day';
import {
	LAYOUT_GRAMMARS,
	MOTIFS,
	PALETTE_FAMILIES,
	SCENE_SCHEMA_VERSION,
	SPECIES_SKINS,
	type LayoutGrammar,
	type Motif,
	type PaletteFamily,
	type SceneTraits,
	type SceneTuple
} from '~/utils/playground';
import { BitReader, BitWriter, isShareCode, unwrapShareCode, wrapShareCode } from '~/utils/qr';

/**
 * Packing a Playground into something a phone camera can read off another screen.
 *
 * ## The install seed never leaves the device
 *
 * A shared scene carries its **traits** outright plus a per-day *ephemeral* seed,
 * `hash(installSeed + day)`, and never the install seed itself. Sending the real seed
 * would hand a stable per-install identifier to whoever scanned it, which is exactly
 * what `utils/install.ts` exists to avoid.
 *
 * The consequence is deliberate: element placement is re-rolled from the ephemeral
 * seed, so a shared scene is not byte-identical to the sender's private one. Traits
 * carry the look - palette family, grammar, motif, horizon, light angle - so it still
 * reads as the same Playground. The sharer previews the exact tuple being shared
 * rather than their own, so what they see is what the other person gets.
 *
 * ## Why the geometry is not in the payload
 *
 * `buildScene` derives species, position, depth and rotation from `(sceneSeed, index)`,
 * so an element costs **4 bits** - its category - instead of the ~20 it would take to
 * carry its geometry. That is the difference between a version 8 code readable across
 * a table and a version 20-plus code that needs a steady hand and good light.
 */

/** bumped only when the field layout changes; independent of the scene rules version */
export const SCENE_CODE_VERSION = 1;

/** epoch for the minted-on field; keeps it inside 16 bits for ~179 years */
const DAY_EPOCH = '2026-01-01';

/** a code is only good for the day it was made - the "one-time view" bound */
export const SCENE_CODE_MAX_AGE_DAYS = 1;

/** the payload caps here; a longer ledger shares its most recent elements */
export const SCENE_CODE_MAX_ELEMENTS = 160;

const BITS = {
	codeVersion: 4,
	schemaVersion: 4,
	seed: 32,
	paletteFamily: 3,
	layoutGrammar: 3,
	motif: 3,
	speciesSkin: 2,
	horizon: 8,
	lightAngle: 8,
	timeOfDay: 2,
	season: 2,
	moonPhase: 3,
	moonIllumination: 7,
	points: 20,
	mintedOn: 16,
	elementCount: 9,
	category: 4
} as const;

const MAX_POINTS = 2 ** BITS.points - 1;

export class SceneCodeError extends Error {
	constructor(
		message: string,
		readonly kind: 'malformed' | 'unsupported' | 'expired'
	) {
		super(message);
		this.name = 'SceneCodeError';
	}
}

/**
 * A per-day seed derived from the install seed.
 *
 * Truncated to 32 bits and mixed with the day, so it is stable for a day (two shares
 * on one day render identically) and useless as an identifier afterwards.
 */
export function ephemeralSeed(installSeed: string, day: string): number {
	return hashString(`recess:share:${installSeed}:${day}`) >>> 0;
}

function quantize(value: number, min: number, max: number, bits: number): number {
	const span = max - min;
	const steps = 2 ** bits - 1;
	const clamped = Math.min(max, Math.max(min, value));
	return Math.round(((clamped - min) / span) * steps);
}

function dequantize(raw: number, min: number, max: number, bits: number): number {
	const steps = 2 ** bits - 1;
	return min + (raw / steps) * (max - min);
}

function indexOf<T>(items: readonly T[], value: T, what: string): number {
	const index = items.indexOf(value);
	if (index < 0) throw new SceneCodeError(`unknown ${what}: ${String(value)}`, 'malformed');
	return index;
}

function itemAt<T>(items: readonly T[], index: number, what: string): T {
	const value = items[index];
	if (value === undefined) throw new SceneCodeError(`${what} index out of range`, 'malformed');
	return value;
}

export interface EncodeSceneOptions {
	/** the install seed; only ever used to derive the ephemeral one */
	installSeed: string;
	/** defaults to today */
	day?: string;
}

/**
 * Round the continuous fields to the precision the payload actually carries.
 *
 * Without this the sharer would preview a scene built from full-precision traits while
 * the receiver rebuilds from 8-bit ones - a small difference in the horizon line and
 * the light angle, but the preview would still be showing something nobody else gets.
 */
function quantizedTraits(traits: SceneTraits): SceneTraits {
	return {
		...traits,
		speciesSkin: Math.min(SPECIES_SKINS - 1, Math.max(0, Math.round(traits.speciesSkin))),
		horizon: dequantize(
			quantize(traits.horizon, 0.55, 0.75, BITS.horizon),
			0.55,
			0.75,
			BITS.horizon
		),
		lightAngle: dequantize(
			quantize(traits.lightAngle, -35, 35, BITS.lightAngle),
			-35,
			35,
			BITS.lightAngle
		)
	};
}

/**
 * The tuple a share code actually carries, which is what the sharer should preview.
 *
 * Traits kept but rounded to the payload's precision, ephemeral seed in place of the
 * install seed, and the element list trimmed to what fits. `startIndex` is shifted so
 * capping the front does not move anything the receiver draws.
 */
export function shareableTuple(tuple: SceneTuple, options: EncodeSceneOptions): SceneTuple {
	const day = options.day ?? dayKey();
	const kept = tuple.categories.slice(-SCENE_CODE_MAX_ELEMENTS);
	const dropped = tuple.categories.length - kept.length;

	return {
		...tuple,
		seed: String(ephemeralSeed(options.installSeed, day)),
		traits: quantizedTraits(tuple.traits),
		categories: kept,
		startIndex: tuple.startIndex + dropped,
		points: Math.min(MAX_POINTS, Math.max(0, Math.round(tuple.points))),
		moonIllumination: dequantize(
			quantize(tuple.moonIllumination, 0, 1, BITS.moonIllumination),
			0,
			1,
			BITS.moonIllumination
		)
	};
}

export function encodeSceneCode(tuple: SceneTuple, options: EncodeSceneOptions): string {
	const day = options.day ?? dayKey();
	const shared = shareableTuple(tuple, options);
	const minted = daysBetween(DAY_EPOCH, day);

	if (minted < 0 || minted > 2 ** BITS.mintedOn - 1) {
		throw new SceneCodeError('day outside the encodable range', 'unsupported');
	}

	const writer = new BitWriter();
	writer.write(SCENE_CODE_VERSION, BITS.codeVersion);
	writer.write(shared.schemaVersion, BITS.schemaVersion);
	writer.write(ephemeralSeed(options.installSeed, day), BITS.seed);

	writer.write(
		indexOf(PALETTE_FAMILIES, shared.traits.paletteFamily, 'palette family'),
		BITS.paletteFamily
	);
	writer.write(
		indexOf(LAYOUT_GRAMMARS, shared.traits.layoutGrammar, 'layout grammar'),
		BITS.layoutGrammar
	);
	writer.write(indexOf(MOTIFS, shared.traits.motif, 'motif'), BITS.motif);
	writer.write(
		Math.min(SPECIES_SKINS - 1, Math.max(0, Math.round(shared.traits.speciesSkin))),
		BITS.speciesSkin
	);
	writer.write(quantize(shared.traits.horizon, 0.55, 0.75, BITS.horizon), BITS.horizon);
	writer.write(quantize(shared.traits.lightAngle, -35, 35, BITS.lightAngle), BITS.lightAngle);

	writer.write(indexOf(TIMES_OF_DAY, shared.timeOfDay, 'time of day'), BITS.timeOfDay);
	writer.write(indexOf(SEASONS, shared.season, 'season'), BITS.season);
	writer.write(indexOf(MOON_PHASES, shared.moonPhase, 'moon phase'), BITS.moonPhase);
	writer.write(
		quantize(shared.moonIllumination, 0, 1, BITS.moonIllumination),
		BITS.moonIllumination
	);

	writer.write(shared.points, BITS.points);
	writer.write(minted, BITS.mintedOn);
	writer.write(shared.categories.length, BITS.elementCount);

	for (const category of shared.categories) {
		writer.write(indexOf(NUDGE_CATEGORIES, category, 'category'), BITS.category);
	}

	return wrapShareCode(writer.finish());
}

export interface DecodedSceneCode {
	tuple: SceneTuple;
	/** the day it was minted, so the UI can say how stale it is */
	mintedOn: string;
	ageDays: number;
}

/**
 * Decode a scanned code.
 *
 * Throws rather than returning a partial scene. A share that silently renders the
 * wrong picture is worse than one that plainly says it could not be read.
 */
export function decodeSceneCode(text: string, today: string = dayKey()): DecodedSceneCode {
	try {
		return readSceneCode(text, today);
	} catch (error) {
		// the bit reader and the base45 codec raise their own type; callers of this
		// module should only ever have to catch one
		if (error instanceof SceneCodeError) throw error;
		throw new SceneCodeError(
			error instanceof Error ? error.message : 'could not read this code',
			'malformed'
		);
	}
}

function readSceneCode(text: string, today: string): DecodedSceneCode {
	if (!isShareCode(text)) throw new SceneCodeError('not a Recess share code', 'malformed');

	const reader = new BitReader(unwrapShareCode(text));

	const codeVersion = reader.read(BITS.codeVersion);
	if (codeVersion !== SCENE_CODE_VERSION) {
		throw new SceneCodeError(
			`share codes at version ${codeVersion} are not supported`,
			'unsupported'
		);
	}

	const schemaVersion = reader.read(BITS.schemaVersion);
	if (schemaVersion > SCENE_SCHEMA_VERSION) {
		throw new SceneCodeError('made by a newer version of Recess', 'unsupported');
	}

	const seed = reader.read(BITS.seed);

	const traits: SceneTraits = {
		paletteFamily: itemAt<PaletteFamily>(
			PALETTE_FAMILIES,
			reader.read(BITS.paletteFamily),
			'palette family'
		),
		layoutGrammar: itemAt<LayoutGrammar>(
			LAYOUT_GRAMMARS,
			reader.read(BITS.layoutGrammar),
			'layout grammar'
		),
		motif: itemAt<Motif>(MOTIFS, reader.read(BITS.motif), 'motif'),
		speciesSkin: reader.read(BITS.speciesSkin),
		horizon: dequantize(reader.read(BITS.horizon), 0.55, 0.75, BITS.horizon),
		lightAngle: dequantize(reader.read(BITS.lightAngle), -35, 35, BITS.lightAngle)
	};

	if (traits.speciesSkin > SPECIES_SKINS - 1) {
		throw new SceneCodeError('species skin out of range', 'malformed');
	}

	const timeOfDay = itemAt<TimeOfDay>(TIMES_OF_DAY, reader.read(BITS.timeOfDay), 'time of day');
	const season = itemAt<Season>(SEASONS, reader.read(BITS.season), 'season');
	const moonPhase = itemAt<MoonPhase>(MOON_PHASES, reader.read(BITS.moonPhase), 'moon phase');
	const moonIllumination = dequantize(
		reader.read(BITS.moonIllumination),
		0,
		1,
		BITS.moonIllumination
	);

	const points = reader.read(BITS.points);
	const minted = reader.read(BITS.mintedOn);
	const count = reader.read(BITS.elementCount);

	if (count > SCENE_CODE_MAX_ELEMENTS) {
		throw new SceneCodeError('element count out of range', 'malformed');
	}
	if (reader.remainingBits < count * BITS.category) {
		throw new SceneCodeError('payload ended early', 'malformed');
	}

	const categories: NudgeCategory[] = [];
	for (let index = 0; index < count; index++) {
		categories.push(
			itemAt<NudgeCategory>(NUDGE_CATEGORIES, reader.read(BITS.category), 'category')
		);
	}

	const mintedOn = dayFromOffset(minted);
	const ageDays = daysBetween(mintedOn, today);

	if (ageDays < 0 || ageDays > SCENE_CODE_MAX_AGE_DAYS) {
		throw new SceneCodeError('this code has expired', 'expired');
	}

	return {
		tuple: {
			schemaVersion,
			seed: String(seed),
			traits,
			categories,
			startIndex: 0,
			points,
			timeOfDay,
			season,
			moonPhase,
			moonIllumination
		},
		mintedOn,
		ageDays
	};
}

function dayFromOffset(offset: number): string {
	const epoch = Date.parse(`${DAY_EPOCH}T00:00:00Z`);
	const at = new Date(epoch + offset * 86_400_000);
	return at.toISOString().slice(0, 10);
}

/** bytes a code of this size takes, so the UI can pick a QR version honestly */
export function sceneCodeBytes(elements: number): number {
	const headerBits =
		BITS.codeVersion +
		BITS.schemaVersion +
		BITS.seed +
		BITS.paletteFamily +
		BITS.layoutGrammar +
		BITS.motif +
		BITS.speciesSkin +
		BITS.horizon +
		BITS.lightAngle +
		BITS.timeOfDay +
		BITS.season +
		BITS.moonPhase +
		BITS.moonIllumination +
		BITS.points +
		BITS.mintedOn +
		BITS.elementCount;

	return Math.ceil((headerBits + elements * BITS.category) / 8);
}
