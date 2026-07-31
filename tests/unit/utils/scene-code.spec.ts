import { describe, expect, it } from 'vitest';
import type { NudgeCategory } from '~/types/nudge';
import { NUDGE_CATEGORIES } from '~/types/nudge';
import {
	buildScene,
	deriveTraits,
	SCENE_SCHEMA_VERSION,
	type SceneTuple
} from '~/utils/playground';
import { decodeBase45, encodeBase45, isShareCode, SHARE_PREFIX } from '~/utils/qr';
import {
	decodeSceneCode,
	encodeSceneCode,
	ephemeralSeed,
	SCENE_CODE_MAX_ELEMENTS,
	sceneCodeBytes,
	SceneCodeError,
	shareableTuple
} from '~/utils/scene-code';

const INSTALL_SEED = '0f1e2d3c4b5a69788796a5b4c3d2e1f0';
const TODAY = '2026-07-27';

function tuple(overrides: Partial<SceneTuple> = {}): SceneTuple {
	const categories: NudgeCategory[] = ['nature', 'art', 'people', 'cooking', 'nature', 'exercise'];
	return {
		schemaVersion: SCENE_SCHEMA_VERSION,
		seed: INSTALL_SEED,
		traits: deriveTraits(INSTALL_SEED),
		categories,
		startIndex: 0,
		points: 1240,
		timeOfDay: 'dusk',
		season: 'summer',
		moonPhase: 'waxing_gibbous',
		moonIllumination: 0.72,
		...overrides
	};
}

describe('ephemeralSeed', () => {
	it('is stable for a day, so two shares in one day render the same', () => {
		expect(ephemeralSeed(INSTALL_SEED, TODAY)).toBe(ephemeralSeed(INSTALL_SEED, TODAY));
	});

	it('changes with the day, so a code stops being an identifier', () => {
		expect(ephemeralSeed(INSTALL_SEED, TODAY)).not.toBe(ephemeralSeed(INSTALL_SEED, '2026-07-28'));
	});

	it('differs per install', () => {
		expect(ephemeralSeed(INSTALL_SEED, TODAY)).not.toBe(ephemeralSeed('deadbeef'.repeat(4), TODAY));
	});

	it('fits 32 unsigned bits', () => {
		const seed = ephemeralSeed(INSTALL_SEED, TODAY);
		expect(Number.isInteger(seed)).toBe(true);
		expect(seed).toBeGreaterThanOrEqual(0);
		expect(seed).toBeLessThanOrEqual(0xffffffff);
	});
});

describe('encodeSceneCode', () => {
	it('produces a prefixed, alphanumeric-safe code', () => {
		const code = encodeSceneCode(tuple(), { installSeed: INSTALL_SEED, day: TODAY });
		expect(isShareCode(code)).toBe(true);
		expect(code.slice(4)).toMatch(/^[0-9A-Z $%*+\-./:]*$/);
	});

	it('never carries the install seed', () => {
		const code = encodeSceneCode(tuple(), { installSeed: INSTALL_SEED, day: TODAY });
		// the whole point of the ephemeral seed; a stable one would be an identifier
		expect(code).not.toContain(INSTALL_SEED.toUpperCase());
		expect(code).not.toContain(INSTALL_SEED);
	});

	it('is deterministic for the same scene and day', () => {
		const options = { installSeed: INSTALL_SEED, day: TODAY };
		expect(encodeSceneCode(tuple(), options)).toBe(encodeSceneCode(tuple(), options));
	});

	it('stays small enough to scan off a screen', () => {
		const big = tuple({
			categories: Array.from(
				{ length: 400 },
				(_, index) => NUDGE_CATEGORIES[index % NUDGE_CATEGORIES.length] as NudgeCategory
			)
		});

		const code = encodeSceneCode(big, { installSeed: INSTALL_SEED, day: TODAY });

		// v11 at ECC M holds 331 alphanumeric characters; the practical ceiling for a
		// screen-to-screen scan is around v20-25, so this leaves real headroom
		expect(code.length).toBeLessThan(331);
	});

	it('reports its own byte cost', () => {
		expect(sceneCodeBytes(0)).toBe(16);
		expect(sceneCodeBytes(160)).toBe(96);
	});
});

