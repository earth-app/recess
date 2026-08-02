import {
	AFFORDANCES,
	TAG_AFFORDANCES,
	type Affordance,
	type ReadonlyPack,
	type ReadonlyPlace
} from '~/types/places';
import {
	bearingDegrees,
	compassPoint,
	distanceMetres,
	reachability,
	snapToGrid,
	walkMinutes,
	type CompassPoint,
	type Coordinate
} from '~/utils/geo';

// Pure functions over a cached pack. No I/O and no Capacitor here on purpose: the whole
// affordance layer stays drivable from a fixture in the sub-2s unit lane.

// #region tags

/** every affordance a set of OSM tags implies, deduped and in vocabulary order */
export function affordancesForTags(tags: Readonly<Record<string, string>>): Affordance[] {
	const found = new Set<Affordance>();

	for (const [key, value] of Object.entries(tags)) {
		for (const affordance of TAG_AFFORDANCES[`${key}=${value}`] ?? []) {
			found.add(affordance);
		}
	}

	// a bench tagged onto something else still means you can sit
	if (tags.bench === 'yes') found.add('sit');
	if (tags.covered === 'yes') found.add('shelter');
	if (tags.drinking_water === 'yes') found.add('drink');

	return AFFORDANCES.filter((affordance) => found.has(affordance));
}

/**
 * Whether a place is reachable by the public at all.
 *
 * `access=private` / `no` / `permit` on a park or a bench means the app would be sending someone
 * to a locked gate, which is worse than showing them nothing.
 */
export function isPublic(tags: Readonly<Record<string, string>>): boolean {
	const access = tags.access;
	if (access === undefined) return true;
	return access !== 'private' && access !== 'no' && access !== 'permit' && access !== 'customers';
}

// #endregion

// #region query

export interface NearbyPlace {
	place: ReadonlyPlace;
	metres: number;
	bearing: number;
	compass: CompassPoint;
	minutes: number;
}

export interface NearbyOptions {
	/** hard cut-off; nothing past this is returned at all */
	within?: number;
	/** a place must carry EVERY affordance listed, matching the `permission` filter's semantics */
	affordances?: readonly Affordance[];
	limit?: number;
}

export const DEFAULT_WITHIN_METRES = 2000;

function coordinateOf(place: ReadonlyPlace): Coordinate {
	return { latitude: place.lat, longitude: place.lon };
}

export function hasAffordances(
	place: ReadonlyPlace,
	required: readonly Affordance[] | undefined
): boolean {
	if (!required || required.length === 0) return true;
	return required.every((affordance) => place.a.includes(affordance));
}

/**
 * Places around a point, nearest first.
 *
 * `within` is a hard cut-off rather than a decay, because a straight-line distance already
 * understates the walk and a list stretching past it would be quietly dishonest. The soft part of
 * the signal - how much a distance actually discourages someone - lives in `reachability`, which
 * scores nudges rather than filtering places.
 */
export function nearbyPlaces(
	pack: ReadonlyPack | null,
	origin: Coordinate | null,
	options: NearbyOptions = {}
): NearbyPlace[] {
	if (!pack || !origin) return [];

	const within = options.within ?? DEFAULT_WITHIN_METRES;
	const found: NearbyPlace[] = [];

	for (const place of pack.places) {
		if (!hasAffordances(place, options.affordances)) continue;

		const target = coordinateOf(place);
		const metres = distanceMetres(origin, target);
		if (metres > within) continue;

		const bearing = bearingDegrees(origin, target);
		found.push({
			place,
			metres,
			bearing,
			compass: compassPoint(bearing),
			minutes: walkMinutes(metres)
		});
	}

	// distance, then id, so a tie never reorders between renders
	found.sort((a, b) => a.metres - b.metres || (a.place.id < b.place.id ? -1 : 1));

	return options.limit === undefined ? found : found.slice(0, options.limit);
}

/**
 * The single best score in [0, 1] for "can this be done nearby", or `null` when unknowable.
 *
 * `null` is the important return. It means the question could not be answered - no pack, no
 * position, or a nudge that names no affordances - and every caller treats that as unknown rather
 * than as zero, which is what keeps the whole place layer failing open.
 */
export function reachabilityFor(
	pack: ReadonlyPack | null,
	origin: Coordinate | null,
	affordances: readonly Affordance[] | undefined,
	maxMetres?: number
): number | null {
	if (!pack || !origin) return null;
	if (!affordances || affordances.length === 0) return null;

	let best: number | null = null;
	for (const place of pack.places) {
		if (!hasAffordances(place, affordances)) continue;
		const metres = distanceMetres(origin, coordinateOf(place));
		const score = reachability(metres, maxMetres);
		if (best === null || score > best) best = score;
	}

	// the pack loaded and simply holds nothing that fits: a real, definite zero-ish answer
	return best ?? 0;
}

export interface ReachabilityIndex {
	/** every affordance with at least one place inside the radius */
	affordances: Affordance[];
	/** best score per affordance, in (0, 1] */
	scores: Partial<Record<Affordance, number>>;
}