describe('shareableTuple', () => {
	it('swaps the install seed for the ephemeral one', () => {
		const shared = shareableTuple(tuple(), { installSeed: INSTALL_SEED, day: TODAY });
		expect(shared.seed).toBe(String(ephemeralSeed(INSTALL_SEED, TODAY)));
		expect(shared.seed).not.toBe(INSTALL_SEED);
	});

	it('keeps the traits that carry the look, rounded to what the payload holds', () => {
		const source = tuple();
		const shared = shareableTuple(source, { installSeed: INSTALL_SEED, day: TODAY });

		// the discrete traits survive exactly; the two continuous ones are quantised, and
		// they have to be, or the sharer would preview a picture nobody else receives
		expect(shared.traits.paletteFamily).toBe(source.traits.paletteFamily);
		expect(shared.traits.layoutGrammar).toBe(source.traits.layoutGrammar);
		expect(shared.traits.motif).toBe(source.traits.motif);
		expect(shared.traits.speciesSkin).toBe(source.traits.speciesSkin);
		expect(shared.traits.horizon).toBeCloseTo(source.traits.horizon, 3);
		expect(shared.traits.lightAngle).toBeCloseTo(source.traits.lightAngle, 0);
	});

	it('is idempotent, so re-sharing does not drift the traits', () => {
		const options = { installSeed: INSTALL_SEED, day: TODAY };
		const once = shareableTuple(tuple(), options);
		expect(shareableTuple(once, options).traits).toEqual(once.traits);
	});

	it('trims to the newest elements and shifts startIndex so nothing moves', () => {
		const categories = Array.from(
			{ length: SCENE_CODE_MAX_ELEMENTS + 40 },
			() => 'nature' as NudgeCategory
		);
		const shared = shareableTuple(tuple({ categories, startIndex: 5 }), {
			installSeed: INSTALL_SEED,
			day: TODAY
		});

		expect(shared.categories).toHaveLength(SCENE_CODE_MAX_ELEMENTS);
		expect(shared.startIndex).toBe(45);
	});

	it('is what the sharer should preview, so it renders', () => {
		const shared = shareableTuple(tuple(), { installSeed: INSTALL_SEED, day: TODAY });
		expect(() => buildScene(shared)).not.toThrow();
	});
});