/**
 * Both halves of the place signal, in a single pass over the pack.
 *
 * Called once per context build and read by every filter and every scored nudge, so it walks the
 * pack once rather than once per affordance. Returns `null` when the question is unanswerable -
 * no pack or no position - and that `null` is what every downstream consumer turns into "unknown",
 * so the whole layer fails open from one place.
 *
 * The radius is a hard cut-off on membership, while the score inside it is the smooth decay: a
 * place 3 km away should not make `nearby: sit` pass, but a bench at 200 m and one at 900 m should
 * both pass and be ranked differently.
 */
export function reachabilityIndex(
	pack: ReadonlyPack | null,
	origin: Coordinate | null,
	options: { within?: number; maxMetres?: number } = {}
): ReachabilityIndex | null {
	if (!pack || !origin) return null;

	const within = options.within ?? DEFAULT_WITHIN_METRES;
	const scores: Partial<Record<Affordance, number>> = {};

	for (const place of pack.places) {
		const metres = distanceMetres(origin, coordinateOf(place));
		if (metres > within) continue;

		const score = reachability(metres, options.maxMetres);
		for (const affordance of place.a) {
			const best = scores[affordance];
			if (best === undefined || score > best) scores[affordance] = score;
		}
	}

	return { affordances: AFFORDANCES.filter((a) => scores[a] !== undefined), scores };
}

// #region binding

/** the stable key for a grid cell, used by the ledger and by Warm Ground */
export function cellKey(latitude: number, longitude: number): string {
	const cell = snapToGrid(latitude, longitude);
	return `${cell.latitude},${cell.longitude}`;
}

/** every cell the user has ever resolved a nudge in */
export function visitedCells(
	entries: readonly { place?: { lat: number; lon: number } }[]
): Set<string> {
	const cells = new Set<string>();
	for (const entry of entries) {
		if (entry.place) cells.add(cellKey(entry.place.lat, entry.place.lon));
	}
	return cells;
}

export interface PlaceBinding {
	nudgeId: string;
	place: NearbyPlace;
	/** true when the user has never resolved anything in this cell */
	fresh: boolean;
}

/**
 * Bind each place-needing nudge to a specific spot for the day.
 *
 * Nearest-that-fits, with one deliberate thumb on the scale: a cell the user has never resolved
 * anything in wins over an equally close one they have. That is the only "go somewhere new" push
 * in the feature, and it is grounded in what the ledger actually records rather than in a claim
 * about where the user has been - recess keeps no passive location history, so "never resolved
 * here" is the strongest true statement available. It is NOT "you have never been here".
 *
 * Two nudges never bind to the same place; a repeated spot would make the day read as one errand.
 */
export function bindPlaces(
	nudges: readonly { id: string; place_affordances?: readonly Affordance[] }[],
	pack: ReadonlyPack | null,
	origin: Coordinate | null,
	options: { within?: number; visited?: ReadonlySet<string> } = {}
): PlaceBinding[] {
	if (!pack || !origin) return [];

	const visited = options.visited ?? new Set<string>();
	const taken = new Set<string>();
	const bindings: PlaceBinding[] = [];

	for (const nudge of nudges) {
		const needs = nudge.place_affordances;
		if (!needs || needs.length === 0) continue;

		const candidates = nearbyPlaces(pack, origin, {
			within: options.within,
			affordances: needs
		}).filter((entry) => !taken.has(entry.place.id));

		if (candidates.length === 0) continue;

		/**
		 * A never-resolved cell beats a closer already-resolved one, but only inside the same
		 * walk band - novelty must not send someone twice as far.
		 *
		 * The 600 m floor is what makes the band mean anything when the nearest place is right
		 * outside the door: at a 1.5x multiple alone, a bench 200 m away would cap the band at
		 * 300 m and rule out somewhere new two minutes further on. 600 m is ~7 minutes and sits
		 * comfortably inside the half-mile that ~75% of adults call a reasonable walk (NHTS).
		 */
		const nearest = candidates[0]!;
		const band = Math.max(600, nearest.metres * 1.5);
		const preferred =
			candidates.find(
				(entry) => entry.metres <= band && !visited.has(cellKey(entry.place.lat, entry.place.lon))
			) ?? nearest;

		taken.add(preferred.place.id);
		bindings.push({
			nudgeId: nudge.id,
			place: preferred,
			fresh: !visited.has(cellKey(preferred.place.lat, preferred.place.lon))
		});
	}

	return bindings;
}

// #endregion

/** distinct affordances a pack actually contains, for the coverage check */
export function packAffordances(pack: ReadonlyPack | null): Affordance[] {
	if (!pack) return [];
	const found = new Set<Affordance>();
	for (const place of pack.places) {
		for (const affordance of place.a) found.add(affordance);
	}
	return AFFORDANCES.filter((affordance) => found.has(affordance));
}

/**
 * Whether a pack is rich enough to build a surface on.
 *
 * Not a POI count. Johnson et al. (CHI 2016) found rural OSM carries *more* features per capita
 * than urban while local contributors supply 4% of rural tokens against 37.6% urban - so the
 * count looks healthy exactly where the locally-known affordance detail is missing. Counting
 * distinct affordances is what actually distinguishes "your area is mapped" from "your area has a
 * lot of field boundaries in it".
 */
export const MIN_AFFORDANCE_COVERAGE = 4;

export function isPackUsable(pack: ReadonlyPack | null): boolean {
	return packAffordances(pack).length >= MIN_AFFORDANCE_COVERAGE;
}

// #endregion