describe('decodeSceneCode', () => {
	it('round-trips every field a scene is drawn from', () => {
		const source = tuple();
		const code = encodeSceneCode(source, { installSeed: INSTALL_SEED, day: TODAY });
		const { tuple: decoded, mintedOn, ageDays } = decodeSceneCode(code, TODAY);

		expect(decoded.schemaVersion).toBe(source.schemaVersion);
		expect(decoded.categories).toEqual(source.categories);
		expect(decoded.points).toBe(source.points);
		expect(decoded.timeOfDay).toBe(source.timeOfDay);
		expect(decoded.season).toBe(source.season);
		expect(decoded.moonPhase).toBe(source.moonPhase);
		expect(decoded.traits.paletteFamily).toBe(source.traits.paletteFamily);
		expect(decoded.traits.layoutGrammar).toBe(source.traits.layoutGrammar);
		expect(decoded.traits.motif).toBe(source.traits.motif);
		expect(decoded.traits.speciesSkin).toBe(source.traits.speciesSkin);
		expect(mintedOn).toBe(TODAY);
		expect(ageDays).toBe(0);
	});

	it('keeps the quantised traits close enough to look the same', () => {
		const source = tuple();
		const code = encodeSceneCode(source, { installSeed: INSTALL_SEED, day: TODAY });
		const { tuple: decoded } = decodeSceneCode(code, TODAY);

		// 8 bits over a 0.20 span, and over 70 degrees
		expect(decoded.traits.horizon).toBeCloseTo(source.traits.horizon, 2);
		expect(decoded.traits.lightAngle).toBeCloseTo(source.traits.lightAngle, 0);
		expect(decoded.moonIllumination).toBeCloseTo(source.moonIllumination, 2);
	});

	it('renders the same picture the sharer previewed', () => {
		const source = tuple();
		const options = { installSeed: INSTALL_SEED, day: TODAY };
		const previewed = buildScene(shareableTuple(source, options));
		const received = buildScene(decodeSceneCode(encodeSceneCode(source, options), TODAY).tuple);

		// what the sharer sees has to be what the other person gets, or the preview lies
		expect(received.elements.map((element) => element.species)).toEqual(
			previewed.elements.map((element) => element.species)
		);
		expect(received.traits).toEqual(previewed.traits);
		expect(received.points).toBe(previewed.points);
	});

	it('survives an empty playground', () => {
		const code = encodeSceneCode(tuple({ categories: [], points: 0 }), {
			installSeed: INSTALL_SEED,
			day: TODAY
		});
		const { tuple: decoded } = decodeSceneCode(code, TODAY);
		expect(decoded.categories).toEqual([]);
		expect(decoded.points).toBe(0);
	});

	it('carries a full-size playground', () => {
		const categories = Array.from(
			{ length: SCENE_CODE_MAX_ELEMENTS },
			(_, index) => NUDGE_CATEGORIES[index % NUDGE_CATEGORIES.length] as NudgeCategory
		);
		const code = encodeSceneCode(tuple({ categories }), {
			installSeed: INSTALL_SEED,
			day: TODAY
		});
		expect(decodeSceneCode(code, TODAY).tuple.categories).toEqual(categories);
	});

	it('expires the next day, which is the one-time bound', () => {
		const code = encodeSceneCode(tuple(), { installSeed: INSTALL_SEED, day: TODAY });

		expect(() => decodeSceneCode(code, '2026-07-28')).not.toThrow();
		expect(() => decodeSceneCode(code, '2026-07-29')).toThrow(
			expect.objectContaining({ kind: 'expired' })
		);
	});

	it('rejects a code minted in the future rather than trusting the clock', () => {
		const code = encodeSceneCode(tuple(), { installSeed: INSTALL_SEED, day: '2026-08-10' });
		expect(() => decodeSceneCode(code, TODAY)).toThrow(
			expect.objectContaining({ kind: 'expired' })
		);
	});

	it('rejects an unrelated QR payload', () => {
		expect(() => decodeSceneCode('https://example.com')).toThrow(
			expect.objectContaining({ kind: 'malformed' })
		);
	});

	it('rejects a truncated payload rather than drawing a partial scene', () => {
		const code = encodeSceneCode(tuple(), { installSeed: INSTALL_SEED, day: TODAY });
		expect(() => decodeSceneCode(code.slice(0, code.length - 6), TODAY)).toThrow(SceneCodeError);
	});

	it('rejects a newer code version by name', () => {
		const code = encodeSceneCode(tuple(), { installSeed: INSTALL_SEED, day: TODAY });
		expect(() => decodeSceneCode(bumpVersion(code), TODAY)).toThrow(
			expect.objectContaining({ kind: 'unsupported' })
		);
	});
});

/** re-encode a code with only its version nibble incremented, to exercise the guard */
function bumpVersion(code: string): string {
	const bytes = decodeBase45(code.slice(SHARE_PREFIX.length));
	const first = bytes[0] ?? 0;
	bytes[0] = ((((first >> 4) + 1) & 0x0f) << 4) | (first & 0x0f);
	return SHARE_PREFIX + encodeBase45(bytes);
}

describe('the code as an actual QR symbol', () => {
	/**
	 * The payload budget only matters if the resulting symbol is readable off another
	 * phone's screen. Version is `(modules - 17) / 4`; the practical screen-to-screen
	 * ceiling is around v20-25 before module density defeats a typical camera, so this
	 * asserts the real encoder output rather than the byte count alone.
	 */
	async function versionOf(code: string): Promise<number> {
		const { encodeQR } = await import('@paulmillr/qr');
		const modules = encodeQR(code, 'raw', { ecc: 'medium', encoding: 'alphanumeric' });
		return (modules.length - 17) / 4;
	}

	it('fits a full playground well inside the scannable range', async () => {
		const categories = Array.from(
			{ length: SCENE_CODE_MAX_ELEMENTS },
			(_, index) => NUDGE_CATEGORIES[index % NUDGE_CATEGORIES.length] as NudgeCategory
		);
		const code = encodeSceneCode(tuple({ categories }), {
			installSeed: INSTALL_SEED,
			day: TODAY
		});

		expect(await versionOf(code)).toBeLessThanOrEqual(10);
	});

	it('survives the encoder without falling back off alphanumeric mode', async () => {
		const { encodeQR } = await import('@paulmillr/qr');
		const code = encodeSceneCode(tuple(), { installSeed: INSTALL_SEED, day: TODAY });

		// alphanumeric mode is only reachable because base45 stays inside its 45-char set;
		// a stray character would silently push the whole symbol into byte mode
		const svg = encodeQR(code, 'svg', { ecc: 'medium', encoding: 'alphanumeric' });
		expect(svg).toContain('viewBox');
	});
});
